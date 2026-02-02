import { createClient, RedisClientType } from 'redis';
import * as dotenv from 'dotenv';
import logger from '../utils/logger.util';

dotenv.config();

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          logger.error('Redis: Too many reconnection attempts');
          return new Error('Redis reconnection failed');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  });

  redisClient.on('error', (err: Error) => {
    logger.error('Redis Client Error', { error: err.message, stack: err.stack });
  });

  redisClient.on('connect', () => {
    logger.info('✓ Redis connected');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  await redisClient.connect();

  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed');
  }
}

export default getRedisClient;
