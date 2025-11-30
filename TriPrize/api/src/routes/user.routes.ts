import { Router } from 'express';
import userController from '../controllers/user.controller';
import { validateBody } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { loadUser, requireAdmin } from '../middleware/role.middleware';
import { z } from 'zod';

const router = Router();

/**
 * Validation Schemas
 */
const createUserSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  email: z.string().email('Valid email is required'),
  display_name: z.string().optional(),
  avatar_url: z.string().url().optional().or(z.literal('')),
  fcm_token: z.string().optional(),
});

/**
 * User Routes
 * 目的: 提供用户管理相关的API端点
 * 注意: 这些端点修复了P0问题 - 前端注册和登录需要这些端点
 */

/**
 * @route   GET /api/users/me
 * @desc    Get current user profile
 * @access  Private
 * @note    Must be before GET /api/users to avoid route conflict
 */
router.get(
  '/me',
  authenticate,
  userController.getMe
);

/**
 * @route   PUT /api/users/me
 * @desc    Update current user profile
 * @access  Private
 */
router.put(
  '/me',
  authenticate,
  userController.updateMe
);

/**
 * @route   GET /api/users/me/stats
 * @desc    Get current user statistics
 * @access  Private
 */
router.get(
  '/me/stats',
  authenticate,
  userController.getMyStats
);

/**
 * @route   GET /api/users
 * @desc    List all users (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/',
  authenticate,
  loadUser,
  requireAdmin,
  userController.listUsers
);

/**
 * @route   POST /api/users
 * @desc    Create a new user (called during registration)
 * @access  Public (Protected by Firebase token validation in controller)
 * @note    P0 FIX: Frontend calls this during registration after Firebase Auth succeeds
 */
router.post(
  '/',
  authenticate, // Verify Firebase token
  validateBody(createUserSchema),
  userController.createUser
);

/**
 * @route   POST /api/users/:id/last-login
 * @desc    Update user's last login timestamp
 * @access  Public (Protected by Firebase token validation)
 * @note    P0 FIX: Frontend calls this during login after Firebase Auth succeeds
 */
router.post(
  '/:id/last-login',
  authenticate, // Verify Firebase token
  userController.updateLastLogin
);

/**
 * @route   PATCH /api/users/:id/role
 * @desc    Update user role (admin only)
 * @access  Private (Admin)
 */
router.patch(
  '/:id/role',
  authenticate,
  loadUser,
  requireAdmin,
  validateBody(z.object({
    role: z.enum(['customer', 'admin']),
  })),
  userController.updateUserRole
);

/**
 * @route   GET /api/users/check-admin
 * @desc    Check if admin user exists
 * @access  Public
 */
router.get(
  '/check-admin',
  userController.checkAdminExists
);

export default router;
