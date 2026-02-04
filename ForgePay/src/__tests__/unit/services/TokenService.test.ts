import jwt from 'jsonwebtoken';
import { TokenService, TokenPayload } from '../../../services/TokenService';

// Mock dependencies
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-jti'),
}));

jest.mock('jsonwebtoken', () => {
  // Custom JWT error classes for testing (defined inside factory function)
  class MockTokenExpiredError extends Error {
    constructor() {
      super('jwt expired');
      this.name = 'TokenExpiredError';
    }
  }

  class MockJsonWebTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'JsonWebTokenError';
    }
  }

  return {
    sign: jest.fn(() => 'mock-jwt-token'),
    verify: jest.fn(),
    decode: jest.fn(),
    TokenExpiredError: MockTokenExpiredError,
    JsonWebTokenError: MockJsonWebTokenError,
  };
});

jest.mock('../../../config', () => ({
  config: {
    jwt: {
      secret: 'test-jwt-secret',
    },
  },
}));

jest.mock('../../../config/redis', () => ({
  redisClient: {
    exists: jest.fn(),
    setEx: jest.fn(),
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

import { redisClient } from '../../../config/redis';
import { logger } from '../../../utils/logger';

const mockRedisClient = redisClient as jest.Mocked<typeof redisClient>;
const mockJwtSign = jwt.sign as jest.Mock;
const mockJwtVerify = jwt.verify as jest.Mock;
const mockJwtDecode = jwt.decode as jest.Mock;

describe('TokenService', () => {
  let service: TokenService;
  const testSecret = 'test-secret';
  const testExpiration = 300; // 5 minutes

  const mockPayload: TokenPayload = {
    entitlementId: 'ent-123',
    purchaseIntentId: 'pi-456',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    jti: 'mock-uuid-jti',
  };

  beforeEach(() => {
    service = new TokenService(testSecret, testExpiration);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with custom secret and expiration', () => {
      const customService = new TokenService('custom-secret', 600);
      expect(customService).toBeDefined();
    });

    it('should use default values from config when not provided', () => {
      const defaultService = new TokenService();
      expect(defaultService).toBeDefined();
    });
  });

  describe('generateUnlockToken', () => {
    it('should generate a JWT token with correct payload', async () => {
      const token = await service.generateUnlockToken('ent-123', 'pi-456');

      expect(token).toBe('mock-jwt-token');
      expect(mockJwtSign).toHaveBeenCalledWith(
        expect.objectContaining({
          entitlementId: 'ent-123',
          purchaseIntentId: 'pi-456',
          jti: 'mock-uuid-jti',
        }),
        testSecret,
        { algorithm: 'HS256' }
      );
    });

    it('should include iat and exp timestamps in payload', async () => {
      await service.generateUnlockToken('ent-123', 'pi-456');

      const signCall = mockJwtSign.mock.calls[0];
      const payload = signCall[0];

      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBe(payload.iat + testExpiration);
    });

    it('should log token generation', async () => {
      await service.generateUnlockToken('ent-123', 'pi-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Unlock token generated',
        expect.objectContaining({
          entitlementId: 'ent-123',
          purchaseIntentId: 'pi-456',
          jti: 'mock-uuid-jti',
          expiresAt: expect.any(String),
        })
      );
    });

    it('should generate unique jti for each token', async () => {
      const { v4: mockUuidv4 } = require('uuid');
      mockUuidv4.mockReturnValueOnce('jti-1').mockReturnValueOnce('jti-2');

      await service.generateUnlockToken('ent-1', 'pi-1');
      await service.generateUnlockToken('ent-2', 'pi-2');

      expect(mockJwtSign).toHaveBeenCalledTimes(2);
      expect(mockJwtSign.mock.calls[0][0].jti).toBe('jti-1');
      expect(mockJwtSign.mock.calls[1][0].jti).toBe('jti-2');
    });
  });

  describe('verifyUnlockToken', () => {
    it('should verify and return valid token payload', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0); // Token not used
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await service.verifyUnlockToken('valid-token');

      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
      expect(result.error).toBeUndefined();
    });

    it('should verify JWT with correct algorithm', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyUnlockToken('token');

      expect(mockJwtVerify).toHaveBeenCalledWith('token', testSecret, {
        algorithms: ['HS256'],
      });
    });

    it('should return error when token has already been used', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(1); // Token already used

      const result = await service.verifyUnlockToken('used-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has already been used');
      expect(logger.warn).toHaveBeenCalledWith('Token already used', {
        jti: mockPayload.jti,
        entitlementId: mockPayload.entitlementId,
      });
    });

    it('should mark token as used after successful verification', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyUnlockToken('valid-token');

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `token:used:${mockPayload.jti}`,
        testExpiration,
        '1'
      );
    });

    it('should log successful verification', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyUnlockToken('valid-token');

      expect(logger.info).toHaveBeenCalledWith('Unlock token verified', {
        entitlementId: mockPayload.entitlementId,
        purchaseIntentId: mockPayload.purchaseIntentId,
        jti: mockPayload.jti,
      });
    });

    // Coverage: lines 124-125 - TokenExpiredError handling
    it('should return error when token is expired', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.TokenExpiredError as any)();
      });

      const result = await service.verifyUnlockToken('expired-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
      expect(logger.warn).toHaveBeenCalledWith('Token expired', {
        error: expect.any(Error),
      });
    });

    it('should return error when token signature is invalid', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.JsonWebTokenError as any)('invalid signature');
      });

      const result = await service.verifyUnlockToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
      expect(logger.warn).toHaveBeenCalledWith('Invalid token', {
        error: expect.any(Error),
      });
    });

    // Coverage: lines 139-140 - General error handling
    it('should return error for unexpected verification errors', async () => {
      const unexpectedError = new Error('Unexpected error');
      mockJwtVerify.mockImplementation(() => {
        throw unexpectedError;
      });

      const result = await service.verifyUnlockToken('token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token verification failed');
      expect(logger.error).toHaveBeenCalledWith('Token verification error', {
        error: unexpectedError,
      });
    });

    // Coverage: lines 221-223 - Redis error in isTokenUsed
    it('should fail open when Redis is unavailable for checking token usage', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockRejectedValue(new Error('Redis connection failed'));
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await service.verifyUnlockToken('token');

      // Should fail open - token verification succeeds even if Redis check fails
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
      expect(logger.error).toHaveBeenCalledWith('Error checking token usage', {
        error: expect.any(Error),
        jti: mockPayload.jti,
      });
    });

    // Coverage: line 240 - Redis error in markTokenUsed
    it('should succeed verification even when marking token as used fails', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockRejectedValue(new Error('Redis write failed'));

      const result = await service.verifyUnlockToken('token');

      // Should still succeed even if marking as used fails
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
      expect(logger.error).toHaveBeenCalledWith('Error marking token as used', {
        error: expect.any(Error),
        jti: mockPayload.jti,
      });
    });
  });

  describe('verifyUnlockTokenReadOnly', () => {
    it('should verify token without marking it as used', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);

      const result = await service.verifyUnlockTokenReadOnly('valid-token');

      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();
    });

    // Coverage: line 162 - Token already used in read-only mode
    it('should return error when token has been used in read-only mode', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(1);

      const result = await service.verifyUnlockTokenReadOnly('used-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has already been used');
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();
    });

    // Coverage: lines 173-175 - TokenExpiredError in read-only mode
    it('should return error when token is expired in read-only mode', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.TokenExpiredError as any)();
      });

      const result = await service.verifyUnlockTokenReadOnly('expired-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
    });

    // Coverage: lines 180-184 - JsonWebTokenError in read-only mode
    it('should return error when token is invalid in read-only mode', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.JsonWebTokenError as any)('malformed token');
      });

      const result = await service.verifyUnlockTokenReadOnly('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    // Coverage: lines 187-190 - General error in read-only mode
    it('should return generic error for unexpected errors in read-only mode', async () => {
      const unexpectedError = new Error('Something unexpected');
      mockJwtVerify.mockImplementation(() => {
        throw unexpectedError;
      });

      const result = await service.verifyUnlockTokenReadOnly('token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token verification failed');
    });

    it('should check token usage in read-only verification', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);

      await service.verifyUnlockTokenReadOnly('token');

      expect(mockRedisClient.exists).toHaveBeenCalledWith(`token:used:${mockPayload.jti}`);
    });
  });

  describe('decodeToken', () => {
    it('should decode token without verification', () => {
      mockJwtDecode.mockReturnValue(mockPayload);

      const result = service.decodeToken('any-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    // Coverage: line 205 - Error in decodeToken
    it('should return null when decode throws an error', () => {
      mockJwtDecode.mockImplementation(() => {
        throw new Error('Cannot decode');
      });

      const result = service.decodeToken('malformed-token');

      expect(result).toBeNull();
    });

    it('should return null when token is null', () => {
      mockJwtDecode.mockReturnValue(null);

      const result = service.decodeToken('null-token');

      expect(result).toBeNull();
    });

    it('should decode expired tokens without error', () => {
      const expiredPayload = {
        ...mockPayload,
        exp: Math.floor(Date.now() / 1000) - 1000, // Expired
      };
      mockJwtDecode.mockReturnValue(expiredPayload);

      const result = service.decodeToken('expired-token');

      expect(result).toEqual(expiredPayload);
    });
  });

  describe('token expiration', () => {
    it('should use custom expiration time', async () => {
      const customExpiration = 600; // 10 minutes
      const customService = new TokenService(testSecret, customExpiration);

      await customService.generateUnlockToken('ent-123', 'pi-456');

      const signCall = mockJwtSign.mock.calls[0];
      const payload = signCall[0];

      expect(payload.exp - payload.iat).toBe(customExpiration);
    });

    it('should use default 5 minute expiration', async () => {
      const defaultService = new TokenService(testSecret);

      await defaultService.generateUnlockToken('ent-123', 'pi-456');

      const signCall = mockJwtSign.mock.calls[0];
      const payload = signCall[0];

      expect(payload.exp - payload.iat).toBe(300); // Default 5 minutes
    });
  });

  describe('Redis key management', () => {
    it('should use correct key format for token usage tracking', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyUnlockToken('token');

      expect(mockRedisClient.exists).toHaveBeenCalledWith('token:used:mock-uuid-jti');
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        'token:used:mock-uuid-jti',
        testExpiration,
        '1'
      );
    });

    it('should set token expiration in Redis matching token lifetime', async () => {
      const customExpiration = 900;
      const customService = new TokenService(testSecret, customExpiration);
      
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await customService.verifyUnlockToken('token');

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String),
        customExpiration,
        '1'
      );
    });
  });

  describe('single-use token enforcement', () => {
    it('should prevent token reuse after verification', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      
      // First verification - token not used
      mockRedisClient.exists.mockResolvedValueOnce(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const firstResult = await service.verifyUnlockToken('token');
      expect(firstResult.valid).toBe(true);

      // Second verification - token already used
      mockRedisClient.exists.mockResolvedValueOnce(1);

      const secondResult = await service.verifyUnlockToken('token');
      expect(secondResult.valid).toBe(false);
      expect(secondResult.error).toBe('Token has already been used');
    });

    it('should allow read-only verification without consuming token', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);

      // Multiple read-only verifications should all succeed
      const result1 = await service.verifyUnlockTokenReadOnly('token');
      const result2 = await service.verifyUnlockTokenReadOnly('token');

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty string token', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.JsonWebTokenError as any)('jwt malformed');
      });

      const result = await service.verifyUnlockToken('');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('should handle token with special characters', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await service.verifyUnlockToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test');

      expect(result.valid).toBe(true);
    });

    it('should handle concurrent verification attempts', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      // Simulate concurrent verifications
      const [result1, result2] = await Promise.all([
        service.verifyUnlockToken('token1'),
        service.verifyUnlockToken('token2'),
      ]);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });

    it('should handle very long entitlement and purchase intent IDs', async () => {
      const longEntitlementId = 'ent-' + 'a'.repeat(1000);
      const longPurchaseIntentId = 'pi-' + 'b'.repeat(1000);

      await service.generateUnlockToken(longEntitlementId, longPurchaseIntentId);

      expect(mockJwtSign).toHaveBeenCalledWith(
        expect.objectContaining({
          entitlementId: longEntitlementId,
          purchaseIntentId: longPurchaseIntentId,
        }),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('logging behavior', () => {
    it('should log debug message when token is marked as used', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(0);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyUnlockToken('token');

      expect(logger.debug).toHaveBeenCalledWith('Token marked as used', {
        jti: mockPayload.jti,
      });
    });

    it('should log warning for already used tokens', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(1);

      await service.verifyUnlockToken('used-token');

      expect(logger.warn).toHaveBeenCalledWith('Token already used', {
        jti: mockPayload.jti,
        entitlementId: mockPayload.entitlementId,
      });
    });

    it('should not log verification info for already used tokens', async () => {
      mockJwtVerify.mockReturnValue(mockPayload);
      mockRedisClient.exists.mockResolvedValue(1);

      await service.verifyUnlockToken('used-token');

      expect(logger.info).not.toHaveBeenCalledWith(
        'Unlock token verified',
        expect.any(Object)
      );
    });
  });
});
