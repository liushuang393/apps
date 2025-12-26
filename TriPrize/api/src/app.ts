import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { rateLimits } from './middleware/rate-limit.middleware';
import logger from './utils/logger.util';
import { APP_CONFIG, SERVER_CONFIG, SECURITY_CONFIG } from './config/app.config';
import campaignRoutes from './routes/campaign.routes';
import purchaseRoutes from './routes/purchase.routes';
import paymentRoutes from './routes/payment.routes';
import lotteryRoutes from './routes/lottery.routes';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';

/**
 * Create and configure Express application
 */
export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS configuration
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }

      // Allow all localhost and 127.0.0.1 origins with any port (http and https)
      if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
        return callback(null, true);
      }

      // Check against configured origins
      if (SECURITY_CONFIG.corsOrigins.includes(origin) || SECURITY_CONFIG.corsOrigins.includes('*')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400, // 24 hours
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression middleware
  app.use(compression());

  // Request logging
  if (SERVER_CONFIG.isDevelopment) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined', {
      stream: {
        write: (message: string) => logger.info(message.trim()),
      },
    }));
  }

  // Health check endpoint (no rate limiting)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: SERVER_CONFIG.nodeEnv,
      app: APP_CONFIG.name,
    });
  });

  // API info endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: `${APP_CONFIG.name} API`,
      version: APP_CONFIG.version,
      description: `${APP_CONFIG.description} API`,
      documentation: APP_CONFIG.documentationUrl,
    });
  });

  // Apply general rate limiting to all /api routes
  app.use('/api', rateLimits.api);

  // Mount routes
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/lottery', lotteryRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes); // P0 FIX: User management endpoints

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

export default createApp;
