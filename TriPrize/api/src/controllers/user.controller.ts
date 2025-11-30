import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/error.middleware';
import userService from '../services/user.service';
import admin from 'firebase-admin';
import logger from '../utils/logger.util';
import { mapUserToProfile } from '../models/user.entity';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import crypto from 'crypto';

class UserController {
  /**
   * @desc    Create a new user (P0 FIX)
   * @route   POST /api/users
   * @access  Public (Protected by auth middleware)
   * @note    Called by frontend during registration after Firebase Auth succeeds
   */
  createUser = asyncHandler(async (req: Request, res: Response) => {
    const { user_id, email, display_name, avatar_url, fcm_token } = req.body as {
      user_id: string;
      email: string;
      display_name?: string;
      avatar_url?: string;
      fcm_token?: string;
    };

    logger.info(`Creating user: ${user_id}, email: ${email}`);

    // Check if user already exists (idempotency)
    let user = await userService.getUserById(user_id);
    if (user) {
      logger.info(`User already exists: ${user_id}, returning existing user`);
      return res.status(200).json({
        success: true,
        user_id: user.user_id,
        message: 'User already exists',
      });
    }

    // Create user in database
    user = await userService.createUser({
      user_id,
      email,
      display_name,
      avatar_url,
      fcm_token,
    });

    logger.info(`User created successfully: ${user_id}`);

    return res.status(201).json({
      success: true,
      user_id: user.user_id,
      message: 'User created successfully',
    });
  });

  /**
   * @desc    Update user's last login timestamp (P0 FIX)
   * @route   POST /api/users/:id/last-login
   * @access  Public (Protected by auth middleware)
   * @note    Called by frontend during login after Firebase Auth succeeds
   */
  updateLastLogin = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.id;

    logger.info(`Updating last login for user: ${userId}`);

    // Verify user exists
    const user = await userService.getUserById(userId);
    if (!user) {
      logger.warn(`User not found: ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Update last login timestamp
    await userService.updateLastLogin(userId);

    logger.info(`Last login updated successfully: ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Last login updated',
    });
  });

  /**
   * @desc    新規ユーザー登録（Firebase + DB を同時に処理）
   * @route   POST /api/auth/register
   * @access  Public
   * 目的: Firebase と DB を一括で登録し、失敗時はロールバック
   * 注意点:
   *   - 本番環境: 後端で Firebase ユーザー作成 → DB 登録（失敗時は Firebase を削除）
   *   - モック環境: Firebase を使わず、直接 DB に登録
   */
  register = asyncHandler(async (req: Request, res: Response) => {
    const { email, password, display_name, role } = req.body as {
      email: string;
      password: string;
      display_name?: string;
      role?: 'customer' | 'admin';
    };

    logger.info('Registration request received', {
      email,
      role,
      has_display_name: !!display_name,
      has_password: !!password,
    });

    const useMockAuth = process.env.USE_MOCK_AUTH === 'true';
    let firebaseUid: string = '';
    let firebaseUserCreated = false;

    // ロール決定
    // 目的: ユーザーのロールを決定する
    // 注意点:
    //   - Mock認証モード: roleパラメータをそのまま使用
    //   - 本番認証モード: 
    //     * INITIAL_ADMIN_EMAILと一致する場合はadmin
    //     * 開発環境（NODE_ENV !== 'production'）でroleパラメータが指定されている場合はそれを使用
    //     * それ以外はcustomer
    const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL || '';
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const effectiveRole: 'customer' | 'admin' =
      useMockAuth && role
        ? role
        : (initialAdminEmail && email === initialAdminEmail)
          ? 'admin'
          : (isDevelopment && role)
            ? role
            : 'customer';
    
    logger.info('Role determination', {
      email,
      requestedRole: role,
      effectiveRole,
      useMockAuth,
      isDevelopment,
      initialAdminEmail,
    });

    try {
      if (useMockAuth) {
        // モック認証: Firebase を使わず、メールから ID を生成
        const hash = crypto.createHash('md5').update(email).digest('hex');
        firebaseUid = `mock-${hash.substring(0, 24)}`;
        logger.info(`Mock registration: ${firebaseUid} (${email})`);
      } else {
        // 本番認証: 後端で Firebase ユーザーを作成
        const auth = admin.auth();
        if (!auth) {
          throw new Error('Firebase Auth is not initialized');
        }

        // Firebase にユーザー作成
        const userRecord = await auth.createUser({
          email: email,
          password: password,
          displayName: display_name,
        });
        firebaseUid = userRecord.uid;
        firebaseUserCreated = true;

        logger.info('Firebase user created', { firebaseUid, email });
      }

      // DB にユーザー作成
      const user = await userService.createUser({
        user_id: firebaseUid,
        email: email,
        display_name: display_name,
        role: effectiveRole,
      });

      logger.info('User registered successfully', {
        firebaseUid,
        email,
        role: effectiveRole,
      });

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: user,
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;

      logger.error('Registration failed', {
        error: errorMessage,
        errorCode,
        email,
        effectiveRole,
      });

      // Firebase ユーザーが作成済みなら削除（ロールバック）
      if (firebaseUserCreated && firebaseUid) {
        try {
          await admin.auth().deleteUser(firebaseUid);
          logger.info('Rolled back Firebase user', { firebaseUid });
        } catch (rollbackError) {
          logger.error('Failed to rollback Firebase user', {
            firebaseUid,
            error: rollbackError instanceof Error ? rollbackError.message : 'Unknown',
          });
        }
      }

      // エラーメッセージをクライアント向けに変換
      if (errorCode === 'auth/email-already-exists') {
        return res.status(409).json({
          success: false,
          message: 'An account with this email already exists',
        });
      }

      throw error;
    }
  });

  /**
   * @desc    Login a user
   * @route   POST /api/auth/login
   * @access  Public
   */
  login = asyncHandler(async (req: Request, res: Response) => {
    const { firebase_token } = req.body as { firebase_token: string };

    let firebaseUid: string;

    // Check if using mock authentication
    const useMockAuth = process.env.USE_MOCK_AUTH === 'true';

    if (useMockAuth && firebase_token.startsWith('mock_')) {
      // Mock authentication for testing
      // Extract email from token: mock_email@example.com
      const email = firebase_token.substring(5); // Remove 'mock_' prefix
      // Generate a deterministic UUID from email using MD5 hash
      const hash = crypto.createHash('md5').update(email).digest('hex');
      // Format as UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      firebaseUid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
      logger.info(`Mock login: ${firebaseUid} (${email})`);
    } else {
      // Verify Firebase ID token
      try {
        const auth = admin.auth();
        if (!auth) {
          logger.error('Firebase Auth is not initialized for login', {
            firebase_token_length: firebase_token?.length || 0,
          });
          throw new Error('Firebase Auth is not initialized. Please check Firebase configuration.');
        }
        
        logger.info('Verifying Firebase ID token for login', {
          token_length: firebase_token?.length || 0,
        });
        
        const decodedToken = await auth.verifyIdToken(firebase_token);
        firebaseUid = decodedToken.uid;
        
        logger.info('Firebase ID token verified successfully for login', {
          firebaseUid,
          email: decodedToken.email,
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = error && typeof error === 'object' && 'code' in error 
          ? (error as { code: string }).code 
          : undefined;
        
        logger.error('Firebase ID token verification failed for login', {
          error: errorMessage,
          errorCode,
          stack: error instanceof Error ? error.stack : undefined,
        });
        
        throw error;
      }
    }

    // Check if user exists in our DB
    const user = await userService.getUserById(firebaseUid);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found, please register' });
    }

    // Update last login
    await userService.updateLastLogin(firebaseUid);

    // Return user data including role for frontend navigation
    return res.status(200).json({ 
      success: true, 
      message: 'User logged in successfully', 
      data: {
        user_id: user.user_id,
        email: user.email,
        display_name: user.display_name,
        role: user.role, // ロール情報を含める
        avatar_url: user.avatar_url,
      }
    });
  });

  /**
   * @desc    Get current user profile
   * @route   GET /api/users/me
   * @access  Private
   */
  getMe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const profile = await userService.getUserProfile(userId);

    if (!profile) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      data: profile,
    });
  });

  /**
   * @desc    Update current user profile
   * @route   PUT /api/users/me
   * @access  Private
   */
  updateMe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { display_name, avatar_url, fcm_token, notification_enabled } = req.body as {
      display_name?: string;
      avatar_url?: string;
      fcm_token?: string;
      notification_enabled?: boolean;
    };

    const user = await userService.updateUser(userId, {
      display_name,
      avatar_url,
      fcm_token,
      notification_enabled,
    });

    const profile = mapUserToProfile(user);

    return res.status(200).json({
      success: true,
      data: profile,
      message: 'Profile updated successfully',
    });
  });

  /**
   * @desc    Get current user statistics
   * @route   GET /api/users/me/stats
   * @access  Private
   */
  getMyStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const stats = await userService.getUserStats(userId);

    return res.status(200).json({
      success: true,
      data: stats,
    });
  });

  /**
   * @desc    List all users (admin only)
   * @route   GET /api/users
   * @access  Private (Admin)
   */
  listUsers = asyncHandler(async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? Number.parseInt(req.query.offset as string, 10) : 0;

    const users = await userService.listUsers(limit, offset);
    const totalCount = await userService.getUserCount();

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        limit,
        offset,
        total: totalCount,
      },
    });
  });

  /**
   * @desc    Update user role (admin only)
   * @route   PATCH /api/users/:id/role
   * @access  Private (Admin)
   */
  updateUserRole = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.id;
    const { role } = req.body as { role: 'customer' | 'admin' };

    if (!['customer', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be "customer" or "admin"',
      });
    }

    // Update user role in database
    await userService.updateUser(userId, { role });
    const user = await userService.getUserById(userId);

    return res.status(200).json({
      success: true,
      data: user,
      message: 'User role updated successfully',
    });
  });

  /**
   * @desc    Check if admin user exists
   * @route   GET /api/users/check-admin
   * @access  Public
   * 目的: 管理者ユーザーが存在するかチェック（登録画面で使用）
   */
  checkAdminExists = asyncHandler(async (req: Request, res: Response) => {
    const hasAdmin = await userService.hasAdminUser();
    
    return res.status(200).json({
      success: true,
      data: {
        hasAdmin,
      },
    });
  });
}

export default new UserController();
