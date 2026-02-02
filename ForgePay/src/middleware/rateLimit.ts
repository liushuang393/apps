import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis';
import { config } from '../config';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';

/**
 * Rate limiting middleware using Redis for distributed state
 * 
 * Requirements: 8.6
 */

/**
 * Standard API rate limiter
 * 100 requests per minute per API key or IP
 */
export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  
  // Use Redis store for distributed rate limiting
  store: new RedisStore({
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    prefix: 'rl:api:',
  }),

  // Key generator: Use API key if available, otherwise IP
  keyGenerator: (req: Request): string => {
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      return `key:${apiKey.substring(0, 20)}`;
    }
    return `ip:${req.ip}`;
  },

  // Custom handler for rate limit exceeded
  handler: (req: Request, res: Response) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      apiKey: (req.headers['x-api-key'] as string)?.substring(0, 10) + '...',
      path: req.path,
    });

    res.status(429).json({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests. Please try again later.',
        type: 'rate_limit_error',
        retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
      },
    });
  },

  // Skip rate limiting for certain paths
  skip: (req: Request): boolean => {
    // Skip rate limiting for health check
    return req.path === '/health';
  },
});

/**
 * Webhook rate limiter
 * Higher limit for webhook endpoints (1000 per minute)
 */
export const webhookRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,

  store: new RedisStore({
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    prefix: 'rl:webhook:',
  }),

  keyGenerator: (req: Request): string => {
    return `ip:${req.ip}`;
  },

  handler: (req: Request, res: Response) => {
    logger.warn('Webhook rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });

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
 * Admin rate limiter
 * Lower limit for admin endpoints (30 per minute)
 */
export const adminRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,

  store: new RedisStore({
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    prefix: 'rl:admin:',
  }),

  keyGenerator: (req: Request): string => {
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      return `key:${apiKey.substring(0, 20)}`;
    }
    return `ip:${req.ip}`;
  },

  handler: (req: Request, res: Response) => {
    logger.warn('Admin rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });

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
 * Create a custom rate limiter
 * 
 * @param options - Rate limiter options
 * @returns Rate limiter middleware
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

    store: new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      prefix: `rl:${options.prefix}:`,
    }),

    keyGenerator: (req: Request): string => {
      const apiKey = req.headers['x-api-key'] as string;
      if (apiKey) {
        return `key:${apiKey.substring(0, 20)}`;
      }
      return `ip:${req.ip}`;
    },

    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'rate_limit_exceeded',
          message: options.message || 'Too many requests. Please try again later.',
          type: 'rate_limit_error',
          retryAfter: Math.ceil(options.windowMs / 1000),
        },
      });
    },
  });
}
