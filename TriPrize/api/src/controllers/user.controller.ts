import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/error.middleware';
import userService from '../services/user.service';
import admin from 'firebase-admin';
import logger from '../utils/logger.util';
import { mapUserToProfile } from '../models/user.entity';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { SECURITY_CONFIG } from '../config/app.config';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// JWT 設定（一元管理された設定から取得）
const JWT_SECRET = SECURITY_CONFIG.jwtSecret;
// JWT 有効期限（秒単位）: 7日 = 604800秒
const JWT_EXPIRES_IN_SECONDS = Number.parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '604800', 10);

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
    const { email, password, display_name, role, firebase_token } = req.body as {
      email: string;
      password?: string;
      display_name?: string;
      role?: 'customer' | 'admin';
      firebase_token?: string;
    };

    logger.info('Registration request received', {
      email,
      role,
      has_display_name: !!display_name,
      has_password: !!password,
      has_firebase_token: !!firebase_token,
    });

    // メールアドレスの重複チェック（セキュリティ強化）
    // 目的: 同じメールアドレスでの重複登録を防止
    // 注意点: Firebase と DB 両方でチェックが必要だが、まず DB をチェック
    const existingUserByEmail = await userService.getUserByEmail(email);
    if (existingUserByEmail) {
      logger.warn('Registration failed: email already exists', { email });
      return res.status(409).json({
        success: false,
        message: 'このメールアドレスは既に登録されています',
        error: 'EMAIL_ALREADY_EXISTS',
      });
    }

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
      if (useMockAuth && firebase_token) {
        // モック認証 (firebase_tokenモード): トークンからメールを抽出してIDを生成
        // firebase_token形式: mock_email@example.com
        const extractedEmail = firebase_token.startsWith('mock_')
          ? firebase_token.substring(5)
          : email;
        const hash = crypto.createHash('md5').update(extractedEmail).digest('hex');
        firebaseUid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
        logger.info(`Mock registration (token mode): ${firebaseUid} (${extractedEmail})`);
      } else if (useMockAuth) {
        // モック認証 (email/passwordモード): メールから ID を生成
        const hash = crypto.createHash('md5').update(email).digest('hex');
        firebaseUid = `mock-${hash.substring(0, 24)}`;
        logger.info(`Mock registration: ${firebaseUid} (${email})`);
      } else {
        // 本番認証: 後端で Firebase ユーザーを作成
        const auth = admin.auth();
        if (!auth) {
          const errorMsg = 'Firebase Auth is not initialized. Please check Firebase configuration and server time synchronization.';
          logger.error(errorMsg, {
            hasServiceAccountPath: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH,
          });
          throw new Error(errorMsg);
        }

        try {
          // Firebase にユーザー作成
          const userRecord = await auth.createUser({
            email: email,
            password: password,
            displayName: display_name,
          });
          firebaseUid = userRecord.uid;
          firebaseUserCreated = true;

          logger.info('Firebase user created', { firebaseUid, email });
        } catch (firebaseError: unknown) {
          const firebaseErrorMessage = firebaseError instanceof Error ? firebaseError.message : 'Unknown error';
          const firebaseErrorCode = firebaseError && typeof firebaseError === 'object' && 'code' in firebaseError
            ? (firebaseError as { code: string }).code
            : undefined;

          // Firebase ユーザーが既に存在する場合
          // → DB も存在するか確認し、両方存在すればスキップ（ログイン扱い）
          if (firebaseErrorCode === 'auth/email-already-exists') {
            logger.info('Firebase user already exists, checking DB', { email });

            // Firebase からユーザー情報を取得
            const existingFirebaseUser = await auth.getUserByEmail(email);
            firebaseUid = existingFirebaseUser.uid;

            // DB にも存在するかチェック
            const existingDbUser = await userService.getUserById(firebaseUid);
            if (existingDbUser) {
              // 両方存在 → 既存ユーザーとしてログイン扱い
              logger.info('User exists in both Firebase and DB, returning existing user', {
                firebaseUid,
                email,
                role: existingDbUser.role,
              });

              // JWT トークンを生成
              const token = jwt.sign(
                {
                  user_id: existingDbUser.user_id,
                  email: existingDbUser.email,
                  role: existingDbUser.role,
                },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN_SECONDS }
              );

              return res.status(200).json({
                success: true,
                message: 'User already exists, logged in successfully',
                data: {
                  ...existingDbUser,
                  token,
                },
              });
            }

            // Firebase のみ存在、DB は存在しない → DB に作成する
            logger.info('User exists in Firebase but not in DB, creating DB record', {
              firebaseUid,
              email,
            });
            // firebaseUserCreated は false のまま（ロールバック不要）
          } else {
            // Check for JWT signature errors (invalid_grant)
            const isJwtSignatureError = firebaseErrorMessage.includes('invalid_grant') ||
                                        firebaseErrorMessage.includes('Invalid JWT Signature') ||
                                        firebaseErrorMessage.includes('JWT Signature');

            logger.error('Firebase user creation failed', {
              error: firebaseErrorMessage,
              errorCode: firebaseErrorCode,
              email,
              isJwtSignatureError,
              serverTime: new Date().toISOString(),
            });

            // Provide user-friendly error messages
            if (firebaseErrorCode === 'auth/invalid-email') {
              throw new Error('無効なメールアドレスです');
            } else if (firebaseErrorCode === 'auth/weak-password') {
              throw new Error('パスワードが弱すぎます。6文字以上で設定してください');
            } else if (isJwtSignatureError) {
              // Detailed error message for JWT signature errors
              const detailedMessage = `Firebase認証エラー: ${firebaseErrorMessage}\n\n` +
                `考えられる原因:\n` +
                `(1) サーバーの時刻同期が正しくない\n` +
                `(2) Firebaseサービスアカウントキーが無効になっている\n\n` +
                `解決方法:\n` +
                `(1) サーバーの時刻同期を確認してください\n` +
                `(2) Firebase Console (https://console.firebase.google.com/iam-admin/serviceaccounts/project) でキーIDを確認し、` +
                `無効な場合は新しいキーを生成してください (https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk)`;
              throw new Error(detailedMessage);
            } else {
              // Generic error with helpful message
              throw new Error(`Firebase認証エラー: ${firebaseErrorMessage}。Firebase設定とサーバーの時刻同期を確認してください。`);
            }
          }
        }
      }

      // DB にユーザー作成（既存チェックと作成を一括処理）
      let user = await userService.getUserById(firebaseUid);
      if (user) {
        // DB に既に存在する場合はスキップ
        logger.info('User already exists in DB, skipping creation', {
          firebaseUid,
          email,
          role: user.role,
        });
      } else {
        // DB に存在しない場合は作成
        user = await userService.createUser({
          user_id: firebaseUid,
          email: email,
          display_name: display_name,
          role: effectiveRole,
        });
        logger.info('User created in DB', { firebaseUid, email, role: effectiveRole });
      }

      logger.info('User registered successfully', {
        firebaseUid,
        email,
        role: effectiveRole,
      });

      // JWT トークンを生成
      const token = jwt.sign(
        {
          user_id: user.user_id,
          email: user.email,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN_SECONDS }
      );

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          ...user,
          token,
        },
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

      // DB の重複エラー（USER_ALREADY_EXISTS）を処理
      // 注意: 通常はここに到達しない（上で既存ユーザーチェック済み）が、念のため
      if (errorMessage === 'USER_ALREADY_EXISTS') {
        logger.warn('Unexpected USER_ALREADY_EXISTS error (should have been caught earlier)', { email });
        return res.status(400).json({
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

        // Provide user-friendly error messages
        if (errorCode === 'auth/id-token-expired') {
          throw new Error('ログイントークンの有効期限が切れています。再度ログインしてください。');
        } else if (errorCode === 'auth/id-token-revoked') {
          throw new Error('ログイントークンが無効化されました。再度ログインしてください。');
        } else if (errorCode === 'auth/argument-error') {
          throw new Error('無効なログイントークンです。再度ログインしてください。');
        } else {
          throw new Error(`ログイン認証エラー: ${errorMessage}。Firebase設定を確認してください。`);
        }
      }
    }

    // Check if user exists in our DB
    const user = await userService.getUserById(firebaseUid);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found, please register' });
    }

    // Update last login
    await userService.updateLastLogin(firebaseUid);

    // JWT トークンを生成
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN_SECONDS }
    );

    // Return user data including role for frontend navigation
    return res.status(200).json({
      success: true,
      message: 'User logged in successfully',
      data: {
        user_id: user.user_id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        avatar_url: user.avatar_url,
        token,
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
   * @desc    配送先住所を更新
   * @route   PUT /api/users/me/address
   * @access  Private
   * @note    ユーザーが配送先住所を登録・更新するためのエンドポイント
   */
  updateAddress = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ success: false, message: '認証が必要です' });
    }

    const { postal_code, prefecture, city, address_line1, address_line2 } = req.body as {
      postal_code: string;
      prefecture: string;
      city: string;
      address_line1: string;
      address_line2?: string;
    };

    // バリデーション
    if (!postal_code || !prefecture || !city || !address_line1) {
      return res.status(400).json({
        success: false,
        message: '郵便番号、都道府県、市区町村、番地は必須です',
      });
    }

    // 郵便番号の形式チェック（xxx-xxxx または xxxxxxx）
    const postalCodeRegex = /^\d{3}-?\d{4}$/;
    if (!postalCodeRegex.test(postal_code)) {
      return res.status(400).json({
        success: false,
        message: '郵便番号の形式が正しくありません（例: 123-4567）',
      });
    }

    const profile = await userService.updateAddress(userId, {
      postal_code,
      prefecture,
      city,
      address_line1,
      address_line2,
    });

    return res.status(200).json({
      success: true,
      data: profile,
      message: '配送先住所を更新しました',
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
   * 注意点:
   *   - DB に admin ユーザーが存在するか確認
   *   - Firebase に INITIAL_ADMIN_EMAIL ユーザーが存在するか確認
   *   - どちらかに存在する場合は hasAdmin = true を返す
   */
  checkAdminExists = asyncHandler(async (_req: Request, res: Response) => {
    const useMockAuth = process.env.USE_MOCK_AUTH === 'true';

    // DB に admin ユーザーが存在するか確認
    const hasAdminInDb = await userService.hasAdminUser();

    // Mock認証モードの場合、DBのみチェック
    if (useMockAuth) {
      logger.info('checkAdminExists (mock mode)', { hasAdminInDb });
      return res.status(200).json({
        success: true,
        data: {
          hasAdmin: hasAdminInDb,
        },
      });
    }

    // 本番認証モード: Firebase にも確認
    let hasAdminInFirebase = false;
    const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL || '';

    if (initialAdminEmail) {
      try {
        const auth = admin.auth();
        await auth.getUserByEmail(initialAdminEmail);
        // ユーザーが存在する場合
        hasAdminInFirebase = true;
        logger.info('Admin user exists in Firebase', { email: initialAdminEmail });
      } catch (error: unknown) {
        const errorCode = error && typeof error === 'object' && 'code' in error
          ? (error as { code: string }).code
          : undefined;
        if (errorCode === 'auth/user-not-found') {
          // ユーザーが存在しない場合
          hasAdminInFirebase = false;
          logger.info('Admin user does not exist in Firebase', { email: initialAdminEmail });
        } else {
          // その他のエラー（権限エラーなど）はセキュリティのため true とする
          logger.error('Error checking admin in Firebase', {
            error: error instanceof Error ? error.message : 'Unknown',
            errorCode,
          });
          hasAdminInFirebase = true;
        }
      }
    }

    const hasAdmin = hasAdminInDb || hasAdminInFirebase;

    logger.info('checkAdminExists result', {
      hasAdminInDb,
      hasAdminInFirebase,
      hasAdmin,
      initialAdminEmail: initialAdminEmail ? '***' : '(not set)',
    });

    return res.status(200).json({
      success: true,
      data: {
        hasAdmin,
      },
    });
  });

  /**
   * @desc    Send password reset email
   * @route   POST /api/auth/forgot-password
   * @access  Public
   * 目的: パスワードリセットメールを送信
   * 注意点:
   *   - Firebase Auth の sendPasswordResetEmail を使用
   *   - ユーザーが存在しない場合もセキュリティのため成功メッセージを返す
   */
  forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    logger.info('Password reset requested', { email });

    try {
      // Firebase Auth でパスワードリセットリンクを生成
      await admin.auth().generatePasswordResetLink(email);

      logger.info('Password reset link generated', { email });

      // TODO: 本番環境では、ここでメール送信サービス（SendGrid, SES等）を使用してメールを送信
      // 現在はFirebaseが自動的にメールを送信するので、リンク生成成功 = メール送信成功

      return res.status(200).json({
        success: true,
        message: 'パスワードリセットメールを送信しました。メールをご確認ください。',
      });
    } catch (error: unknown) {
      const firebaseError = error as { code?: string; message?: string };

      // ユーザーが存在しない場合もセキュリティのため成功メッセージを返す
      // これにより、攻撃者がメールアドレスの存在確認に使用することを防ぐ
      if (firebaseError.code === 'auth/user-not-found') {
        logger.warn('Password reset requested for non-existent user', { email });
        return res.status(200).json({
          success: true,
          message: 'パスワードリセットメールを送信しました。メールをご確認ください。',
        });
      }

      logger.error('Failed to send password reset email', {
        email,
        error: firebaseError.message,
        code: firebaseError.code,
      });

      return res.status(500).json({
        success: false,
        message: 'パスワードリセットメールの送信に失敗しました。しばらく時間をおいて再度お試しください。',
      });
    }
  });
}

export default new UserController();
