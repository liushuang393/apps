import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.util';

/**
 * Custom application error
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common error factory functions
 */
export const errors = {
  notFound: (resource: string = 'Resource'): AppError =>
    new AppError(404, 'NOT_FOUND', `${resource} not found`),

  badRequest: (message: string, details?: unknown): AppError =>
    new AppError(400, 'BAD_REQUEST', message, details),

  unauthorized: (message: string = 'Unauthorized'): AppError =>
    new AppError(401, 'UNAUTHORIZED', message),

  forbidden: (message: string = 'Forbidden'): AppError =>
    new AppError(403, 'FORBIDDEN', message),

  conflict: (message: string, details?: unknown): AppError =>
    new AppError(409, 'CONFLICT', message, details),

  tooManyRequests: (message: string = 'Too many requests'): AppError =>
    new AppError(429, 'TOO_MANY_REQUESTS', message),

  internal: (message: string = 'Internal server error'): AppError =>
    new AppError(500, 'INTERNAL_ERROR', message),

  serviceUnavailable: (message: string = 'Service unavailable'): AppError =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};

/**
 * Error handling middleware
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  , _next: NextFunction
): void {
  // Log error
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Application error', {
        errorCode: err.errorCode,
        message: err.message,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
        details: err.details,
        stack: err.stack,
      });
    } else {
      logger.warn('Client error', {
        errorCode: err.errorCode,
        message: err.message,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
      });
    }

    const response: Record<string, unknown> = {
      error: err.errorCode,
      message: err.message,
    };

    if (err.details) {
      response.details = err.details;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle unknown errors
  logger.error('Unhandled error', {
    message: err.message,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
  });
}

/**
 * Not found handler (404)
 */
export function notFoundHandler(req: Request, res: Response): void {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
  });

  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default {
  AppError,
  errors,
  errorHandler,
  notFoundHandler,
  asyncHandler,
};
