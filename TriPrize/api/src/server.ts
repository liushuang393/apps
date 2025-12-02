import { createApp } from './app';
import { pool, testConnection } from './config/database.config';
import { getRedisClient, closeRedis } from './config/redis.config';
import { getFirebaseApp } from './config/firebase.config';
import paymentService from './services/payment.service';
import logger from './utils/logger.util';
import * as dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    logger.info('Starting TriPrize API server...');

    // Test database connection
    logger.info('Testing database connection...');
    await testConnection();
    logger.info('✓ Database connection successful');

    // Connect to Redis
    logger.info('Connecting to Redis...');
    await getRedisClient();
    logger.info('✓ Redis connection successful');

    // Initialize Firebase
    logger.info('Initializing Firebase...');
    getFirebaseApp();
    logger.info('✓ Firebase initialized');

    // Create Express app
    const app = createApp();

    // Start scheduled tasks
    // 目的: 启动定时任务清理过期的 Konbini 支付
    // 注意点: 服务器启动后自动启动，每小时运行一次
    logger.info('Starting scheduled tasks...');
    paymentService.startScheduledCleanup();
    logger.info('✓ Scheduled tasks started');

    // Start listening
    const server = app.listen(PORT, HOST, () => {
      logger.info(`✓ Server running at http://${HOST}:${PORT}`);
      logger.info(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`✓ Health check: http://${HOST}:${PORT}/health`);
    });

    // Graceful shutdown
    const shutdown = (signal: string): void => {
      logger.info(`${signal} received, starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');

        Promise.all([pool.end(), closeRedis()])
          .then(() => {
            logger.info('Database connections closed');
            logger.info('Redis disconnected');
            logger.info('Graceful shutdown completed');
            process.exit(0);
          })
          .catch((error: unknown) => {
            const err = error as Error;
            logger.error('Error during shutdown', { error: err.message });
            process.exit(1);
          });
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle unhandled errors
    process.on('unhandledRejection', (reason: unknown) => {
      const err = reason as Error;
      logger.error('Unhandled Promise Rejection', {
        reason: err?.message || String(reason),
        stack: err?.stack,
      });
    });

    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack,
      });
      // Exit process on uncaught exception
      process.exit(1);
    });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('Failed to start server', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  void startServer();
}

export default startServer;
