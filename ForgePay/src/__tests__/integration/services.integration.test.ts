/**
 * Integration Tests for Services
 *
 * These tests verify the integration between services and repositories.
 */

import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
jest.mock('../../config/database', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../../config/redis', () => ({
  redisClient: {
    exists: jest.fn().mockResolvedValue(0),
    setEx: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { TokenService } from '../../services/TokenService';
import { redisClient } from '../../config/redis';

describe('TokenService Integration', () => {
  let tokenService: TokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    tokenService = new TokenService('test-secret', 300);
  });

  describe('generateUnlockToken', () => {
    it('should generate a valid JWT token', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format
    });

    it('should include correct claims in token', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);
      const decoded = tokenService.decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.entitlementId).toBe(entitlementId);
      expect(decoded?.purchaseIntentId).toBe(purchaseIntentId);
      expect(decoded?.jti).toBeDefined();
      expect(decoded?.iat).toBeDefined();
      expect(decoded?.exp).toBeDefined();
      expect(decoded!.exp - decoded!.iat).toBe(300); // 5 minutes
    });
  });

  describe('verifyUnlockToken', () => {
    it('should verify a valid token', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      // Mock Redis to indicate token not used
      (redisClient.exists as jest.Mock).mockResolvedValue(0);

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);
      const result = await tokenService.verifyUnlockToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.entitlementId).toBe(entitlementId);
      expect(result.payload?.purchaseIntentId).toBe(purchaseIntentId);
    });

    it('should reject an already used token', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);

      // First verification should succeed
      (redisClient.exists as jest.Mock).mockResolvedValue(0);
      const firstResult = await tokenService.verifyUnlockToken(token);
      expect(firstResult.valid).toBe(true);

      // Second verification should fail (token marked as used)
      (redisClient.exists as jest.Mock).mockResolvedValue(1);
      const secondResult = await tokenService.verifyUnlockToken(token);
      expect(secondResult.valid).toBe(false);
      expect(secondResult.error).toBe('Token has already been used');
    });

    it('should reject an invalid token', async () => {
      const result = await tokenService.verifyUnlockToken('invalid.token.here');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('should reject a token signed with different secret', async () => {
      const otherService = new TokenService('different-secret', 300);
      const token = await otherService.generateUnlockToken(uuidv4(), `pi_${uuidv4()}`);

      const result = await tokenService.verifyUnlockToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('should mark token as used after verification', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      (redisClient.exists as jest.Mock).mockResolvedValue(0);

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);
      await tokenService.verifyUnlockToken(token);

      // Verify setEx was called to mark token as used
      expect(redisClient.setEx).toHaveBeenCalledWith(
        expect.stringContaining('token:used:'),
        300,
        '1'
      );
    });
  });

  describe('verifyUnlockTokenReadOnly', () => {
    it('should verify without consuming the token', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      (redisClient.exists as jest.Mock).mockResolvedValue(0);

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);
      const result = await tokenService.verifyUnlockTokenReadOnly(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.entitlementId).toBe(entitlementId);

      // setEx should NOT be called for read-only verification
      expect(redisClient.setEx).not.toHaveBeenCalled();
    });
  });

  describe('decodeToken', () => {
    it('should decode a valid token', async () => {
      const entitlementId = uuidv4();
      const purchaseIntentId = `pi_${uuidv4()}`;

      const token = await tokenService.generateUnlockToken(entitlementId, purchaseIntentId);
      const decoded = tokenService.decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.entitlementId).toBe(entitlementId);
    });

    it('should return null for invalid token', () => {
      const decoded = tokenService.decodeToken('invalid');

      expect(decoded).toBeNull();
    });
  });
});

// EmailService テストは削除済み（外部サービスに委譲）
