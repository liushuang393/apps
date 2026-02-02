import { Response, NextFunction } from 'express';
import { loadUser, requireRole, requireAdmin, requireOwnerOrAdmin, AuthorizedRequest } from '../../../src/middleware/role.middleware';
import { pool } from '../../../src/config/database.config';
import { UserRole } from '../../../src/models/user.entity';

/**
 * role.middleware の単体テスト
 * 目的: DB からのユーザ取得、ロール別アクセス制御(requireRole/requireAdmin/requireOwnerOrAdmin)の挙動を検証する
 * I/O: AuthorizedRequest/Response/NextFunction をモックし、DB アクセスは pool.query のモックで代替する
 * 注意点: 例外発生時は 500 を返し、認証・権限不足時は 401/403 を返すことを確認する
 */

jest.mock('../../../src/config/database.config', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockPool = pool as unknown as { query: jest.Mock };

const createMockResponse = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('role.middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadUser', () => {
    it('should return 401 when req.user is missing', async () => {
      const req = {} as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      await loadUser(req, res, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 404 when user not found in database', async () => {
      const req = { user: { uid: 'uid-1', email: 'user@example.com', email_verified: true } } as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      mockPool.query.mockResolvedValue({ rows: [] });

      await loadUser(req, res, next as NextFunction);

      expect(mockPool.query).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'USER_NOT_FOUND',
        message: 'User not found in database',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should attach dbUser and call next when user exists', async () => {
      const req = { user: { uid: 'uid-1', email: 'user@example.com', email_verified: true } } as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      mockPool.query.mockResolvedValue({
        rows: [
          {
            user_id: 'uid-1',
            email: 'user@example.com',
            role: UserRole.ADMIN,
            display_name: 'Admin',
          },
        ],
      });

      await loadUser(req, res, next as NextFunction);

      expect(req.dbUser).toEqual({
        user_id: 'uid-1',
        email: 'user@example.com',
        role: UserRole.ADMIN,
        display_name: 'Admin',
      });
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('should return 401 when dbUser is missing', () => {
      const middleware = requireRole(UserRole.ADMIN);
      const req = {} as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'UNAUTHORIZED',
        message: 'User information not loaded',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when role not allowed', () => {
      const middleware = requireRole(UserRole.ADMIN);
      const req = {
        dbUser: {
          user_id: 'uid-1',
          email: 'user@example.com',
          role: UserRole.CUSTOMER,
          display_name: 'User',
        },
      } as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next when role is allowed', () => {
      const middleware = requireRole(UserRole.ADMIN, UserRole.CUSTOMER);
      const req = {
        dbUser: {
          user_id: 'uid-1',
          email: 'user@example.com',
          role: UserRole.ADMIN,
          display_name: 'Admin',
        },
      } as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    it('should delegate to requireRole(UserRole.ADMIN)', () => {
      const req = {
        dbUser: {
          user_id: 'uid-1',
          email: 'user@example.com',
          role: UserRole.ADMIN,
          display_name: 'Admin',
        },
      } as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      requireAdmin(req, res, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireOwnerOrAdmin', () => {
    it('should allow access when user is admin', () => {
      const middleware = requireOwnerOrAdmin('userId');
      const req = {
        dbUser: {
          user_id: 'admin-1',
          email: 'admin@example.com',
          role: UserRole.ADMIN,
          display_name: 'Admin',
        },
        params: { userId: 'user-1' },
      } as unknown as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('should allow access when user is owner', () => {
      const middleware = requireOwnerOrAdmin('userId');
      const req = {
        dbUser: {
          user_id: 'user-1',
          email: 'user@example.com',
          role: UserRole.CUSTOMER,
          display_name: 'User',
        },
        params: { userId: 'user-1' },
      } as unknown as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('should return 401 when dbUser is missing', () => {
      const middleware = requireOwnerOrAdmin('userId');
      const req = { params: { userId: 'user-1' } } as unknown as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'UNAUTHORIZED',
        message: 'User information not loaded',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when user is neither owner nor admin', () => {
      const middleware = requireOwnerOrAdmin('userId');
      const req = {
        dbUser: {
          user_id: 'user-2',
          email: 'user2@example.com',
          role: UserRole.CUSTOMER,
          display_name: 'User2',
        },
        params: { userId: 'user-1' },
      } as unknown as AuthorizedRequest;
      const res = createMockResponse();
      const next = jest.fn();

      middleware(req, res, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'FORBIDDEN',
        message: 'You can only access your own resources',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
