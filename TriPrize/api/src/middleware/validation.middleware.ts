import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import logger from '../utils/logger.util';

/**
 * Validate request body against Zod schema
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        logger.warn('Request validation failed', { errors });

        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: errors,
        });
        return;
      }

      logger.error('Validation middleware error', { error });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
    }
  };
}

/**
 * Validate request query parameters against Zod schema
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        logger.warn('Query validation failed', { errors, query: req.query });

        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: errors,
        });
        return;
      }

      logger.error('Query validation middleware error', { error });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
    }
  };
}

/**
 * Validate request path parameters against Zod schema
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        logger.warn('Params validation failed', { errors, params: req.params });

        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid path parameters',
          details: errors,
        });
        return;
      }

      logger.error('Params validation middleware error', { error });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
    }
  };
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  uuid: z.string().uuid({ message: 'Invalid UUID format' }),

  positiveInt: z.number().int().positive({ message: 'Must be a positive integer' }),

  email: z.string().email({ message: 'Invalid email format' }),

  paginationQuery: z.object({
    limit: z.string().optional().transform((val) => (val ? Number.parseInt(val, 10) : 50)),
    offset: z.string().optional().transform((val) => (val ? Number.parseInt(val, 10) : 0)),
  }),

  campaignStatus: z.enum(['draft', 'published', 'closed', 'drawn'], {
    errorMap: () => ({ message: 'Invalid campaign status' }),
  }),

  purchaseStatus: z.enum(['pending', 'processing', 'completed', 'failed', 'refunded'], {
    errorMap: () => ({ message: 'Invalid purchase status' }),
  }),
};

export default {
  validateBody,
  validateQuery,
  validateParams,
  commonSchemas,
};
