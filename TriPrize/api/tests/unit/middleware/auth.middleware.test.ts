import { Request, Response, NextFunction } from 'express';
import {
  authenticate,
  optionalAuthenticate,
  requireEmailVerification,
  AuthenticatedRequest,
} from '../../../src/middleware/auth.middleware';

/**
 * auth.middleware の単体テスト
 * 目的: 認証ヘッダの検証、Firebase トークン検証結果の取り扱い、メール認証必須条件の挙動を確認する
 * I/O: Request/Response/NextFunction をモックし、実際の Firebase 連携は tests/setup.ts のモックに依存
 * 注意点: USE_MOCK_AUTH=false 前提で、トークン不備時は 401 を返し、optionalAuthenticate は常に next を継続させる
 */

const createMockResponse = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('auth.middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

	  describe('authenticate', () => {
	    it('should return 401 when Authorization header is missing', async () => {
	      const req = { headers: {} } as unknown as AuthenticatedRequest;
	      const res = createMockResponse();
	      const next = jest.fn();

	      await authenticate(req, res, next as NextFunction);

	      expect(res.status).toHaveBeenCalledWith(401);
	      expect(res.json).toHaveBeenCalledWith({
	        error: 'UNAUTHORIZED',
	        message: 'Missing or invalid authorization header',
	      });
	      expect(next).not.toHaveBeenCalled();
	    });
	  });

  describe('optionalAuthenticate', () => {
    it('should call next even when Authorization header is missing', () => {
      const req = { headers: {} } as Request;
      const res = createMockResponse();
      const next = jest.fn();

      optionalAuthenticate(req, res, next as NextFunction);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

	  describe('requireEmailVerification', () => {
	    it('should return 401 when user is not attached to request', () => {
	      const req = {} as AuthenticatedRequest;
	      const res = createMockResponse();
	      const next = jest.fn();

	      requireEmailVerification(req, res, next as NextFunction);

	      expect(res.status).toHaveBeenCalledWith(401);
	      expect(res.json).toHaveBeenCalledWith({
	        error: 'UNAUTHORIZED',
	        message: 'Authentication required',
	      });
	      expect(next).not.toHaveBeenCalled();
	    });

	    it('should return 403 when email is not verified', () => {
	      const req = {
	        user: {
	          uid: 'uid-1',
	          email: 'user@example.com',
	          email_verified: false,
	        },
	      } as AuthenticatedRequest;
	      const res = createMockResponse();
	      const next = jest.fn();

	      requireEmailVerification(req, res, next as NextFunction);

	      expect(res.status).toHaveBeenCalledWith(403);
	      expect(res.json).toHaveBeenCalledWith({
	        error: 'EMAIL_NOT_VERIFIED',
	        message: 'Email verification required',
	      });
	      expect(next).not.toHaveBeenCalled();
	    });
	  });
});
