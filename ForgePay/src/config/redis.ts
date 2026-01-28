import { createClient, RedisClientType } from 'redis';
import { config } from './index';
import { logger } from '../utils/logger';

// Redis client type
export type RedisClient = RedisClientType;

// Create Redis client
const redisClient: RedisClient = createClient({
  url: config.redis.url,
  password: config.redis.password,
});

// Handle Redis errors
redisClient.on('error', (err) => {
  logger.error('Redis client error', { error: err });
});

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready');
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis client reconnecting');
});

// Connect to Redis
export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    logger.info('Redis connection successful');
  } catch (error) {
    logger.error('Redis connection failed', { error });
    throw error;
  }
}

// Close Redis connection
export async function closeRedis(): Promise<void> {
  try {
    await redisClient.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis connection', { error });
    throw error;
  }
}

// Test Redis connection
export async function testRedisConnection(): Promise<void> {
  try {
    await redisClient.ping();
    logger.info('Redis ping successful');
  } catch (error) {
    logger.error('Redis ping failed', { error });
    throw error;
  }
}

export { redisClient };
export default redisClient;
