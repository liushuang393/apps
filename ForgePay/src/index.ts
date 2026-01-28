import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { testDatabaseConnection, closeDatabaseConnection } from './config/database';
import { connectRedis, closeRedis, testRedisConnection } from './config/redis';

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, starting graceful shutdown`);

  try {
    // Close database connection
    await closeDatabaseConnection();

    // Close Redis connection
    await closeRedis();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error });
    process.exit(1);
  }
}

// Start server
async function startServer(): Promise<void> {
  try {
    // Test database connection
    await testDatabaseConnection();

    // Connect to Redis
    await connectRedis();
    await testRedisConnection();

    // Start Express server
    app.listen(config.app.port, () => {
      logger.info(`ForgePayBridge server started`, {
        port: config.app.port,
        environment: config.app.env,
        stripeMode: config.stripe.mode,
      });
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      gracefulShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', { reason, promise });
      gracefulShutdown('unhandledRejection');
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Start the server
startServer();
