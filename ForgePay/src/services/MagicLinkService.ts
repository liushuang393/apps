import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { redisClient } from '../config/redis';
import { EmailService, emailService } from './EmailService';
import { CustomerRepository, customerRepository } from '../repositories/CustomerRepository';
import { logger } from '../utils/logger';

/**
 * Magic link token payload
 */
export interface MagicLinkPayload {
  customerId: string;
  email: string;
  type: 'portal_access';
  jti: string;
}

/**
 * Portal session data
 */
export interface PortalSession {
  sessionId: string;
  customerId: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * MagicLinkService handles passwordless authentication for customer portal
 * 
 * Responsibilities:
 * - Generate and send magic links via email
 * - Verify magic link tokens
 * - Create and manage portal sessions
 * 
 * Requirements: 11.2
 */
export class MagicLinkService {
  private customerRepo: CustomerRepository;
  private emailSvc: EmailService;
  private readonly MAGIC_LINK_TTL = 15 * 60; // 15 minutes
  private readonly SESSION_TTL = 24 * 60 * 60; // 24 hours
  private readonly MAGIC_LINK_SECRET: string;

  constructor(
    customerRepo: CustomerRepository = customerRepository,
    emailSvc: EmailService = emailService
  ) {
    this.customerRepo = customerRepo;
    this.emailSvc = emailSvc;
    this.MAGIC_LINK_SECRET = config.jwt.secret + '_magic_link';
  }

  /**
   * Generate and send a magic link to customer
   * 
   * @param email - Customer email address
   * @returns Success indicator
   */
  async sendMagicLink(email: string): Promise<{ success: boolean; message: string }> {
    try {
      // Find customer by email
      const customer = await this.customerRepo.findByEmail(email);

      if (!customer) {
        // Don't reveal if customer exists or not
        logger.info('Magic link requested for non-existent customer', { email: '***' });
        return { 
          success: true, 
          message: 'If your email is registered, you will receive a magic link shortly.' 
        };
      }

      // Generate magic link token
      const jti = uuidv4();
      const token = this.generateMagicToken(customer.id, email, jti);

      // Store token reference in Redis for single-use validation
      await redisClient.setEx(
        `magic_link:${jti}`,
        this.MAGIC_LINK_TTL,
        customer.id
      );

      // Generate magic link URL
      const magicLinkUrl = `${config.app.baseUrl}/portal/auth/verify?token=${token}`;

      // Send email
      await this.emailSvc.send({
        to: { email, name: customer.name || undefined },
        subject: 'Your ForgePay Portal Access Link',
        html: this.getMagicLinkEmailHtml(customer.name || email, magicLinkUrl),
        text: this.getMagicLinkEmailText(customer.name || email, magicLinkUrl),
      });

      logger.info('Magic link sent', { customerId: customer.id });

      return { 
        success: true, 
        message: 'If your email is registered, you will receive a magic link shortly.' 
      };
    } catch (error) {
      logger.error('Error sending magic link', { error });
      throw error;
    }
  }

  /**
   * Verify magic link token and create session
   * 
   * @param token - Magic link JWT token
   * @returns Portal session or error
   */
  async verifyMagicLink(token: string): Promise<{
    success: boolean;
    session?: PortalSession;
    error?: string;
  }> {
    try {
      // Verify JWT
      const payload = jwt.verify(token, this.MAGIC_LINK_SECRET) as MagicLinkPayload;

      // Check if token was already used (single-use)
      const storedCustomerId = await redisClient.get(`magic_link:${payload.jti}`);

      if (!storedCustomerId) {
        return { success: false, error: 'Magic link expired or already used' };
      }

      // Verify customer ID matches
      if (storedCustomerId !== payload.customerId) {
        return { success: false, error: 'Invalid magic link' };
      }

      // Delete the magic link (single-use)
      await redisClient.del(`magic_link:${payload.jti}`);

      // Create portal session
      const session = await this.createSession(payload.customerId, payload.email);

      logger.info('Magic link verified, session created', { 
        customerId: payload.customerId,
        sessionId: session.sessionId,
      });

      return { success: true, session };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { success: false, error: 'Magic link has expired' };
      }
      if (error instanceof jwt.JsonWebTokenError) {
        return { success: false, error: 'Invalid magic link' };
      }
      logger.error('Error verifying magic link', { error });
      throw error;
    }
  }

  /**
   * Verify portal session
   * 
   * @param sessionId - Session ID
   * @returns Session data or null
   */
  async verifySession(sessionId: string): Promise<PortalSession | null> {
    try {
      const sessionData = await redisClient.get(`portal_session:${sessionId}`);

      if (!sessionData) {
        return null;
      }

      const session = JSON.parse(sessionData) as PortalSession;
      session.createdAt = new Date(session.createdAt);
      session.expiresAt = new Date(session.expiresAt);

      // Check if expired
      if (session.expiresAt < new Date()) {
        await this.destroySession(sessionId);
        return null;
      }

      return session;
    } catch (error) {
      logger.error('Error verifying session', { error, sessionId });
      return null;
    }
  }

  /**
   * Destroy portal session (logout)
   * 
   * @param sessionId - Session ID
   */
  async destroySession(sessionId: string): Promise<void> {
    await redisClient.del(`portal_session:${sessionId}`);
    logger.info('Portal session destroyed', { sessionId });
  }

  /**
   * Refresh session expiration
   * 
   * @param sessionId - Session ID
   * @returns Updated session or null
   */
  async refreshSession(sessionId: string): Promise<PortalSession | null> {
    const session = await this.verifySession(sessionId);

    if (!session) {
      return null;
    }

    // Extend expiration
    const newExpiresAt = new Date(Date.now() + this.SESSION_TTL * 1000);
    session.expiresAt = newExpiresAt;

    await redisClient.setEx(
      `portal_session:${sessionId}`,
      this.SESSION_TTL,
      JSON.stringify(session)
    );

    return session;
  }

  /**
   * Generate magic link JWT token
   */
  private generateMagicToken(customerId: string, email: string, jti: string): string {
    const payload: MagicLinkPayload = {
      customerId,
      email,
      type: 'portal_access',
      jti,
    };

    return jwt.sign(payload, this.MAGIC_LINK_SECRET, {
      expiresIn: this.MAGIC_LINK_TTL,
      algorithm: 'HS256',
    });
  }

  /**
   * Create a new portal session
   */
  private async createSession(customerId: string, email: string): Promise<PortalSession> {
    const sessionId = this.generateSecureSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.SESSION_TTL * 1000);

    const session: PortalSession = {
      sessionId,
      customerId,
      email,
      createdAt: now,
      expiresAt,
    };

    await redisClient.setEx(
      `portal_session:${sessionId}`,
      this.SESSION_TTL,
      JSON.stringify(session)
    );

    return session;
  }

  /**
   * Generate cryptographically secure session ID
   */
  private generateSecureSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get magic link email HTML content
   */
  private getMagicLinkEmailHtml(name: string, magicLinkUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Your Portal</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">ForgePay Portal</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px;">Hi ${name},</p>
    
    <p style="font-size: 16px;">Click the button below to access your customer portal. This link will expire in 15 minutes.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${magicLinkUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-size: 16px; font-weight: 600;">Access Portal</a>
    </div>
    
    <p style="font-size: 14px; color: #666;">If you didn't request this link, you can safely ignore this email.</p>
    
    <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this URL into your browser:</p>
    <p style="font-size: 12px; color: #999; word-break: break-all;">${magicLinkUrl}</p>
    
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
    
    <p style="font-size: 12px; color: #999; text-align: center;">
      This is an automated message from ForgePay. Please do not reply.
    </p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Get magic link email plain text content
   */
  private getMagicLinkEmailText(name: string, magicLinkUrl: string): string {
    return `
Hi ${name},

You requested access to your ForgePay customer portal.

Click this link to access your portal (expires in 15 minutes):
${magicLinkUrl}

If you didn't request this link, you can safely ignore this email.

---
This is an automated message from ForgePay.
    `.trim();
  }
}

// Export singleton instance
export const magicLinkService = new MagicLinkService();
