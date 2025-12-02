import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import * as dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { rateLimits } from './middleware/rate-limit.middleware';
import logger from './utils/logger.util';
import campaignRoutes from './routes/campaign.routes';
import purchaseRoutes from './routes/purchase.routes';
import paymentRoutes from './routes/payment.routes';
import lotteryRoutes from './routes/lottery.routes';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';

// Load environment variables
dotenv.config();

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
      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [];
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
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
  if (process.env.NODE_ENV === 'development') {
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
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // API info endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'TriPrize API',
      version: '1.0.0',
      description: 'Triangle lottery campaign sales platform API',
      documentation: '/api/docs',
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
