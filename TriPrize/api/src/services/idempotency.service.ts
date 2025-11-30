import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis.config';
import { sha256 } from '../utils/crypto.util';
import logger from '../utils/logger.util';

/**
 * Cached response interface
 */
export interface CachedResponse {
  status: number;
  data: unknown;
}

/**
 * Idempotency service to prevent duplicate requests
 */
export class IdempotencyService {
  private readonly DEFAULT_TTL = 24 * 60 * 60; // 24 hours
  // private readonly KONBINI_TTL = 4 * 24 * 60 * 60; // 4 days for konbini payments

  /**
   * Generate idempotency key from request
   */
  private generateKey(userId: string, requestBody: unknown, path: string): string {
    const bodyHash = sha256(JSON.stringify(requestBody));
    return `idempotency:${userId}:${path}:${bodyHash}`;
  }

  /**
   * Check if request is duplicate and return cached response if exists
   */
  async checkIdempotency(
    userId: string,
    requestBody: unknown,
    path: string
  ): Promise<{ isDuplicate: boolean; cachedResponse?: CachedResponse }> {
    try {
      const redis = await getRedisClient();
      const key = this.generateKey(userId, requestBody, path);

      const cached = await redis.get(key);

      if (cached) {
        logger.info('Idempotent request detected', { userId, path });
        return {
          isDuplicate: true,
          cachedResponse: JSON.parse(cached) as CachedResponse,
        };
      }

      return { isDuplicate: false };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Idempotency check failed', { error: errorMessage, userId, path });
      // If Redis fails, allow the request to proceed (fail open)
      return { isDuplicate: false };
    }
  }

  /**
   * Store response for idempotency
   */
  async storeResponse(
    userId: string,
    requestBody: unknown,
    path: string,
    response: unknown,
    ttl?: number
  ): Promise<void> {
    try {
      const redis = await getRedisClient();
      const key = this.generateKey(userId, requestBody, path);
      const effectiveTtl = ttl || this.DEFAULT_TTL;

      await redis.setEx(key, effectiveTtl, JSON.stringify(response));

      logger.debug('Response stored for idempotency', { userId, path, ttl: effectiveTtl });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to store idempotency response', { error: errorMessage, userId, path });
      // Don't throw - this is not critical
    }
  }

  /**
   * Acquire idempotency lock (for preventing concurrent duplicate requests)
   */
  async acquireLock(
    userId: string,
    requestBody: unknown,
    path: string,
    lockTtl: number = 30
  ): Promise<boolean> {
    try {
      const redis = await getRedisClient();
      const lockKey = `${this.generateKey(userId, requestBody, path)}:lock`;

      // Try to acquire lock with SET NX EX
      const acquired = await redis.set(lockKey, '1', {
        NX: true,
        EX: lockTtl,
      });

      return acquired !== null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to acquire idempotency lock', { error: errorMessage, userId, path });
      // If Redis fails, allow the request (fail open)
      return true;
    }
  }

  /**
   * Release idempotency lock
   */
  async releaseLock(userId: string, requestBody: unknown, path: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      const lockKey = `${this.generateKey(userId, requestBody, path)}:lock`;

      await redis.del(lockKey);
      logger.debug('Idempotency lock released', { userId, path });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to release idempotency lock', { error: errorMessage, userId, path });
      // Don't throw - lock will expire naturally
    }
  }

  /**
   * Clear idempotency cache for a user (useful for testing)
   */
  async clearUserIdempotency(userId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      const pattern = `idempotency:${userId}:*`;

      // Scan and delete matching keys
      let cursor = 0;
      do {
        const result = await redis.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });

        cursor = result.cursor;
        const keys = result.keys;

        if (keys.length > 0) {
          await redis.del(keys);
        }
      } while (cursor !== 0);

      logger.info('User idempotency cache cleared', { userId });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to clear user idempotency', { error: errorMessage, userId });
      throw error;
    }
  }
}

/**
 * Idempotency middleware
 */
export function idempotencyMiddleware(ttl?: number): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const service = new IdempotencyService();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Only apply to authenticated users
      const user = (req as { user?: { uid?: string } }).user;
      if (!user?.uid) {
        next();
        return;
      }

      const userId = user.uid;
      const path = req.path;
      const requestBody = req.body as Record<string, unknown>;

      // Check for duplicate request
      const { isDuplicate, cachedResponse } = await service.checkIdempotency(
        userId,
        requestBody,
        path
      );

      if (isDuplicate && cachedResponse) {
        logger.info('Returning cached idempotent response', { userId, path });
        res.status(cachedResponse.status || 200).json(cachedResponse.data);
        return;
      }

      // Acquire lock to prevent concurrent duplicates
      const lockAcquired = await service.acquireLock(userId, requestBody, path);

      if (!lockAcquired) {
        logger.warn('Concurrent duplicate request detected', { userId, path });
        res.status(409).json({
          error: 'DUPLICATE_REQUEST',
          message: 'A duplicate request is currently being processed',
        });
        return;
      }

      // Intercept response to cache it
      const originalJson = res.json.bind(res);
      res.json = function (data: unknown): Response {
        const status = res.statusCode;

        // Only cache successful responses (2xx)
        if (status >= 200 && status < 300) {
          service.storeResponse(userId, requestBody, path, { status, data }, ttl)
            .catch((err: unknown) => {
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              logger.error('Failed to cache response for idempotency', { error: errorMessage });
            });
        }

        // Release lock
        service.releaseLock(userId, requestBody, path)
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            logger.error('Failed to release lock', { error: errorMessage });
          });

        return originalJson(data);
      };

      next();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Idempotency middleware error', { error: errorMessage });
      // Don't fail the request if idempotency check fails
      next();
    }
  };
}

export default new IdempotencyService();
