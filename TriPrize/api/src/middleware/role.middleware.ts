import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { pool } from '../config/database.config';
import { UserRole } from '../models/user.entity';
import logger from '../utils/logger.util';

/**
 * Database user row type
 */
interface UserRow {
  user_id: string;
  email: string;
  role: string;
  display_name: string | null;
}

/**
 * Extended request with database user info
 */
export interface AuthorizedRequest extends AuthenticatedRequest {
  dbUser?: {
    user_id: string;
    email: string;
    role: UserRole;
    display_name: string | null;
  };
}

/**
 * Load user from database and attach to request
 */
export async function loadUser(
  req: AuthorizedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    // Query user from database
    const { rows } = await pool.query<UserRow>(
      'SELECT user_id, email, role, display_name FROM users WHERE user_id = $1',
      [req.user.uid]
    );

    if (rows.length === 0) {
      res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found in database',
      });
      return;
    }

    // Attach database user to request
    const userRow = rows[0];
    req.dbUser = {
      user_id: userRow.user_id,
      email: userRow.email,
      role: userRow.role as UserRole,
      display_name: userRow.display_name,
    };

    logger.debug(`User loaded from DB: ${req.dbUser.user_id} (${req.dbUser.role})`);
    next();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to load user from database', { error: errorMessage });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to load user information',
    });
  }
}

/**
 * Require specific role(s)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthorizedRequest, res: Response, next: NextFunction): void => {
    if (!req.dbUser) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User information not loaded',
      });
      return;
    }

    if (!allowedRoles.includes(req.dbUser.role)) {
      logger.warn(`Access denied for user ${req.dbUser.user_id}: role ${req.dbUser.role} not in [${allowedRoles.join(', ')}]`);
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
      return;
    }

    logger.debug(`Access granted for user ${req.dbUser.user_id} with role ${req.dbUser.role}`);
    next();
  };
}

/**
 * Require admin role
 */
export function requireAdmin(
  req: AuthorizedRequest,
  res: Response,
  next: NextFunction
): void {
  return requireRole(UserRole.ADMIN)(req, res, next);
}

/**
 * Allow resource owner or admin
 * Use this for endpoints where users can access their own resources
 */
export function requireOwnerOrAdmin(userIdParam: string = 'userId') {
  return (req: AuthorizedRequest, res: Response, next: NextFunction): void => {
    if (!req.dbUser) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User information not loaded',
      });
      return;
    }

    const resourceUserId = req.params[userIdParam];

    // Allow if admin or owner
    if (req.dbUser.role === UserRole.ADMIN || req.dbUser.user_id === resourceUserId) {
      logger.debug(`Access granted: user ${req.dbUser.user_id} accessing resource for ${resourceUserId}`);
      next();
      return;
    }

    logger.warn(`Access denied: user ${req.dbUser.user_id} attempted to access resource for ${resourceUserId}`);
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'You can only access your own resources',
    });
  };
}

export default {
  loadUser,
  requireRole,
  requireAdmin,
  requireOwnerOrAdmin,
};
