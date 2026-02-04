import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Token payload structure
 */
export interface TokenPayload {
  entitlementId: string;
  purchaseIntentId: string;
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Token verification result
 */
export interface TokenVerificationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

/**
 * TokenService handles generation and verification of unlock tokens
 * 
 * Responsibilities:
 * - Generate short-lived JWT unlock tokens
 * - Verify token signature, expiration, and single-use constraint
 * - Track used tokens in Redis
 * 
 * Requirements: 4.3, 4.4, 4.6, 4.7
 */
export class TokenService {
  private jwtSecret: string;
  private tokenExpirationSeconds: number;

  constructor(
    jwtSecret: string = config.jwt.secret,
    tokenExpirationSeconds: number = 300 // 5 minutes default
  ) {
    this.jwtSecret = jwtSecret;
    this.tokenExpirationSeconds = tokenExpirationSeconds;
  }

  /**
   * Generate an unlock token
   * 
   * @param entitlementId - Entitlement ID
   * @param purchaseIntentId - Purchase intent ID from OpenAI
   * @returns Signed JWT token
   */
  async generateUnlockToken(
    entitlementId: string,
    purchaseIntentId: string
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const jti = uuidv4();

    const payload: TokenPayload = {
      entitlementId,
      purchaseIntentId,
      iat: now,
      exp: now + this.tokenExpirationSeconds,
      jti,
    };

    const token = jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });

    logger.info('Unlock token generated', {
      entitlementId,
      purchaseIntentId,
      jti,
      expiresAt: new Date((now + this.tokenExpirationSeconds) * 1000).toISOString(),
    });

    return token;
  }

  /**
   * Verify an unlock token
   * 
   * @param token - JWT token to verify
   * @returns Verification result
   */
  async verifyUnlockToken(token: string): Promise<TokenVerificationResult> {
    try {
      // Verify JWT signature and decode
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as TokenPayload;

      // Check if token has been used
      const isUsed = await this.isTokenUsed(decoded.jti);
      if (isUsed) {
        logger.warn('Token already used', {
          jti: decoded.jti,
          entitlementId: decoded.entitlementId,
        });
        return {
          valid: false,
          error: 'Token has already been used',
        };
      }

      // Mark token as used
      await this.markTokenUsed(decoded.jti);

      logger.info('Unlock token verified', {
        entitlementId: decoded.entitlementId,
        purchaseIntentId: decoded.purchaseIntentId,
        jti: decoded.jti,
      });

      return {
        valid: true,
        payload: decoded,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.warn('Token expired', { error });
        return {
          valid: false,
          error: 'Token has expired',
        };
      }

      if (error instanceof jwt.JsonWebTokenError) {
        logger.warn('Invalid token', { error });
        return {
          valid: false,
          error: 'Invalid token',
        };
      }

      logger.error('Token verification error', { error });
      return {
        valid: false,
        error: 'Token verification failed',
      };
    }
  }

  /**
   * Verify token without consuming it (read-only check)
   * 
   * @param token - JWT token to verify
   * @returns Verification result (does not mark as used)
   */
  async verifyUnlockTokenReadOnly(token: string): Promise<TokenVerificationResult> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as TokenPayload;

      // Check if token has been used
      const isUsed = await this.isTokenUsed(decoded.jti);
      if (isUsed) {
        return {
          valid: false,
          error: 'Token has already been used',
        };
      }

      return {
        valid: true,
        payload: decoded,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.warn('Token expired during read-only verification', { error });
        return {
          valid: false,
          error: 'Token has expired',
        };
      }

      if (error instanceof jwt.JsonWebTokenError) {
        logger.warn('Invalid token during read-only verification', { error });
        return {
          valid: false,
          error: 'Invalid token',
        };
      }

      logger.error('Token verification error during read-only verification', { error });
      return {
        valid: false,
        error: 'Token verification failed',
      };
    }
  }

  /**
   * Decode token without verification (for debugging)
   * 
   * @param token - JWT token to decode
   * @returns Decoded payload or null
   */
  decodeToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.decode(token) as TokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Check if a token has been used
   * 
   * @param jti - Token unique identifier
   * @returns True if token has been used
   */
  private async isTokenUsed(jti: string): Promise<boolean> {
    try {
      const key = `token:used:${jti}`;
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Error checking token usage', { error, jti });
      // Fail open - allow verification if Redis is unavailable
      return false;
    }
  }

  /**
   * Mark a token as used
   * 
   * @param jti - Token unique identifier
   */
  private async markTokenUsed(jti: string): Promise<void> {
    try {
      const key = `token:used:${jti}`;
      // Set with expiration matching token lifetime
      await redisClient.setEx(key, this.tokenExpirationSeconds, '1');

      logger.debug('Token marked as used', { jti });
    } catch (error) {
      logger.error('Error marking token as used', { error, jti });
      // Don't throw - token verification should still succeed
    }
  }
}

// Export singleton instance
export const tokenService = new TokenService();
