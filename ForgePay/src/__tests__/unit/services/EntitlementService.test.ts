import { EntitlementService, GrantEntitlementParams } from '../../../services/EntitlementService';
import { Entitlement } from '../../../repositories/EntitlementRepository';
import { EntitlementStatus } from '../../../types';

// Mock pool
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../../../config/database', () => ({
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
}));

// Mock dependencies
jest.mock('../../../repositories/EntitlementRepository', () => ({
  entitlementRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByPurchaseIntentId: jest.fn(),
    findBySubscriptionId: jest.fn(),
    findByCustomerId: jest.fn(),
    findActiveByCustomerId: jest.fn(),
    suspend: jest.fn(),
    reactivate: jest.fn(),
    revoke: jest.fn(),
    extendExpiration: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../../repositories/AuditLogRepository', () => ({
  auditLogRepository: {
    create: jest.fn(),
  },
}));

jest.mock('../../../services/TokenService', () => ({
  tokenService: {
    generateUnlockToken: jest.fn(),
    verifyUnlockToken: jest.fn(),
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
import { entitlementRepository } from '../../../repositories/EntitlementRepository';
import { auditLogRepository } from '../../../repositories/AuditLogRepository';
import { tokenService } from '../../../services/TokenService';

const mockPool = pool as jest.Mocked<typeof pool>;
const mockEntitlementRepository = entitlementRepository as jest.Mocked<typeof entitlementRepository>;
const mockAuditLogRepository = auditLogRepository as jest.Mocked<typeof auditLogRepository>;
const mockTokenService = tokenService as jest.Mocked<typeof tokenService>;

describe('EntitlementService', () => {
  let service: EntitlementService;

  const mockEntitlement: Entitlement = {
    id: 'ent-123',
    customerId: 'cust-123',
    productId: 'prod-123',
    purchaseIntentId: 'pi_123',
    paymentId: 'pay_123',
    subscriptionId: null,
    status: 'active' as EntitlementStatus,
    expiresAt: null,
    revokedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    service = new EntitlementService();
    jest.clearAllMocks();
    
    // Setup mock client
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });
  });

  describe('grantEntitlement', () => {
    const grantParams: GrantEntitlementParams = {
      customerId: 'cust-123',
      productId: 'prod-123',
      purchaseIntentId: 'pi_123',
      paymentId: 'pay_123',
    };

    it('should grant new entitlement successfully', async () => {
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(null);
      mockEntitlementRepository.create.mockResolvedValue(mockEntitlement);
      mockAuditLogRepository.create.mockResolvedValue({} as any);
      mockTokenService.generateUnlockToken.mockResolvedValue('unlock-token-123');

      const result = await service.grantEntitlement(grantParams);

      expect(result.entitlement).toEqual(mockEntitlement);
      expect(result.unlockToken).toBe('unlock-token-123');
      expect(mockEntitlementRepository.create).toHaveBeenCalled();
      expect(mockAuditLogRepository.create).toHaveBeenCalled();
    });

    it('should return existing entitlement if already exists', async () => {
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(mockEntitlement);
      mockTokenService.generateUnlockToken.mockResolvedValue('unlock-token-existing');

      const result = await service.grantEntitlement(grantParams);

      expect(result.entitlement).toEqual(mockEntitlement);
      expect(result.unlockToken).toBe('unlock-token-existing');
      expect(mockEntitlementRepository.create).not.toHaveBeenCalled();
    });

    it('should grant subscription entitlement with expiry', async () => {
      const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const subParams: GrantEntitlementParams = {
        ...grantParams,
        subscriptionId: 'sub_123',
        expiresAt: expiryDate,
      };
      const subEntitlement = {
        ...mockEntitlement,
        subscriptionId: 'sub_123',
        expiresAt: expiryDate,
      };

      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(null);
      mockEntitlementRepository.create.mockResolvedValue(subEntitlement);
      mockAuditLogRepository.create.mockResolvedValue({} as any);
      mockTokenService.generateUnlockToken.mockResolvedValue('unlock-token-sub');

      const result = await service.grantEntitlement(subParams);

      expect(result.entitlement.subscriptionId).toBe('sub_123');
      expect(result.entitlement.expiresAt).toEqual(expiryDate);
    });

    it('should rollback on error', async () => {
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(null);
      mockEntitlementRepository.create.mockRejectedValue(new Error('DB Error'));

      await expect(service.grantEntitlement(grantParams)).rejects.toThrow('DB Error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('checkEntitlementStatus', () => {
    it('should return active status for valid entitlement', async () => {
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(mockEntitlement);

      const result = await service.checkEntitlementStatus('pi_123');

      expect(result.hasAccess).toBe(true);
      expect(result.status).toBe('active');
      expect(result.entitlementId).toBe('ent-123');
    });

    it('should return no access for non-existent entitlement', async () => {
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(null);

      const result = await service.checkEntitlementStatus('invalid-pi');

      expect(result.hasAccess).toBe(false);
      expect(result.status).toBe('expired');
      expect(result.entitlementId).toBeNull();
    });

    it('should return expired status for expired entitlement', async () => {
      const expiredEntitlement = {
        ...mockEntitlement,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(expiredEntitlement);

      const result = await service.checkEntitlementStatus('pi_123');

      expect(result.hasAccess).toBe(false);
      expect(result.status).toBe('expired');
    });

    it('should return suspended status for suspended entitlement', async () => {
      const suspendedEntitlement = {
        ...mockEntitlement,
        status: 'suspended' as EntitlementStatus,
      };
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(suspendedEntitlement);

      const result = await service.checkEntitlementStatus('pi_123');

      expect(result.hasAccess).toBe(false);
      expect(result.status).toBe('suspended');
    });

    it('should return active for entitlement with future expiry', async () => {
      const futureExpiry = {
        ...mockEntitlement,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(futureExpiry);

      const result = await service.checkEntitlementStatus('pi_123');

      expect(result.hasAccess).toBe(true);
      expect(result.status).toBe('active');
    });
  });

  describe('getEntitlement', () => {
    it('should return entitlement by ID', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);

      const result = await service.getEntitlement('ent-123');

      expect(result).toEqual(mockEntitlement);
    });

    it('should return null if not found', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(null);

      const result = await service.getEntitlement('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getEntitlementByPurchaseIntentId', () => {
    it('should return entitlement by purchase intent ID', async () => {
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(mockEntitlement);

      const result = await service.getEntitlementByPurchaseIntentId('pi_123');

      expect(result).toEqual(mockEntitlement);
    });
  });

  describe('verifyUnlockToken', () => {
    it('should verify valid unlock token', async () => {
      mockTokenService.verifyUnlockToken.mockResolvedValue({
        valid: true,
        payload: {
          entitlementId: 'ent-123',
          purchaseIntentId: 'pi_123',
          iat: Date.now() / 1000,
          exp: Date.now() / 1000 + 300,
          jti: 'token-jti',
        },
      });
      mockEntitlementRepository.findByPurchaseIntentId.mockResolvedValue(mockEntitlement);

      const result = await service.verifyUnlockToken('valid-token');

      expect(result.valid).toBe(true);
      expect(result.status?.hasAccess).toBe(true);
    });

    it('should return invalid for expired token', async () => {
      mockTokenService.verifyUnlockToken.mockResolvedValue({
        valid: false,
        error: 'Token has expired',
      });

      const result = await service.verifyUnlockToken('expired-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
    });

    it('should return invalid for invalid token', async () => {
      mockTokenService.verifyUnlockToken.mockResolvedValue({
        valid: false,
        error: 'Invalid token',
      });

      const result = await service.verifyUnlockToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });
  });

  describe('suspendEntitlement', () => {
    it('should suspend entitlement successfully', async () => {
      const suspendedEntitlement = {
        ...mockEntitlement,
        status: 'suspended' as EntitlementStatus,
      };
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.suspend.mockResolvedValue(suspendedEntitlement);
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.suspendEntitlement('ent-123', 'Payment failed');

      expect(result?.status).toBe('suspended');
      expect(mockAuditLogRepository.create).toHaveBeenCalled();
    });

    it('should return null if entitlement not found', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(null);

      const result = await service.suspendEntitlement('invalid-id', 'Test');

      expect(result).toBeNull();
    });
  });

  describe('reactivateEntitlement', () => {
    it('should reactivate suspended entitlement', async () => {
      const suspendedEntitlement = {
        ...mockEntitlement,
        status: 'suspended' as EntitlementStatus,
      };
      const reactivatedEntitlement = {
        ...mockEntitlement,
        status: 'active' as EntitlementStatus,
      };
      mockEntitlementRepository.findById.mockResolvedValue(suspendedEntitlement);
      mockEntitlementRepository.reactivate.mockResolvedValue(reactivatedEntitlement);
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.reactivateEntitlement('ent-123');

      expect(result?.status).toBe('active');
    });
  });

  describe('revokeEntitlement', () => {
    it('should revoke entitlement successfully', async () => {
      const revokedEntitlement = {
        ...mockEntitlement,
        status: 'revoked' as EntitlementStatus,
      };
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.revoke.mockResolvedValue(revokedEntitlement);
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.revokeEntitlement('ent-123', 'Refund processed');

      expect(result?.status).toBe('revoked');
    });
  });

  describe('renewEntitlement', () => {
    it('should renew subscription entitlement', async () => {
      const newExpiryDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      const renewedEntitlement = {
        ...mockEntitlement,
        expiresAt: newExpiryDate,
      };
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.extendExpiration.mockResolvedValue(renewedEntitlement);
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.renewEntitlement('ent-123', newExpiryDate);

      expect(result?.expiresAt).toEqual(newExpiryDate);
    });

    it('should return null if entitlement not found', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(null);

      const result = await service.renewEntitlement('invalid-id', new Date());

      expect(result).toBeNull();
    });

    it('should rollback and throw error on database failure', async () => {
      const newExpiryDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.extendExpiration.mockRejectedValue(new Error('Database error'));

      await expect(service.renewEntitlement('ent-123', newExpiryDate)).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('suspendEntitlement error handling', () => {
    it('should rollback and throw error on database failure', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.suspend.mockRejectedValue(new Error('Database error'));

      await expect(service.suspendEntitlement('ent-123', 'Test reason')).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('revokeEntitlement error handling', () => {
    it('should return null if entitlement not found', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(null);

      const result = await service.revokeEntitlement('invalid-id', 'Test reason');

      expect(result).toBeNull();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should rollback and throw error on database failure', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.revoke.mockRejectedValue(new Error('Database error'));

      await expect(service.revokeEntitlement('ent-123', 'Refund')).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('reactivateEntitlement error handling', () => {
    it('should return null if entitlement not found', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(null);

      const result = await service.reactivateEntitlement('invalid-id');

      expect(result).toBeNull();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should rollback and throw error on database failure', async () => {
      mockEntitlementRepository.findById.mockResolvedValue(mockEntitlement);
      mockEntitlementRepository.reactivate.mockRejectedValue(new Error('Database error'));

      await expect(service.reactivateEntitlement('ent-123')).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getEntitlementBySubscriptionId', () => {
    it('should return entitlement by subscription ID', async () => {
      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };
      mockEntitlementRepository.findBySubscriptionId.mockResolvedValue(subEntitlement);

      const result = await service.getEntitlementBySubscriptionId('sub_123');

      expect(result).toEqual(subEntitlement);
      expect(mockEntitlementRepository.findBySubscriptionId).toHaveBeenCalledWith('sub_123');
    });

    it('should return null if not found', async () => {
      mockEntitlementRepository.findBySubscriptionId.mockResolvedValue(null);

      const result = await service.getEntitlementBySubscriptionId('invalid-sub');

      expect(result).toBeNull();
    });
  });

  describe('getEntitlementsByCustomerId', () => {
    it('should return all entitlements for customer', async () => {
      const entitlements = [
        mockEntitlement,
        { ...mockEntitlement, id: 'ent-456', productId: 'prod-456' },
      ];
      mockEntitlementRepository.findByCustomerId.mockResolvedValue(entitlements);

      const result = await service.getEntitlementsByCustomerId('cust-123');

      expect(result).toEqual(entitlements);
      expect(result).toHaveLength(2);
      expect(mockEntitlementRepository.findByCustomerId).toHaveBeenCalledWith('cust-123');
    });

    it('should return empty array if no entitlements found', async () => {
      mockEntitlementRepository.findByCustomerId.mockResolvedValue([]);

      const result = await service.getEntitlementsByCustomerId('cust-no-entitlements');

      expect(result).toEqual([]);
    });
  });

  describe('getActiveEntitlementsByCustomerId', () => {
    it('should return only active entitlements for customer', async () => {
      const activeEntitlements = [mockEntitlement];
      mockEntitlementRepository.findActiveByCustomerId.mockResolvedValue(activeEntitlements);

      const result = await service.getActiveEntitlementsByCustomerId('cust-123');

      expect(result).toEqual(activeEntitlements);
      expect(mockEntitlementRepository.findActiveByCustomerId).toHaveBeenCalledWith('cust-123');
    });

    it('should return empty array if no active entitlements', async () => {
      mockEntitlementRepository.findActiveByCustomerId.mockResolvedValue([]);

      const result = await service.getActiveEntitlementsByCustomerId('cust-no-active');

      expect(result).toEqual([]);
    });
  });

  describe('constructor dependency injection', () => {
    it('should use injected dependencies', async () => {
      const customEntitlementRepo = {
        findById: jest.fn().mockResolvedValue(mockEntitlement),
        findByPurchaseIntentId: jest.fn(),
        findBySubscriptionId: jest.fn(),
        findByCustomerId: jest.fn(),
        findActiveByCustomerId: jest.fn(),
        create: jest.fn(),
        suspend: jest.fn(),
        reactivate: jest.fn(),
        revoke: jest.fn(),
        extendExpiration: jest.fn(),
      };
      const customAuditRepo = { create: jest.fn() };
      const customTokenSvc = { generateUnlockToken: jest.fn(), verifyUnlockToken: jest.fn() };

      const customService = new EntitlementService(
        customEntitlementRepo as any,
        customAuditRepo as any,
        customTokenSvc as any
      );

      await customService.getEntitlement('ent-123');

      expect(customEntitlementRepo.findById).toHaveBeenCalledWith('ent-123');
    });
  });
});
