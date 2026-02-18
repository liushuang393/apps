import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'crypto';

/**
 * Extended Request interface with developer context
 */
export interface AuthenticatedRequest extends Request {
  developer?: {
    id: string;
    email: string;
    testMode: boolean;
    stripeAccountId: string | null;
    webhookSecret: string | null;
    /** 決済成功時のデフォルトリダイレクトURL */
    defaultSuccessUrl: string | null;
    /** 決済キャンセル時のデフォルトリダイレクトURL */
    defaultCancelUrl: string | null;
    /** デフォルトロケール */
    defaultLocale: string;
    /** デフォルト通貨 */
    defaultCurrency: string;
    /** デフォルト決済方法 */
    defaultPaymentMethods: string[];
    /** コールバックURL */
    callbackUrl: string | null;
    /** コールバック署名用シークレット */
    callbackSecret: string | null;
    /** 会社名/サービス名 */
    companyName: string | null;
    /** 暗号化された Stripe Secret Key */
    stripeSecretKeyEnc: string | null;
    /** Stripe Publishable Key */
    stripePublishableKey: string | null;
    /** Stripe Webhook Endpoint Secret */
    stripeWebhookEndpointSecret: string | null;
    /** Stripe 設定済みフラグ */
    stripeConfigured: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Hash API key using SHA-256 (same as DeveloperService)
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * API key authentication middleware
 * 
 * Validates API key from x-api-key header and attaches developer context to request.
 * Uses SHA-256 hash comparison (consistent with DeveloperService).
 * 
 * Requirements: 10.7
 */
export async function apiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Missing API key. Include x-api-key header.',
        type: 'authentication_error',
      },
    });
    return;
  }

  try {
    // Hash the API key and look up the developer
    const apiKeyHash = hashApiKey(apiKey);
    
    const query = `
      SELECT id, email, api_key_hash, test_mode, stripe_account_id, webhook_secret,
             default_success_url, default_cancel_url, default_locale, default_currency,
             default_payment_methods, callback_url, callback_secret, company_name,
             stripe_secret_key_enc, stripe_publishable_key, stripe_webhook_endpoint_secret,
             stripe_configured,
             created_at, updated_at
      FROM developers
      WHERE api_key_hash = $1
    `;

    const result = await pool.query(query, [apiKeyHash]);

    if (result.rows.length === 0) {
      logger.warn('Invalid API key attempt', {
        keyPrefix: apiKey.substring(0, 7) + '...',
        ip: req.ip,
      });

      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Invalid API key.',
          type: 'authentication_error',
        },
      });
      return;
    }

    const developer = result.rows[0];

    // Attach developer to request
    req.developer = {
      id: developer.id,
      email: developer.email,
      testMode: developer.test_mode,
      stripeAccountId: developer.stripe_account_id,
      webhookSecret: developer.webhook_secret,
      defaultSuccessUrl: developer.default_success_url || null,
      defaultCancelUrl: developer.default_cancel_url || null,
      defaultLocale: developer.default_locale || 'auto',
      defaultCurrency: developer.default_currency || 'usd',
      defaultPaymentMethods: developer.default_payment_methods || ['card'],
      callbackUrl: developer.callback_url || null,
      callbackSecret: developer.callback_secret || null,
      companyName: developer.company_name || null,
      stripeSecretKeyEnc: developer.stripe_secret_key_enc || null,
      stripePublishableKey: developer.stripe_publishable_key || null,
      stripeWebhookEndpointSecret: developer.stripe_webhook_endpoint_secret || null,
      stripeConfigured: developer.stripe_configured || false,
      createdAt: new Date(developer.created_at),
      updatedAt: new Date(developer.updated_at),
    };

    logger.debug('API key authenticated', {
      developerId: developer.id,
      testMode: developer.test_mode,
    });

    next();
  } catch (error) {
    logger.error('Error authenticating API key', { error });
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Authentication failed.',
        type: 'api_error',
      },
    });
  }
}

/**
 * Optional API key authentication
 * Attaches developer context if valid API key is provided, but allows request to continue without one
 */
export async function optionalApiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    next();
    return;
  }

  // Try to authenticate
  await apiKeyAuth(req, res, () => {
    next();
  });
}
