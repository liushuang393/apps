import rateLimit, { RateLimitRequestHandler, MemoryStore } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis';
import { config } from '../config';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';

/**
 * Redis が接続済みなら RedisStore、未接続なら MemoryStore を返す
 */
function createStore(prefix: string) {
  if (redisClient.isReady) {
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      prefix,
    });
  }
  logger.warn(`Redis 未接続のため MemoryStore にフォールバック: ${prefix}`);
  return new MemoryStore();
}

/** API キーまたは IP をレート制限キーとして返す */
function keyByApiKeyOrIp(req: Request): string {
  const apiKey = req.headers['x-api-key'] as string;
  return apiKey ? `key:${apiKey.substring(0, 20)}` : `ip:${req.ip}`;
}

/** レート制限超過時のレスポンス */
function rateLimitHandler(retryAfterSec: number) {
  return (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests. Please try again later.',
        type: 'rate_limit_error',
        retryAfter: retryAfterSec,
      },
    });
  };
}

/**
 * 汎用 API レートリミッター（100 req/min）
 * テスト・開発環境では上限を大幅に緩和
 */
export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.app?.env === 'test' || config.app?.env === 'development'
    ? 10000
    : config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('rl:api:'),
  keyGenerator: keyByApiKeyOrIp,
  handler: rateLimitHandler(Math.ceil(config.rateLimit.windowMs / 1000)),
  skip: (req: Request) => req.path === '/health',
});

/**
 * Webhook レートリミッター（1000 req/min）
 * Stripe からの大量 Webhook に対応
 */
export const webhookRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('rl:webhook:'),
  keyGenerator: (req: Request) => `ip:${req.ip}`,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many webhook requests.',
        type: 'rate_limit_error',
        retryAfter: 60,
      },
    });
  },
});

/**
 * 管理 API レートリミッター（30 req/min）
 * 管理操作の過剰実行を防止
 */
export const adminRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  max: config.app?.env === 'test' || config.app?.env === 'development' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('rl:admin:'),
  keyGenerator: keyByApiKeyOrIp,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many admin requests. Please try again later.',
        type: 'rate_limit_error',
        retryAfter: 60,
      },
    });
  },
});

/**
 * カスタムレートリミッターファクトリ
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  prefix: string;
  message?: string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(`rl:${options.prefix}:`),
    keyGenerator: keyByApiKeyOrIp,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'rate_limit_exceeded',
          message: options.message ?? 'Too many requests. Please try again later.',
          type: 'rate_limit_error',
          retryAfter: Math.ceil(options.windowMs / 1000),
        },
      });
    },
  });
}
