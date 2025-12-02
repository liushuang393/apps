/**
 * 認証フローの包括的単体テスト
 * 目的: 登録・ログイン機能（管理者・顧客）の品質を保証する
 * I/O: Express の Request/Response をモックして検証する
 * 注意点: モック認証と本番認証の両方をテストする
 */

import { Request, Response } from 'express';
import userController from '../../../src/controllers/user.controller';
import userService from '../../../src/services/user.service';
import { UserRole } from '../../../src/models/user.entity';

// 依存モジュールのモック設定
jest.mock('../../../src/services/user.service');

// Firebase Admin のモック（setup.tsで既にモックされているが、ここでも明示的に設定）
const mockCreateUser = jest.fn();
const mockDeleteUser = jest.fn();
const mockVerifyIdToken = jest.fn();

jest.mock('firebase-admin', () => {
  return {
    initializeApp: jest.fn(),
    credential: {
      cert: jest.fn(),
    },
    auth: jest.fn(() => ({
      createUser: mockCreateUser,
      deleteUser: mockDeleteUser,
      verifyIdToken: mockVerifyIdToken,
    })),
  };
});

// asyncHandler でラップされたコントローラを安全に実行するためのヘルパー
const runHandler = async (
  handler: (req: Request, res: Response, next: any) => void,
  req: Request,
  res: Response,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    
    const next: any = ((err?: unknown) => {
      if (err) {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    }) as any;

    const originalJson = (res as Response).json?.bind(res as Response);
    (res as Response).json = ((body: unknown) => {
      if (originalJson) {
        originalJson(body as never);
      }
      if (!resolved) {
        resolved = true;
        resolve();
      }
      return res as Response;
    }) as Response['json'];

    try {
      handler(req, res, next);
      // Give async handler time to complete
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 100);
    } catch (err) {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    }
  });
};

describe('認証フロー包括的テスト', () => {
  let mockRequest: Partial<Request>;
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
    mockCreateUser.mockClear();
    mockDeleteUser.mockClear();
    mockVerifyIdToken.mockClear();
    process.env.USE_MOCK_AUTH = 'false';
    process.env.NODE_ENV = 'test';
  });

  describe('顧客登録', () => {
    it('顧客として新規登録が成功する', async () => {
      const mockUser = {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.CUSTOMER,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        email: 'customer@example.com',
        password: 'password123',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      };

      mockCreateUser.mockResolvedValue({
        uid: 'customer-uid-123',
        email: 'customer@example.com',
      });

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseObject).toMatchObject({
        success: true,
        message: 'User registered successfully',
      });
      expect(userService.createUser).toHaveBeenCalledWith({
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        role: UserRole.CUSTOMER,
      });
    });

    it('既存のメールアドレスで登録しようとすると409エラーを返す', async () => {
      mockRequest.body = {
        email: 'existing@example.com',
        password: 'password123',
        display_name: 'Existing User',
      };

      const error: any = new Error('Email already exists');
      error.code = 'auth/email-already-exists';
      mockCreateUser.mockRejectedValue(error);

      await expect(
        runHandler(
          userController.register,
          mockRequest as Request,
          mockResponse as Response,
        )
      ).rejects.toThrow();

      expect(mockDeleteUser).not.toHaveBeenCalled();
    });
  });

  describe('管理者登録', () => {
    it('管理者として新規登録が成功する', async () => {
      const mockAdminUser = {
        user_id: 'admin-uid-123',
        email: 'admin@example.com',
        display_name: 'Test Admin',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.ADMIN,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        email: 'admin@example.com',
        password: 'admin123',
        display_name: 'Test Admin',
        role: UserRole.ADMIN,
      };

      mockCreateUser.mockResolvedValue({
        uid: 'admin-uid-123',
        email: 'admin@example.com',
      });

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockAdminUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(userService.createUser).toHaveBeenCalledWith({
        user_id: 'admin-uid-123',
        email: 'admin@example.com',
        display_name: 'Test Admin',
        role: UserRole.ADMIN,
      });
    });

    it('INITIAL_ADMIN_EMAILで管理者として登録される', async () => {
      process.env.INITIAL_ADMIN_EMAIL = 'initial-admin@example.com';

      const mockAdminUser = {
        user_id: 'initial-admin-uid',
        email: 'initial-admin@example.com',
        display_name: 'Initial Admin',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.ADMIN,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        email: 'initial-admin@example.com',
        password: 'admin123',
        display_name: 'Initial Admin',
      };

      mockCreateUser.mockResolvedValue({
        uid: 'initial-admin-uid',
        email: 'initial-admin@example.com',
      });

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockAdminUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(userService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.ADMIN,
        })
      );
    });
  });

  describe('顧客ログイン', () => {
    it('顧客としてログインが成功する', async () => {
      const mockUser = {
        user_id: 'customer-uid-123',
        email: 'customer@example.com',
        display_name: 'Test Customer',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.CUSTOMER,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'valid-customer-token',
      };

      mockVerifyIdToken.mockResolvedValue({
        uid: 'customer-uid-123',
        email: 'customer@example.com',
      });

      (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);
      (userService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await runHandler(
        userController.login,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(responseObject).toMatchObject({
        success: true,
        message: 'User logged in successfully',
        data: expect.objectContaining({
          user_id: 'customer-uid-123',
          email: 'customer@example.com',
          role: UserRole.CUSTOMER,
        }),
      });
      expect(userService.updateLastLogin).toHaveBeenCalledWith('customer-uid-123');
    });

    it('存在しないユーザーでログインしようとすると404エラーを返す', async () => {
      mockRequest.body = {
        firebase_token: 'non-existent-token',
      };

      mockVerifyIdToken.mockResolvedValue({
        uid: 'non-existent-uid',
        email: 'nonexistent@example.com',
      });

      (userService.getUserById as jest.Mock).mockResolvedValue(null);

      await runHandler(
        userController.login,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(responseObject).toMatchObject({
        success: false,
        message: 'User not found, please register',
      });
    });
  });

  describe('管理者ログイン', () => {
    it('管理者としてログインが成功する', async () => {
      const mockAdminUser = {
        user_id: 'admin-uid-123',
        email: 'admin@example.com',
        display_name: 'Test Admin',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.ADMIN,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'valid-admin-token',
      };

      mockVerifyIdToken.mockResolvedValue({
        uid: 'admin-uid-123',
        email: 'admin@example.com',
      });

      (userService.getUserById as jest.Mock).mockResolvedValue(mockAdminUser);
      (userService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await runHandler(
        userController.login,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(responseObject).toMatchObject({
        success: true,
        message: 'User logged in successfully',
        data: expect.objectContaining({
          user_id: 'admin-uid-123',
          email: 'admin@example.com',
          role: UserRole.ADMIN,
        }),
      });
    });
  });

  describe('モック認証モード', () => {
    beforeEach(() => {
      process.env.USE_MOCK_AUTH = 'true';
    });

    it('モック認証で顧客として登録できる', async () => {
      const mockUser = {
        user_id: expect.any(String),
        email: 'mock-customer@example.com',
        display_name: 'Mock Customer',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.CUSTOMER,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        email: 'mock-customer@example.com',
        password: 'password123',
        display_name: 'Mock Customer',
        role: UserRole.CUSTOMER,
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(userService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'mock-customer@example.com',
          role: UserRole.CUSTOMER,
        })
      );
    });

    it('モック認証で管理者として登録できる', async () => {
      const mockAdminUser = {
        user_id: expect.any(String),
        email: 'mock-admin@example.com',
        display_name: 'Mock Admin',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.ADMIN,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        email: 'mock-admin@example.com',
        password: 'admin123',
        display_name: 'Mock Admin',
        role: UserRole.ADMIN,
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(null);
      (userService.createUser as jest.Mock).mockResolvedValue(mockAdminUser);

      await runHandler(
        userController.register,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(userService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'mock-admin@example.com',
          role: UserRole.ADMIN,
        })
      );
    });

    it('モック認証でログインできる', async () => {
      const mockUser = {
        user_id: expect.any(String),
        email: 'mock-user@example.com',
        display_name: 'Mock User',
        avatar_url: null,
        fcm_token: null,
        role: UserRole.CUSTOMER,
        notification_enabled: true,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockRequest.body = {
        firebase_token: 'mock_mock-user@example.com',
      };

      (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);
      (userService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await runHandler(
        userController.login,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(responseObject).toMatchObject({
        success: true,
        message: 'User logged in successfully',
      });
    });
  });
});
