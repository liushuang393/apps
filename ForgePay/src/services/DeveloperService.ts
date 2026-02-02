import crypto from 'crypto';
import {
  DeveloperRepository,
  developerRepository,
  Developer,
  CreateDeveloperParams,
} from '../repositories/DeveloperRepository';
import { LegalTemplateService, legalTemplateService } from './LegalTemplateService';
import { EmailService, emailService } from './EmailService';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * API key with plain text (only returned once on creation)
 */
export interface ApiKeyResult {
  apiKey: string; // Plain text API key (only shown once)
  prefix: string; // First 8 characters for identification
}

/**
 * Registration result
 */
export interface RegistrationResult {
  developer: Developer;
  apiKey: ApiKeyResult;
}

/**
 * Onboarding status
 */
export interface OnboardingStatus {
  developerId: string;
  email: string;
  steps: {
    accountCreated: boolean;
    apiKeyGenerated: boolean;
    stripeConnected: boolean;
    firstProductCreated: boolean;
    legalTemplatesConfigured: boolean;
    webhookConfigured: boolean;
  };
  completedSteps: number;
  totalSteps: number;
  isComplete: boolean;
  nextStep: string | null;
}

/**
 * DeveloperService handles developer registration and onboarding
 * 
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */
export class DeveloperService {
  private developerRepo: DeveloperRepository;
  private legalService: LegalTemplateService;
  private emailSvc: EmailService;
  private readonly API_KEY_PREFIX = 'fpb'; // ForgePay Bridge

  constructor(
    developerRepo: DeveloperRepository = developerRepository,
    legalService: LegalTemplateService = legalTemplateService,
    emailSvc: EmailService = emailService
  ) {
    this.developerRepo = developerRepo;
    this.legalService = legalService;
    this.emailSvc = emailSvc;
  }

  /**
   * Register a new developer
   */
  async register(
    email: string,
    options?: { testMode?: boolean }
  ): Promise<RegistrationResult> {
    // Check if email already exists
    const existing = await this.developerRepo.findByEmail(email);
    if (existing) {
      throw new Error('Email already registered');
    }

    // Generate API key
    const apiKey = this.generateApiKey(options?.testMode ?? true);
    const apiKeyHash = await this.hashApiKey(apiKey.apiKey);

    // Create developer
    const createParams: CreateDeveloperParams = {
      email,
      apiKeyHash,
      testMode: options?.testMode ?? true,
    };

    const developer = await this.developerRepo.create(createParams);

    // Create default legal templates
    try {
      await this.legalService.createDefaultTemplates(developer.id);
    } catch (error) {
      logger.warn('Failed to create default legal templates', { error, developerId: developer.id });
    }

    // Send welcome email
    try {
      await this.sendWelcomeEmail(developer, apiKey.apiKey);
    } catch (error) {
      logger.warn('Failed to send welcome email', { error, developerId: developer.id });
    }

    logger.info('Developer registered', {
      developerId: developer.id,
      testMode: developer.testMode,
    });

    return {
      developer,
      apiKey,
    };
  }

  /**
   * Generate a new API key for a developer
   */
  async regenerateApiKey(developerId: string): Promise<ApiKeyResult> {
    const developer = await this.developerRepo.findById(developerId);
    if (!developer) {
      throw new Error('Developer not found');
    }

    const apiKey = this.generateApiKey(developer.testMode);
    const apiKeyHash = await this.hashApiKey(apiKey.apiKey);

    await this.developerRepo.update(developerId, { apiKeyHash });

    logger.info('API key regenerated', { developerId });

    return apiKey;
  }

  /**
   * Validate an API key
   */
  async validateApiKey(apiKey: string): Promise<Developer | null> {
    const apiKeyHash = await this.hashApiKey(apiKey);
    return this.developerRepo.findByApiKeyHash(apiKeyHash);
  }

  /**
   * Get developer by ID
   */
  async getDeveloper(id: string): Promise<Developer | null> {
    return this.developerRepo.findById(id);
  }

  /**
   * Get developer by email
   */
  async getDeveloperByEmail(email: string): Promise<Developer | null> {
    return this.developerRepo.findByEmail(email);
  }

  /**
   * Update developer settings
   */
  async updateSettings(
    developerId: string,
    settings: {
      testMode?: boolean;
      webhookSecret?: string;
    }
  ): Promise<Developer | null> {
    return this.developerRepo.update(developerId, settings);
  }

  /**
   * Connect Stripe account
   */
  async connectStripeAccount(
    developerId: string,
    stripeAccountId: string
  ): Promise<Developer | null> {
    const developer = await this.developerRepo.update(developerId, {
      stripeAccountId,
    });

    if (developer) {
      logger.info('Stripe account connected', {
        developerId,
        stripeAccountId,
      });
    }

    return developer;
  }

  /**
   * Get onboarding status for a developer
   */
  async getOnboardingStatus(developerId: string): Promise<OnboardingStatus | null> {
    const developer = await this.developerRepo.findById(developerId);
    if (!developer) {
      return null;
    }

    // Check various onboarding steps
    const legalTemplates = await this.legalService.getActiveTemplates(developerId);
    const hasLegalTemplates = Object.values(legalTemplates).some(Boolean);

    // We would check products, but for now we'll assume this step needs to be checked elsewhere
    // In a full implementation, inject ProductRepository

    const steps = {
      accountCreated: true, // Always true if we have a developer
      apiKeyGenerated: true, // Always true if we have a developer
      stripeConnected: !!developer.stripeAccountId,
      firstProductCreated: false, // Would check via ProductRepository
      legalTemplatesConfigured: hasLegalTemplates,
      webhookConfigured: !!developer.webhookSecret,
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;
    const isComplete = completedSteps === totalSteps;

    // Determine next step
    let nextStep: string | null = null;
    if (!steps.stripeConnected) {
      nextStep = 'Connect your Stripe account';
    } else if (!steps.firstProductCreated) {
      nextStep = 'Create your first product';
    } else if (!steps.legalTemplatesConfigured) {
      nextStep = 'Configure legal templates';
    } else if (!steps.webhookConfigured) {
      nextStep = 'Set up webhooks';
    }

    return {
      developerId,
      email: developer.email,
      steps,
      completedSteps,
      totalSteps,
      isComplete,
      nextStep,
    };
  }

  /**
   * Switch between test and live mode
   */
  async switchMode(developerId: string, testMode: boolean): Promise<Developer | null> {
    const developer = await this.developerRepo.update(developerId, { testMode });

    if (developer) {
      logger.info('Developer mode switched', {
        developerId,
        testMode,
      });
    }

    return developer;
  }

  /**
   * Delete developer account
   */
  async deleteAccount(developerId: string): Promise<boolean> {
    return this.developerRepo.delete(developerId);
  }

  /**
   * Generate API key
   */
  private generateApiKey(testMode: boolean): ApiKeyResult {
    const mode = testMode ? 'test' : 'live';
    const randomPart = crypto.randomBytes(24).toString('base64url');
    const apiKey = `${this.API_KEY_PREFIX}_${mode}_${randomPart}`;

    return {
      apiKey,
      prefix: apiKey.substring(0, 12),
    };
  }

  /**
   * Hash API key for storage
   * Note: Using a simple hash for faster lookups. For production,
   * consider using a slower hash like bcrypt with a cache layer.
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    // Using SHA-256 for fast lookups
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Send welcome email to new developer
   */
  private async sendWelcomeEmail(developer: Developer, apiKey: string): Promise<void> {
    await this.emailSvc.send({
      to: { email: developer.email },
      subject: 'Welcome to ForgePay!',
      html: this.getWelcomeEmailHtml(developer, apiKey),
      text: this.getWelcomeEmailText(developer, apiKey),
    });
  }

  /**
   * Get welcome email HTML
   */
  private getWelcomeEmailHtml(developer: Developer, apiKey: string): string {
    const dashboardUrl = config.app.baseUrl + '/dashboard';
    const docsUrl = config.app.baseUrl + '/docs';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #0284c7;">Welcome to ForgePay!</h1>
  </div>

  <p>Hi there!</p>

  <p>Thank you for signing up for ForgePay. Your account has been created and you're ready to start accepting payments.</p>

  <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <h3 style="margin-top: 0;">Your API Key</h3>
    <p style="font-family: monospace; background: #fff; padding: 10px; border-radius: 4px; word-break: break-all;">
      ${apiKey}
    </p>
    <p style="font-size: 14px; color: #666;">
      <strong>Important:</strong> This is the only time your API key will be shown. Please save it securely.
    </p>
  </div>

  <h3>Next Steps</h3>
  <ol>
    <li>Save your API key securely</li>
    <li>Connect your Stripe account</li>
    <li>Create your first product</li>
    <li>Integrate the checkout API</li>
  </ol>

  <div style="margin-top: 30px;">
    <a href="${dashboardUrl}" style="display: inline-block; background: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-right: 10px;">Go to Dashboard</a>
    <a href="${docsUrl}" style="display: inline-block; background: #f5f5f5; color: #333; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Docs</a>
  </div>

  <p style="margin-top: 30px; color: #666; font-size: 14px;">
    You're currently in <strong>${developer.testMode ? 'Test Mode' : 'Live Mode'}</strong>. 
    Test mode uses Stripe test keys and won't process real payments.
  </p>

  <hr style="margin-top: 40px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">
    This email was sent by ForgePay. If you didn't create this account, please contact us.
  </p>
</body>
</html>
    `;
  }

  /**
   * Get welcome email text
   */
  private getWelcomeEmailText(developer: Developer, apiKey: string): string {
    return `
Welcome to ForgePay!

Thank you for signing up. Your account has been created.

YOUR API KEY:
${apiKey}

IMPORTANT: This is the only time your API key will be shown. Please save it securely.

NEXT STEPS:
1. Save your API key securely
2. Connect your Stripe account
3. Create your first product
4. Integrate the checkout API

You're currently in ${developer.testMode ? 'Test Mode' : 'Live Mode'}.

If you didn't create this account, please contact us.
    `.trim();
  }
}

// Export singleton instance
export const developerService = new DeveloperService();
