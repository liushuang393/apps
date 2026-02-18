import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { apiKeyAuth, optionalApiKeyAuth, AuthenticatedRequest } from '../../../middleware/auth';

// Mock dependencies
jest.mock('../../../config/database', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { pool } from '../../../config/database';
import { logger } from '../../../utils/logger';

const mockPool = pool as jest.Mocked<typeof pool>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Auth Middleware', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const mockDeveloperRow = {
    id: 'dev-123',
    email: 'test@example.com',
    api_key_hash: 'hashed-key',
    test_mode: true,
    stripe_account_id: 'acct_123',
    webhook_secret: 'whsec_123',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    
    mockRequest = {
      headers: {},
      ip: '127.0.0.1',
    };
    
    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };
    
    mockNext = jest.fn();
    
    jest.clearAllMocks();
  });

  describe('apiKeyAuth', () => {
    describe('when API key is missing', () => {
      it('should return 401 with missing API key error', async () => {
        mockRequest.headers = {};

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'unauthorized',
            message: 'Missing API key. Include x-api-key header.',
            type: 'authentication_error',
          },
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should not call next when API key is missing', async () => {
        mockRequest.headers = {};

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('when API key is invalid', () => {
      it('should return 401 with invalid API key error', async () => {
        mockRequest.headers = { 'x-api-key': 'invalid-key' };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'unauthorized',
            message: 'Invalid API key.',
            type: 'authentication_error',
          },
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should log warning with key prefix and IP', async () => {
        const apiKey = 'fpb_test_abc123xyz789';
        mockRequest = {
          headers: { 'x-api-key': apiKey },
          ip: '192.168.1.1',
        };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.warn).toHaveBeenCalledWith('Invalid API key attempt', {
          keyPrefix: 'fpb_tes...',
          ip: '192.168.1.1',
        });
      });

      it('should query database with hashed API key', async () => {
        const apiKey = 'fpb_test_secret123';
        const expectedHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('SELECT id, email'),
          [expectedHash]
        );
      });
    });

    describe('when API key is valid', () => {
      it('should attach developer to request', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [mockDeveloperRow] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect((mockRequest as AuthenticatedRequest).developer).toEqual({
          id: 'dev-123',
          email: 'test@example.com',
          stripeAccountId: 'acct_123',
          webhookSecret: 'whsec_123',
          testMode: true,
          defaultSuccessUrl: null,
          defaultCancelUrl: null,
          defaultLocale: 'auto',
          defaultCurrency: 'usd',
          defaultPaymentMethods: ['card'],
          callbackUrl: null,
          callbackSecret: null,
          companyName: null,
          stripeSecretKeyEnc: null,
          stripePublishableKey: null,
          stripeWebhookEndpointSecret: null,
          stripeConfigured: false,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        });
      });

      it('should call next on successful authentication', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [mockDeveloperRow] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
      });

      it('should log debug message with developer info', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [mockDeveloperRow] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.debug).toHaveBeenCalledWith('API key authenticated', {
          developerId: 'dev-123',
          testMode: true,
        });
      });

      it('should handle developer with null stripeAccountId', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        const developerWithoutStripe = {
          ...mockDeveloperRow,
          stripe_account_id: null,
        };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [developerWithoutStripe] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect((mockRequest as AuthenticatedRequest).developer?.stripeAccountId).toBeNull();
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle developer with null webhookSecret', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        const developerWithoutWebhook = {
          ...mockDeveloperRow,
          webhook_secret: null,
        };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [developerWithoutWebhook] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect((mockRequest as AuthenticatedRequest).developer?.webhookSecret).toBeNull();
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle live mode developer', async () => {
        const apiKey = 'fpb_live_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        const liveDeveloper = {
          ...mockDeveloperRow,
          test_mode: false,
        };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [liveDeveloper] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect((mockRequest as AuthenticatedRequest).developer?.testMode).toBe(false);
        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('when database error occurs', () => {
      it('should return 500 with internal error', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'internal_error',
            message: 'Authentication failed.',
            type: 'api_error',
          },
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should log error with error details', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        const dbError = new Error('Database connection failed');
        (mockPool.query as jest.Mock).mockRejectedValue(dbError);

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.error).toHaveBeenCalledWith('Error authenticating API key', {
          error: dbError,
        });
      });

      it('should handle timeout errors', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        const timeoutError = new Error('Query timeout');
        (mockPool.query as jest.Mock).mockRejectedValue(timeoutError);

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(mockLogger.error).toHaveBeenCalledWith('Error authenticating API key', {
          error: timeoutError,
        });
      });
    });

    describe('API key hashing', () => {
      it('should use SHA-256 hash for API key lookup', async () => {
        const apiKey = 'fpb_test_uniquekey123';
        const expectedHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

        await apiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        const queryCall = (mockPool.query as jest.Mock).mock.calls[0];
        expect(queryCall[1][0]).toBe(expectedHash);
      });

      it('should produce different hashes for different API keys', async () => {
        const hashes: string[] = [];
        const apiKeys = ['fpb_test_key1', 'fpb_test_key2', 'fpb_test_key3'];

        for (const apiKey of apiKeys) {
          mockRequest.headers = { 'x-api-key': apiKey };
          (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

          await apiKeyAuth(
            mockRequest as AuthenticatedRequest,
            mockResponse as Response,
            mockNext
          );

          const queryCall = (mockPool.query as jest.Mock).mock.calls[hashes.length];
          hashes.push(queryCall[1][0]);
        }

        // All hashes should be unique
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(apiKeys.length);
      });
    });
  });

  describe('optionalApiKeyAuth', () => {
    describe('when API key is not provided', () => {
      it('should call next without authentication', async () => {
        mockRequest.headers = {};

        await optionalApiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
        expect(mockPool.query).not.toHaveBeenCalled();
      });

      it('should not attach developer to request', async () => {
        mockRequest.headers = {};

        await optionalApiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect((mockRequest as AuthenticatedRequest).developer).toBeUndefined();
      });
    });

    describe('when API key is provided and valid', () => {
      it('should authenticate and call next', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [mockDeveloperRow] });

        await optionalApiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
        expect((mockRequest as AuthenticatedRequest).developer).toBeDefined();
      });

      it('should attach developer info to request', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [mockDeveloperRow] });

        await optionalApiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect((mockRequest as AuthenticatedRequest).developer).toEqual({
          id: 'dev-123',
          email: 'test@example.com',
          stripeAccountId: 'acct_123',
          webhookSecret: 'whsec_123',
          testMode: true,
          defaultSuccessUrl: null,
          defaultCancelUrl: null,
          defaultLocale: 'auto',
          defaultCurrency: 'usd',
          defaultPaymentMethods: ['card'],
          callbackUrl: null,
          callbackSecret: null,
          companyName: null,
          stripeSecretKeyEnc: null,
          stripePublishableKey: null,
          stripeWebhookEndpointSecret: null,
          stripeConfigured: false,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        });
      });
    });

    describe('when API key is provided but invalid', () => {
      it('should return 401 error', async () => {
        const apiKey = 'fpb_test_invalid';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

        await optionalApiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'unauthorized',
            message: 'Invalid API key.',
            type: 'authentication_error',
          },
        });
      });
    });

    describe('when database error occurs', () => {
      it('should return 500 error', async () => {
        const apiKey = 'fpb_test_valid123';
        mockRequest.headers = { 'x-api-key': apiKey };
        (mockPool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

        await optionalApiKeyAuth(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'internal_error',
            message: 'Authentication failed.',
            type: 'api_error',
          },
        });
      });
    });
  });

  describe('AuthenticatedRequest interface', () => {
    it('should allow optional developer property', async () => {
      const apiKey = 'fpb_test_valid123';
      mockRequest.headers = { 'x-api-key': apiKey };
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [mockDeveloperRow] });

      await apiKeyAuth(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext
      );

      const authenticatedReq = mockRequest as AuthenticatedRequest;
      expect(authenticatedReq.developer?.id).toBe('dev-123');
      expect(authenticatedReq.developer?.email).toBe('test@example.com');
      expect(authenticatedReq.developer?.testMode).toBe(true);
      expect(authenticatedReq.developer?.stripeAccountId).toBe('acct_123');
      expect(authenticatedReq.developer?.webhookSecret).toBe('whsec_123');
      expect(authenticatedReq.developer?.createdAt).toBeInstanceOf(Date);
      expect(authenticatedReq.developer?.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('SQL Query', () => {
    it('should query developers table with correct columns', async () => {
      const apiKey = 'fpb_test_valid123';
      mockRequest.headers = { 'x-api-key': apiKey };
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await apiKeyAuth(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext
      );

      const queryCall = (mockPool.query as jest.Mock).mock.calls[0][0];
      expect(queryCall).toContain('SELECT');
      expect(queryCall).toContain('id');
      expect(queryCall).toContain('email');
      expect(queryCall).toContain('api_key_hash');
      expect(queryCall).toContain('test_mode');
      expect(queryCall).toContain('stripe_account_id');
      expect(queryCall).toContain('webhook_secret');
      expect(queryCall).toContain('created_at');
      expect(queryCall).toContain('updated_at');
      expect(queryCall).toContain('FROM developers');
      expect(queryCall).toContain('WHERE api_key_hash = $1');
    });
  });
});
