import { Request, Response, NextFunction } from 'express';
import { getAuth } from '../config/firebase.config';
import logger from '../utils/logger.util';
import crypto from 'crypto';

/**
 * Extended Express Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email: string;
    email_verified: boolean;
  };
}

/**
 * Authentication middleware - verifies Firebase ID token
 * In test mode (USE_MOCK_AUTH=true), accepts mock tokens
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    if (!idToken) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing ID token',
      });
      return;
    }

    // Check if using mock authentication
    const useMockAuth = process.env.USE_MOCK_AUTH === 'true';

    if (useMockAuth && idToken.startsWith('mock_')) {
      // Mock authentication for testing
      // Token format: mock_email@example.com
      const email = idToken.substring(5); // Remove 'mock_' prefix

      // Generate deterministic UUID from email using MD5 hash (same as registration)
      const hash = crypto.createHash('md5').update(email).digest('hex');
      const uid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;

      req.user = {
        uid: uid,
        email: email,
        email_verified: true,
      };

      logger.info(`Mock authentication: ${req.user.uid} (${req.user.email})`);
      next();
      return;
    }

    // Verify Firebase ID token
    const auth = getAuth();
    if (!auth) {
      res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service not available',
      });
      return;
    }

    const decodedToken = await auth.verifyIdToken(idToken);

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || '',
      email_verified: decodedToken.email_verified || false,
    };

    logger.debug(`User authenticated: ${req.user.uid}`);
    next();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;

    logger.warn('Authentication failed', { error: errorMessage });

    if (errorCode === 'auth/id-token-expired') {
      res.status(401).json({
        error: 'TOKEN_EXPIRED',
        message: 'ID token has expired',
      });
      return;
    }

    if (errorCode === 'auth/id-token-revoked') {
      res.status(401).json({
        error: 'TOKEN_REVOKED',
        message: 'ID token has been revoked',
      });
      return;
    }

    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid ID token',
    });
  }
}

/**
 * Optional authentication - doesn't fail if token is missing
 * Useful for endpoints that work differently for authenticated vs anonymous users
 */
export async function optionalAuthenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    if (!idToken) {
      next();
      return;
    }

    // Verify Firebase ID token
    const auth = getAuth();
    if (!auth) {
      next();
      return;
    }

    const decodedToken = await auth.verifyIdToken(idToken);

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || '',
      email_verified: decodedToken.email_verified || false,
    };

    logger.debug(`Optional auth - user authenticated: ${req.user.uid}`);
  } catch (error: unknown) {
    logger.debug('Optional auth - token invalid, continuing as anonymous');
  }

  next();
}

/**
 * Require email verification
 */
export function requireEmailVerification(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    return;
  }

  if (!req.user.email_verified) {
    res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Email verification required',
    });
    return;
  }

  next();
}

export default {
  authenticate,
  optionalAuthenticate,
  requireEmailVerification,
};
