import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import bcrypt from 'bcrypt';

/**
 * Extended Request interface with developer context
 */
export interface AuthenticatedRequest extends Request {
  developer?: {
    id: string;
    email: string;
    testMode: boolean;
    stripeAccountId: string | null;
    webhookSecret: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * API key authentication middleware
 * 
 * Validates API key from x-api-key header and attaches developer context to request.
 * 
 * Requirements: 10.7
 */
export async function apiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Missing API key. Include x-api-key header.',
        type: 'authentication_error',
      },
    });
    return;
  }

  try {
    // Hash the API key to compare with stored hash
    // For performance, we could use a prefix-based lookup first
    const query = `
      SELECT id, email, api_key_hash, test_mode, stripe_account_id, webhook_secret, created_at, updated_at
      FROM developers
      WHERE id = (
        SELECT id FROM developers 
        WHERE LEFT(api_key_hash, 7) = LEFT($1, 7)
        LIMIT 1
      )
    `;

    const result = await pool.query(query, [apiKey]);

    if (result.rows.length === 0) {
      logger.warn('Invalid API key attempt', {
        keyPrefix: apiKey.substring(0, 7) + '...',
        ip: req.ip,
      });

      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Invalid API key.',
          type: 'authentication_error',
        },
      });
      return;
    }

    const developer = result.rows[0];

    // Verify full API key hash
    const isValid = await bcrypt.compare(apiKey, developer.api_key_hash);
    if (!isValid) {
      logger.warn('Invalid API key hash', {
        developerId: developer.id,
        ip: req.ip,
      });

      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Invalid API key.',
          type: 'authentication_error',
        },
      });
      return;
    }

    // Attach developer to request
    req.developer = {
      id: developer.id,
      email: developer.email,
      testMode: developer.test_mode,
      stripeAccountId: developer.stripe_account_id,
      webhookSecret: developer.webhook_secret,
      createdAt: new Date(developer.created_at),
      updatedAt: new Date(developer.updated_at),
    };

    logger.debug('API key authenticated', {
      developerId: developer.id,
      testMode: developer.test_mode,
    });

    next();
  } catch (error) {
    logger.error('Error authenticating API key', { error });
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Authentication failed.',
        type: 'api_error',
      },
    });
  }
}

/**
 * Simple API key authentication (without database lookup)
 * For development/testing purposes
 */
export function simpleApiKeyAuth(validApiKeys: string[]) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Missing API key. Include x-api-key header.',
          type: 'authentication_error',
        },
      });
      return;
    }

    if (!validApiKeys.includes(apiKey)) {
      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Invalid API key.',
          type: 'authentication_error',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Optional API key authentication
 * Attaches developer context if valid API key is provided, but allows request to continue without one
 */
export async function optionalApiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    next();
    return;
  }

  // Try to authenticate
  await apiKeyAuth(req, res, () => {
    next();
  });
}
