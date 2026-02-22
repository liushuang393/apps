import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { redisClient } from '../config/redis';

// Redis キャッシュ TTL（秒）
const AUTH_CACHE_TTL_SEC = 300; // 5分
const AUTH_CACHE_PREFIX = 'auth:dev:';

/** DB/キャッシュから取得した開発者行の型 */
interface DeveloperRow {
  id: string;
  email: string;
  test_mode: boolean;
  stripe_account_id: string | null;
  webhook_secret: string | null;
  default_success_url: string | null;
  default_cancel_url: string | null;
  default_locale: string;
  default_currency: string;
  default_payment_methods: string[];
  callback_url: string | null;
  callback_secret: string | null;
  company_name: string | null;
  stripe_secret_key_enc: string | null;
  stripe_publishable_key: string | null;
  stripe_webhook_endpoint_secret: string | null;
  stripe_configured: boolean;
  created_at: string;
  updated_at: string;
}

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
 * API キーに紐づく認証キャッシュを無効化する。
 * 設定変更後に呼び出し、次のリクエストで最新データを DB から取得させる。
 */
export async function invalidateAuthCache(apiKey: string): Promise<void> {
  try {
    const cacheKey = AUTH_CACHE_PREFIX + hashApiKey(apiKey);
    await redisClient.del(cacheKey);
    logger.debug('Auth cache invalidated', { keyPrefix: apiKey.substring(0, 7) + '...' });
  } catch (err) {
    logger.warn('Auth cache invalidation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
    // API キーをハッシュ化してキャッシュキーとして使用
    const apiKeyHash = hashApiKey(apiKey);
    const cacheKey = AUTH_CACHE_PREFIX + apiKeyHash;

    let developer: DeveloperRow | null = null;

    // Redis キャッシュを確認（TTL 5分）
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        developer = JSON.parse(cached) as DeveloperRow;
        logger.debug('API key cache hit', { keyHash: apiKeyHash.substring(0, 8) });
      }
    } catch (cacheErr) {
      // Redis エラーはキャッシュミスとして扱い DB フォールバック
      logger.warn('Redis キャッシュ読み取り失敗、DB にフォールバック', {
        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      });
    }

    // キャッシュミスの場合は DB を照会
    if (!developer) {
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

      developer = result.rows[0] as DeveloperRow;

      // Redis にキャッシュ保存（エラーは無視してリクエスト処理を継続）
      try {
        await redisClient.setEx(cacheKey, AUTH_CACHE_TTL_SEC, JSON.stringify(developer));
        logger.debug('API key cached', { keyHash: apiKeyHash.substring(0, 8) });
      } catch (cacheErr) {
        logger.warn('Redis キャッシュ書き込み失敗', {
          error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        });
      }
    }

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
