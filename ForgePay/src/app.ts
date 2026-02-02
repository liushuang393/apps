import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
// @ts-ignore - swagger-ui-express will be installed via npm install
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { swaggerSpec, swaggerOptions } from './config/swagger';
import { logger } from './utils/logger';
import { apiRateLimiter } from './middleware';
import apiRoutes from './routes';

// Create Express application
const app: Application = express();

// Security middleware - allow swagger assets
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.app.env === 'production' ? [] : '*', // Configure allowed origins in production
    credentials: true,
  })
);

// Cookie parser
app.use(cookieParser());

// Webhook endpoint needs raw body for signature verification
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));

// Body parsing middleware for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.app.env,
    stripeMode: config.stripe.mode,
  });
});

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerOptions));

// OpenAPI spec in JSON format
app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Apply rate limiting to API routes
app.use('/api/v1', apiRateLimiter);

// API routes
app.use('/api/v1', apiRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `Cannot ${req.method} ${req.path}`,
      type: 'invalid_request_error',
    },
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: config.app.env === 'development' ? err.message : 'An unexpected error occurred',
      type: 'api_error',
    },
  });
});

export default app;
