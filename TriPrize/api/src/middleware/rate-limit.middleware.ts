import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis.config';
import logger from '../utils/logger.util';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix?: string; // Redis key prefix
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

/**
 * Get rate limit key for user
 */
function getRateLimitKey(prefix: string, identifier: string): string {
  return `ratelimit:${prefix}:${identifier}`;
}

/**
 * Rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'default',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = config;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    logger.debug(`Rate Limit Middleware - Processing request for keyPrefix: ${keyPrefix}, Path: ${req.path}`);
    try {
      const redis = await getRedisClient();

      // Get identifier (user ID or IP address)
      const user = req as { user?: { uid: string } };
      const identifier = user.user?.uid || req.ip || 'anonymous';
      const key = getRateLimitKey(keyPrefix, identifier);

      // Get current count
      const current = await redis.get(key);
      const count = current ? Number.parseInt(current, 10) : 0;

      // Check if limit exceeded
      if (count >= maxRequests) {
        const ttl = await redis.ttl(key);
        const resetTime = new Date(Date.now() + ttl * 1000);

        logger.warn('Rate limit exceeded', {
          identifier,
          keyPrefix,
          count,
          maxRequests,
          resetTime,
        });

        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded',
          retryAfter: ttl,
          resetTime: resetTime.toISOString(),
        });
        return;
      }

      // Increment counter
      const newCount = count + 1;
      if (newCount === 1) {
        // First request in window - set expiration
        await redis.setEx(key, Math.ceil(windowMs / 1000), '1');
      } else {
        // Increment existing counter
        await redis.incr(key);
      }

      // Add rate limit headers
      const ttl = await redis.ttl(key);
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - newCount).toString());
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());

      // If configured, decrement on success/failure
      if (skipSuccessfulRequests || skipFailedRequests) {
        const originalSend = res.json;
        res.json = function (data: unknown): Response {
          const statusCode = res.statusCode;

          if (
            (skipSuccessfulRequests && statusCode >= 200 && statusCode < 400) ||
            (skipFailedRequests && statusCode >= 400)
          ) {
            // Decrement counter
            redis.decr(key).catch((err: unknown) => {
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              logger.error('Failed to decrement rate limit counter', { error: errorMessage });
            });
          }

          return originalSend.call(this, data);
        };
      }

      next();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Rate limit middleware error', { error: errorMessage });
      // Don't fail the request if rate limiting fails
      next();
    }
  };
}

/**
 * Predefined rate limit configurations
 */
export const rateLimits = {
  // General API rate limit
  api: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    keyPrefix: 'api',
  }),

  // Authentication endpoints (stricter)
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    keyPrefix: 'auth',
    skipSuccessfulRequests: true,
  }),

  // Purchase endpoints (very strict)
  purchase: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5,
    keyPrefix: 'purchase',
  }),

  // Campaign creation (admin only, but still limited)
  campaignCreate: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20,
    keyPrefix: 'campaign-create',
  }),

  // Image upload
  imageUpload: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50,
    keyPrefix: 'image-upload',
  }),
};

export default {
  rateLimit,
  rateLimits,
};
