import { Request, Response, NextFunction } from 'express';
import userController from '../../../src/controllers/user.controller';
import userService from '../../../src/services/user.service';
import { AuthenticatedRequest } from '../../../src/middleware/auth.middleware';

/**
 * UserController の単体テスト
 * 目的: Firebase 認証およびユーザー登録/ログイン周りの品質を保証する
 * I/O: Express の Request/Response/NextFunction をモックして検証する
 * 注意点: controller は asyncHandler でラップされているため、テスト側でハンドラ完了を Promise で待機する
 */

// 依存モジュールのモック設定（DB アクセスのみモックし、ロガーは実実装を使用）
jest.mock('../../../src/services/user.service');

// asyncHandler でラップされたコントローラを安全に実行するためのヘルパー
const runHandler = async (
  handler: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
  res: Response,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const next: NextFunction = ((err?: unknown) => {
      if (err) {
        reject(err);
      }
      // 通常パスでは asyncHandler は next を呼ばない
    }) as NextFunction;

    // レスポンス送信時にテストを完了させるため json をフック
    const originalJson = (res as Response).json?.bind(res as Response);
    (res as Response).json = ((body: unknown) => {
      if (originalJson) {
        originalJson(body as never);
      }
      resolve();
      return res as Response;
    }) as Response['json'];

    handler(req, res, next);
  });
};

describe('UserController', () => {
  let mockRequest: Partial<Request | AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let responseObject: Record<string, unknown>;

  beforeEach(() => {
    mockRequest = {};
    responseObject = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((result) => {
        responseObject = result;
        return mockResponse as Response;
      }),
    };
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create a new user successfully', async () => {
      const mockUser = {
        user_id: 'test-uid-123',
        email: 'test@example.com',
        display_name: 'Test User',
        avatar_url: null,
        fcm_token: null,
        role: 'customer' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        user_id: 'test-uid-123',
        email: 'test@example.com',
        display_name: 'Test User',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockUser);

      await runHandler(
        userController.createUser,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseObject).toEqual({
        success: true,
        user_id: 'test-uid-123',
        message: 'User created successfully',
      });
    });

    it('should return existing user if already exists (idempotency)', async () => {
      const mockUser = {
        user_id: 'test-uid-123',
        email: 'test@example.com',
        display_name: 'Test User',
        avatar_url: null,
        fcm_token: null,
        role: 'customer' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        user_id: 'test-uid-123',
        email: 'test@example.com',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);

      await runHandler(
        userController.createUser,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(responseObject).toEqual({
        success: true,
        user_id: 'test-uid-123',
        message: 'User already exists',
      });
      expect(userService.createUser).not.toHaveBeenCalled();
    });
  });

  describe('updateLastLogin', () => {
    it('should update last login successfully', async () => {
      const mockUser = {
        user_id: 'test-uid-123',
        email: 'test@example.com',
        display_name: 'Test User',
        avatar_url: null,
        fcm_token: null,
        role: 'customer' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.params = { id: 'test-uid-123' };

      (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);
      (userService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await runHandler(
        userController.updateLastLogin,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(responseObject).toEqual({
        success: true,
        message: 'Last login updated',
      });
      expect(userService.updateLastLogin).toHaveBeenCalledWith('test-uid-123');
    });

    it('should return 404 if user not found', async () => {
      mockRequest.params = { id: 'non-existent-uid' };

      (userService.getUserById as jest.Mock).mockResolvedValue(null);

      await runHandler(
        userController.updateLastLogin,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(responseObject).toEqual({
        success: false,
        message: 'User not found',
      });
      expect(userService.updateLastLogin).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    beforeEach(() => {
      process.env.USE_MOCK_AUTH = 'false'; // Test with real Firebase auth
    });

    it('should register a new user with Firebase authentication', async () => {
      const mockUser = {
        user_id: 'valid-firebase-token',
        email: 'valid-firebase-token@example.com',
        display_name: 'New User',
        avatar_url: null,
        fcm_token: null,
        role: 'customer' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'valid-firebase-token',
        email: 'valid-firebase-token@example.com',
        display_name: 'New User',
      };

      // Firebase Admin is already mocked in setup.ts
      // It will return { uid: 'valid-firebase-token', email: 'valid-firebase-token@example.com' }

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseObject).toEqual({
        success: true,
        message: 'User registered successfully',
        data: mockUser,
      });
    });

    it('should return 409 if user already registered', async () => {
      const mockUser = {
        user_id: 'existing-token',
        email: 'existing-token@example.com',
        display_name: 'Existing User',
        avatar_url: null,
        fcm_token: null,
        role: 'customer' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'existing-token',
        email: 'existing-token@example.com',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(responseObject).toEqual({
        success: false,
        message: 'User already registered',
      });
      expect(userService.createUser).not.toHaveBeenCalled();
    });

    it('should register admin user with role parameter', async () => {
      const mockAdminUser = {
        user_id: 'admin-token',
        email: 'admin-token@example.com',
        display_name: 'Admin User',
        avatar_url: null,
        fcm_token: null,
        role: 'admin' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'admin-token',
        email: 'admin-token@example.com',
        display_name: 'Admin User',
        role: 'admin',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockAdminUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(userService.createUser).toHaveBeenCalledWith({
        user_id: 'admin-token',
        email: 'admin-token@example.com',
        display_name: 'Admin User',
        role: 'admin',
      });
    });
  });

  describe('login', () => {
    beforeEach(() => {
      process.env.USE_MOCK_AUTH = 'false';
    });

    it('should login user successfully', async () => {
      const mockUser = {
        user_id: 'login-token',
        email: 'login-token@example.com',
        display_name: 'Test User',
        avatar_url: null,
        fcm_token: null,
        role: 'customer' as const,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'login-token',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);
      (userService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await runHandler(
        userController.login,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(responseObject).toEqual({
        success: true,
        message: 'User logged in successfully',
        data: mockUser,
      });
      expect(userService.updateLastLogin).toHaveBeenCalledWith('login-token');
    });

    it('should return 404 if user not found', async () => {
      mockRequest.body = {
        firebase_token: 'non-existent-token',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(null);

      await runHandler(
        userController.login,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(responseObject).toEqual({
        success: false,
        message: 'User not found, please register',
      });
    });
  });
});

