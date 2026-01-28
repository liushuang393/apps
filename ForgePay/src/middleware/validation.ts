import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Zod types - will be available after npm install
// These are placeholder types for TypeScript compilation
interface ZodIssue {
  path: (string | number)[];
  message: string;
}

interface ZodErrorLike {
  errors: ZodIssue[];
  name?: string;
}

type ZodSchema<T = unknown> = {
  parseAsync: (data: unknown) => Promise<T>;
};

/**
 * Validation target types
 */
export type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Validation options
 */
export interface ValidationOptions {
  stripUnknown?: boolean;
}

/**
 * Check if error is a Zod validation error
 */
function isZodError(error: unknown): error is ZodErrorLike {
  return (
    error !== null &&
    typeof error === 'object' &&
    'errors' in error &&
    Array.isArray((error as ZodErrorLike).errors)
  );
}

/**
 * Format Zod errors into API-friendly error response
 */
function formatZodError(error: ZodErrorLike): {
  code: string;
  message: string;
  param?: string;
  type: string;
  details?: Array<{ path: string; message: string }>;
} {
  const firstError = error.errors[0];
  const path = firstError?.path?.join('.') || '';

  return {
    code: 'invalid_request',
    message: firstError?.message || 'Validation failed',
    param: path || undefined,
    type: 'invalid_request_error',
    details: error.errors.map((e: ZodIssue) => ({
      path: e.path.join('.'),
      message: e.message,
    })),
  };
}

/**
 * Create validation middleware for a specific schema and target
 */
export function validate<T>(
  schema: ZodSchema<T>,
  target: ValidationTarget = 'body',
  options: ValidationOptions = {}
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = req[target];

      // Parse and validate the data
      const parsed = await schema.parseAsync(data);

      // Replace the target data with parsed (and potentially transformed) data
      if (options.stripUnknown !== false) {
        (req as unknown as Record<string, unknown>)[target] = parsed;
      }

      next();
    } catch (error: unknown) {
      if (isZodError(error)) {
        logger.warn('Validation failed', {
          target,
          errors: error.errors,
          path: req.path,
        });

        res.status(400).json({
          error: formatZodError(error),
        });
        return;
      }

      // Re-throw unexpected errors
      next(error);
    }
  };
}

/**
 * Validate multiple targets at once
 */
export function validateAll(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate body
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }

      // Validate query
      if (schemas.query) {
        (req as unknown as Record<string, unknown>).query = await schemas.query.parseAsync(req.query);
      }

      // Validate params
      if (schemas.params) {
        (req as unknown as Record<string, unknown>).params = await schemas.params.parseAsync(req.params);
      }

      next();
    } catch (error: unknown) {
      if (isZodError(error)) {
        logger.warn('Validation failed', {
          errors: error.errors,
          path: req.path,
        });

        res.status(400).json({
          error: formatZodError(error),
        });
        return;
      }

      next(error);
    }
  };
}
