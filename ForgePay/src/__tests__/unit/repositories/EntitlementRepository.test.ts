import { EntitlementRepository, CreateEntitlementParams, UpdateEntitlementParams } from '../../../repositories/EntitlementRepository';
import { EntitlementStatus } from '../../../types';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('EntitlementRepository', () => {
  let mockPool: any;
  let repository: EntitlementRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new EntitlementRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new entitlement with all fields', async () => {
      const expiresAt = new Date('2025-01-01');
      const params: CreateEntitlementParams = {
        customerId: 'cust-123',
        productId: 'prod-123',
        purchaseIntentId: 'pi-123',
        paymentId: 'pay-123',
        subscriptionId: 'sub-123',
        status: 'active' as EntitlementStatus,
        expiresAt,
      };

      const mockRow = {
        id: 'ent-123',
        customer_id: params.customerId,
        product_id: params.productId,
        purchase_intent_id: params.purchaseIntentId,
        payment_id: params.paymentId,
        subscription_id: params.subscriptionId,
        status: params.status,
        expires_at: expiresAt,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'ent-123',
        customerId: params.customerId,
        productId: params.productId,
        purchaseIntentId: params.purchaseIntentId,
        paymentId: params.paymentId,
        subscriptionId: params.subscriptionId,
        status: params.status,
        expiresAt,
        revokedReason: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO entitlements'),
        [
          params.customerId,
          params.productId,
          params.purchaseIntentId,
          params.paymentId,
          params.subscriptionId,
          params.status,
          expiresAt,
        ]
      );
    });

    it('should create an entitlement without optional fields', async () => {
      const params: CreateEntitlementParams = {
        customerId: 'cust-456',
        productId: 'prod-456',
        purchaseIntentId: 'pi-456',
        paymentId: 'pay-456',
      };

      const mockRow = {
        id: 'ent-456',
        customer_id: params.customerId,
        product_id: params.productId,
        purchase_intent_id: params.purchaseIntentId,
        payment_id: params.paymentId,
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.subscriptionId).toBeNull();
      expect(result.status).toBe('active');
      expect(result.expiresAt).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO entitlements'),
        [
          params.customerId,
          params.productId,
          params.purchaseIntentId,
          params.paymentId,
          null,
          'active',
          null,
        ]
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateEntitlementParams = {
        customerId: 'cust-789',
        productId: 'prod-789',
        purchaseIntentId: 'pi-789',
        paymentId: 'pay-789',
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateEntitlementParams = {
        customerId: 'cust-tx',
        productId: 'prod-tx',
        purchaseIntentId: 'pi-tx',
        paymentId: 'pay-tx',
      };

      const mockRow = {
        id: 'ent-tx',
        customer_id: params.customerId,
        product_id: params.productId,
        purchase_intent_id: params.purchaseIntentId,
        payment_id: params.paymentId,
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should find an entitlement by ID', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: new Date('2025-01-01'),
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('ent-123');

      expect(result).toEqual({
        id: 'ent-123',
        customerId: 'cust-123',
        productId: 'prod-123',
        purchaseIntentId: 'pi-123',
        paymentId: 'pay-123',
        subscriptionId: 'sub-123',
        status: 'active',
        expiresAt: new Date('2025-01-01'),
        revokedReason: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM entitlements'),
        ['ent-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('ent-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('ent-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByPurchaseIntentId', () => {
    it('should find an entitlement by purchase intent ID', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByPurchaseIntentId('pi-123');

      expect(result).not.toBeNull();
      expect(result?.purchaseIntentId).toBe('pi-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE purchase_intent_id = $1'),
        ['pi-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByPurchaseIntentId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByPurchaseIntentId('pi-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByPurchaseIntentId('pi-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByCustomerId', () => {
    it('should find all entitlements for a customer', async () => {
      const mockRows = [
        {
          id: 'ent-1',
          customer_id: 'cust-123',
          product_id: 'prod-1',
          purchase_intent_id: 'pi-1',
          payment_id: 'pay-1',
          subscription_id: 'sub-1',
          status: 'active',
          expires_at: new Date('2025-01-01'),
          revoked_reason: null,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
        {
          id: 'ent-2',
          customer_id: 'cust-123',
          product_id: 'prod-2',
          purchase_intent_id: 'pi-2',
          payment_id: 'pay-2',
          subscription_id: null,
          status: 'revoked',
          expires_at: null,
          revoked_reason: 'Refund requested',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByCustomerId('cust-123');

      expect(result).toHaveLength(2);
      expect(result[0].customerId).toBe('cust-123');
      expect(result[1].customerId).toBe('cust-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE customer_id = $1'),
        ['cust-123']
      );
    });

    it('should return entitlements ordered by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['cust-123']
      );
    });

    it('should return empty array if no entitlements found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByCustomerId('cust-empty');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByCustomerId('cust-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findActiveByCustomerId', () => {
    it('should find active entitlements for a customer', async () => {
      const mockRows = [
        {
          id: 'ent-active-1',
          customer_id: 'cust-123',
          product_id: 'prod-1',
          purchase_intent_id: 'pi-1',
          payment_id: 'pay-1',
          subscription_id: 'sub-1',
          status: 'active',
          expires_at: new Date('2025-12-31'),
          revoked_reason: null,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findActiveByCustomerId('cust-123');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'active'"),
        ['cust-123']
      );
    });

    it('should filter out expired entitlements', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findActiveByCustomerId('cust-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at IS NULL OR expires_at > NOW()'),
        ['cust-123']
      );
    });

    it('should return empty array if no active entitlements', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findActiveByCustomerId('cust-empty');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findActiveByCustomerId('cust-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findActiveByCustomerId('cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByStatus', () => {
    it('should find entitlements by status', async () => {
      const mockRows = [
        {
          id: 'ent-suspended-1',
          customer_id: 'cust-1',
          product_id: 'prod-1',
          purchase_intent_id: 'pi-1',
          payment_id: 'pay-1',
          subscription_id: null,
          status: 'suspended',
          expires_at: null,
          revoked_reason: 'Payment failed',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
        {
          id: 'ent-suspended-2',
          customer_id: 'cust-2',
          product_id: 'prod-2',
          purchase_intent_id: 'pi-2',
          payment_id: 'pay-2',
          subscription_id: 'sub-2',
          status: 'suspended',
          expires_at: new Date('2025-01-01'),
          revoked_reason: 'Account review',
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-16'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByStatus('suspended' as EntitlementStatus);

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('suspended');
      expect(result[1].status).toBe('suspended');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        ['suspended']
      );
    });

    it('should return entitlements ordered by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStatus('active' as EntitlementStatus);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['active']
      );
    });

    it('should return empty array if no entitlements found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByStatus('revoked' as EntitlementStatus);

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStatus('active' as EntitlementStatus)).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStatus('active' as EntitlementStatus, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findBySubscriptionId', () => {
    it('should find an entitlement by subscription ID', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: new Date('2025-01-01'),
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findBySubscriptionId('sub-123');

      expect(result).not.toBeNull();
      expect(result?.subscriptionId).toBe('sub-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE subscription_id = $1'),
        ['sub-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findBySubscriptionId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findBySubscriptionId('sub-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findBySubscriptionId('sub-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByPaymentId', () => {
    it('should find an entitlement by payment ID', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByPaymentId('pay-123');

      expect(result).not.toBeNull();
      expect(result?.paymentId).toBe('pay-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE payment_id = $1'),
        ['pay-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByPaymentId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByPaymentId('pay-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByPaymentId('pay-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update entitlement status', async () => {
      const params: UpdateEntitlementParams = {
        status: 'suspended' as EntitlementStatus,
      };

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'suspended',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('ent-123', params);

      expect(result?.status).toBe('suspended');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE entitlements'),
        ['suspended', 'ent-123']
      );
    });

    it('should update entitlement expiresAt', async () => {
      const newExpiresAt = new Date('2026-01-01');
      const params: UpdateEntitlementParams = {
        expiresAt: newExpiresAt,
      };

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: newExpiresAt,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('ent-123', params);

      expect(result?.expiresAt).toEqual(newExpiresAt);
    });

    it('should update entitlement revokedReason', async () => {
      const params: UpdateEntitlementParams = {
        revokedReason: 'Subscription cancelled',
      };

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: null,
        revoked_reason: 'Subscription cancelled',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('ent-123', params);

      expect(result?.revokedReason).toBe('Subscription cancelled');
    });

    it('should update multiple fields at once', async () => {
      const newExpiresAt = new Date('2026-01-01');
      const params: UpdateEntitlementParams = {
        status: 'revoked' as EntitlementStatus,
        expiresAt: newExpiresAt,
        revokedReason: 'Fraud detected',
      };

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'revoked',
        expires_at: newExpiresAt,
        revoked_reason: 'Fraud detected',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('ent-123', params);

      expect(result?.status).toBe('revoked');
      expect(result?.expiresAt).toEqual(newExpiresAt);
      expect(result?.revokedReason).toBe('Fraud detected');
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { status: 'suspended' as EntitlementStatus });

      expect(result).toBeNull();
    });

    it('should return existing entitlement if no updates provided', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('ent-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM entitlements'),
        ['ent-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('ent-123', { status: 'suspended' as EntitlementStatus })).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'suspended',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('ent-123', { status: 'suspended' as EntitlementStatus }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should set expiresAt to null when explicitly provided', async () => {
      const params: UpdateEntitlementParams = {
        expiresAt: null,
      };

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('ent-123', params);

      expect(result?.expiresAt).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at = $'),
        [null, 'ent-123']
      );
    });
  });

  describe('suspend', () => {
    it('should suspend an entitlement with reason', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'suspended',
        expires_at: null,
        revoked_reason: 'Payment failed',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.suspend('ent-123', 'Payment failed');

      expect(result?.status).toBe('suspended');
      expect(result?.revokedReason).toBe('Payment failed');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE entitlements'),
        ['suspended', 'Payment failed', 'ent-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.suspend('nonexistent', 'Test reason');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'suspended',
        expires_at: null,
        revoked_reason: 'Test reason',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.suspend('ent-123', 'Test reason', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('should revoke an entitlement with reason', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'revoked',
        expires_at: null,
        revoked_reason: 'Refund processed',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.revoke('ent-123', 'Refund processed');

      expect(result?.status).toBe('revoked');
      expect(result?.revokedReason).toBe('Refund processed');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE entitlements'),
        ['revoked', 'Refund processed', 'ent-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.revoke('nonexistent', 'Test reason');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'revoked',
        expires_at: null,
        revoked_reason: 'Test reason',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.revoke('ent-123', 'Test reason', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('should reactivate an entitlement', async () => {
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: new Date('2025-01-01'),
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.reactivate('ent-123');

      expect(result?.status).toBe('active');
      expect(result?.revokedReason).toBeNull();
      // Note: revokedReason: undefined in the params means it won't be included in the update
      // (since undefined !== undefined is false), so only status is updated
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE entitlements'),
        ['active', 'ent-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.reactivate('nonexistent');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.reactivate('ent-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('extendExpiration', () => {
    it('should extend entitlement expiration date', async () => {
      const newExpiresAt = new Date('2026-12-31');
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: newExpiresAt,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.extendExpiration('ent-123', newExpiresAt);

      expect(result?.expiresAt).toEqual(newExpiresAt);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE entitlements'),
        [newExpiresAt, 'ent-123']
      );
    });

    it('should return null if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.extendExpiration('nonexistent', new Date('2026-01-01'));

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const newExpiresAt = new Date('2026-12-31');
      const mockRow = {
        id: 'ent-123',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: newExpiresAt,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.extendExpiration('ent-123', newExpiresAt, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete an entitlement', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('ent-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM entitlements'),
        ['ent-123']
      );
    });

    it('should return false if entitlement not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle null rowCount', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: null,
      } as any);

      const result = await repository.delete('ent-123');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('ent-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('ent-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findExpiredEntitlements', () => {
    it('should find expired entitlements', async () => {
      const expiredDate = new Date('2023-12-31');
      const mockRows = [
        {
          id: 'ent-expired-1',
          customer_id: 'cust-1',
          product_id: 'prod-1',
          purchase_intent_id: 'pi-1',
          payment_id: 'pay-1',
          subscription_id: 'sub-1',
          status: 'active',
          expires_at: expiredDate,
          revoked_reason: null,
          created_at: new Date('2023-01-01'),
          updated_at: new Date('2023-01-01'),
        },
        {
          id: 'ent-expired-2',
          customer_id: 'cust-2',
          product_id: 'prod-2',
          purchase_intent_id: 'pi-2',
          payment_id: 'pay-2',
          subscription_id: null,
          status: 'active',
          expires_at: new Date('2023-06-30'),
          revoked_reason: null,
          created_at: new Date('2023-01-01'),
          updated_at: new Date('2023-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findExpiredEntitlements();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('active');
      expect(result[1].status).toBe('active');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'active'")
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at IS NOT NULL')
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at < NOW()')
      );
    });

    it('should return empty array if no expired entitlements', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findExpiredEntitlements();

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findExpiredEntitlements()).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findExpiredEntitlements(mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle entitlement with null subscription_id', async () => {
      const params: CreateEntitlementParams = {
        customerId: 'cust-123',
        productId: 'prod-123',
        purchaseIntentId: 'pi-123',
        paymentId: 'pay-123',
      };

      const mockRow = {
        id: 'ent-no-sub',
        customer_id: params.customerId,
        product_id: params.productId,
        purchase_intent_id: params.purchaseIntentId,
        payment_id: params.paymentId,
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.subscriptionId).toBeNull();
    });

    it('should handle entitlement with null expires_at', async () => {
      const mockRow = {
        id: 'ent-no-exp',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('ent-no-exp');

      expect(result?.expiresAt).toBeNull();
    });

    it('should handle entitlement with revoked_reason', async () => {
      const mockRow = {
        id: 'ent-revoked',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'revoked',
        expires_at: null,
        revoked_reason: 'Customer requested refund after 30 days',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-15'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('ent-revoked');

      expect(result?.revokedReason).toBe('Customer requested refund after 30 days');
      expect(result?.status).toBe('revoked');
    });

    it('should properly map dates from database rows', async () => {
      const createdAt = new Date('2024-01-15T10:30:00Z');
      const updatedAt = new Date('2024-02-20T14:45:00Z');
      const expiresAt = new Date('2025-01-15T00:00:00Z');

      const mockRow = {
        id: 'ent-dates',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: 'sub-123',
        status: 'active',
        expires_at: expiresAt,
        revoked_reason: null,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('ent-dates');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.updatedAt).toEqual(updatedAt);
      expect(result?.expiresAt).toEqual(expiresAt);
    });

    it('should handle various entitlement statuses', async () => {
      const statuses: EntitlementStatus[] = ['active', 'suspended', 'revoked', 'expired'];

      for (const status of statuses) {
        mockPool.query.mockResolvedValueOnce({
          rows: [{
            id: `ent-${status}`,
            customer_id: 'cust-123',
            product_id: 'prod-123',
            purchase_intent_id: 'pi-123',
            payment_id: 'pay-123',
            subscription_id: null,
            status,
            expires_at: null,
            revoked_reason: status === 'revoked' ? 'Test reason' : null,
            created_at: new Date('2024-01-01'),
            updated_at: new Date('2024-01-01'),
          }],
          rowCount: 1,
        } as any);

        const result = await repository.findById(`ent-${status}`);

        expect(result?.status).toBe(status);
      }
    });

    it('should handle long purchase intent IDs', async () => {
      const longPurchaseIntentId = 'pi_' + 'a'.repeat(100);

      const params: CreateEntitlementParams = {
        customerId: 'cust-123',
        productId: 'prod-123',
        purchaseIntentId: longPurchaseIntentId,
        paymentId: 'pay-123',
      };

      const mockRow = {
        id: 'ent-long-pi',
        customer_id: params.customerId,
        product_id: params.productId,
        purchase_intent_id: longPurchaseIntentId,
        payment_id: params.paymentId,
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.purchaseIntentId).toBe(longPurchaseIntentId);
    });

    it('should handle unicode characters in revoked_reason', async () => {
      const mockRow = {
        id: 'ent-unicode',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'revoked',
        expires_at: null,
        revoked_reason: '客户要求退款 / Customer requested refund 日本語',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('ent-unicode');

      expect(result?.revokedReason).toBe('客户要求退款 / Customer requested refund 日本語');
    });

    it('should handle multiple entitlements for same customer and product', async () => {
      const mockRows = [
        {
          id: 'ent-1',
          customer_id: 'cust-123',
          product_id: 'prod-123',
          purchase_intent_id: 'pi-1',
          payment_id: 'pay-1',
          subscription_id: null,
          status: 'revoked',
          expires_at: null,
          revoked_reason: 'Refunded',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
        {
          id: 'ent-2',
          customer_id: 'cust-123',
          product_id: 'prod-123',
          purchase_intent_id: 'pi-2',
          payment_id: 'pay-2',
          subscription_id: 'sub-2',
          status: 'active',
          expires_at: new Date('2025-01-01'),
          revoked_reason: null,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByCustomerId('cust-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ent-1');
      expect(result[1].id).toBe('ent-2');
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateEntitlementParams = {
        customerId: 'cust-error',
        productId: 'prod-error',
        purchaseIntentId: 'pi-error',
        paymentId: 'pay-error',
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating entitlement',
        expect.objectContaining({
          error: dbError,
          params,
        })
      );
    });

    it('should log error when findById fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('ent-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding entitlement by ID',
        expect.objectContaining({
          error: dbError,
          entitlementId: 'ent-123',
        })
      );
    });

    it('should log error when findByPurchaseIntentId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByPurchaseIntentId('pi-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding entitlement by purchase intent ID',
        expect.objectContaining({
          error: dbError,
          purchaseIntentId: 'pi-123',
        })
      );
    });

    it('should log error when findByCustomerId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByCustomerId('cust-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding entitlements by customer ID',
        expect.objectContaining({
          error: dbError,
          customerId: 'cust-123',
        })
      );
    });

    it('should log error when findActiveByCustomerId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findActiveByCustomerId('cust-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding active entitlements by customer ID',
        expect.objectContaining({
          error: dbError,
          customerId: 'cust-123',
        })
      );
    });

    it('should log error when findByStatus fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStatus('active' as EntitlementStatus)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding entitlements by status',
        expect.objectContaining({
          error: dbError,
          status: 'active',
        })
      );
    });

    it('should log error when findBySubscriptionId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findBySubscriptionId('sub-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding entitlement by subscription ID',
        expect.objectContaining({
          error: dbError,
          subscriptionId: 'sub-123',
        })
      );
    });

    it('should log error when findByPaymentId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByPaymentId('pay-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding entitlement by payment ID',
        expect.objectContaining({
          error: dbError,
          paymentId: 'pay-123',
        })
      );
    });

    it('should log error when update fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('ent-123', { status: 'suspended' as EntitlementStatus })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating entitlement',
        expect.objectContaining({
          error: dbError,
          entitlementId: 'ent-123',
        })
      );
    });

    it('should log error when delete fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('ent-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error deleting entitlement',
        expect.objectContaining({
          error: dbError,
          entitlementId: 'ent-123',
        })
      );
    });

    it('should log error when findExpiredEntitlements fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findExpiredEntitlements()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding expired entitlements',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log success when entitlement is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateEntitlementParams = {
        customerId: 'cust-log',
        productId: 'prod-log',
        purchaseIntentId: 'pi-log',
        paymentId: 'pay-log',
      };

      const mockRow = {
        id: 'ent-log',
        customer_id: params.customerId,
        product_id: params.productId,
        purchase_intent_id: params.purchaseIntentId,
        payment_id: params.paymentId,
        subscription_id: null,
        status: 'active',
        expires_at: null,
        revoked_reason: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Entitlement created',
        expect.objectContaining({
          entitlementId: 'ent-log',
          customerId: params.customerId,
          productId: params.productId,
          purchaseIntentId: params.purchaseIntentId,
          status: 'active',
        })
      );
    });

    it('should log success when entitlement is updated', async () => {
      const { logger } = require('../../../utils/logger');

      const mockRow = {
        id: 'ent-update-log',
        customer_id: 'cust-123',
        product_id: 'prod-123',
        purchase_intent_id: 'pi-123',
        payment_id: 'pay-123',
        subscription_id: null,
        status: 'suspended',
        expires_at: null,
        revoked_reason: 'Test reason',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('ent-update-log', { status: 'suspended' as EntitlementStatus });

      expect(logger.info).toHaveBeenCalledWith(
        'Entitlement updated',
        expect.objectContaining({
          entitlementId: 'ent-update-log',
        })
      );
    });

    it('should log success when entitlement is deleted', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('ent-delete-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Entitlement deleted',
        expect.objectContaining({
          entitlementId: 'ent-delete-log',
        })
      );
    });

    it('should not log success when delete finds no entitlement', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.delete('ent-not-found');

      expect(logger.info).not.toHaveBeenCalledWith(
        'Entitlement deleted',
        expect.anything()
      );
    });
  });
});
