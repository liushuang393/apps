import { PurchaseService } from '../../../src/services/purchase.service';
import { pool } from '../../../src/config/database.config';
import { CreatePurchaseDto, PurchaseStatus } from '../../../src/models/purchase.entity';
import { generateUUID, sha256 } from '../../../src/utils/crypto.util';

// Mock dependencies
jest.mock('../../../src/config/database.config');
jest.mock('../../../src/utils/crypto.util');
jest.mock('../../../src/utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('PurchaseService', () => {
  let service: PurchaseService;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    service = new PurchaseService();
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock) = jest.fn().mockResolvedValue(mockClient);
    (pool.query as jest.Mock) = jest.fn();
    (generateUUID as jest.MockedFunction<typeof generateUUID>).mockReturnValue('purchase-uuid-123');
    (sha256 as jest.MockedFunction<typeof sha256>).mockReturnValue('idempotency-key-hash');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPurchase', () => {
    const validDto: CreatePurchaseDto = {
      campaign_id: 'campaign-123',
      position_ids: ['position-1', 'position-2'],
      payment_method: 'card',
    };

    it('should create purchase successfully with FOR UPDATE SKIP LOCKED', async () => {
      const mockCampaign = {
        status: 'published',
        purchase_limit: null,
      };

      const mockPositions = [
        { position_id: 'position-1', price: '100', status: 'available' },
        { position_id: 'position-2', price: '200', status: 'available' },
      ];

      const mockPurchase = {
        purchase_id: 'purchase-uuid-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 100,
        total_amount: 100,
        status: 'pending',
        idempotency_key: 'idempotency-key-hash',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION ISOLATION LEVEL
        .mockResolvedValueOnce({ rows: [mockCampaign] }) // SELECT campaign
        .mockResolvedValueOnce({ rows: mockPositions }) // SELECT positions FOR UPDATE SKIP LOCKED
        .mockResolvedValueOnce({ rows: [mockPurchase] }) // INSERT purchase 1
        .mockResolvedValueOnce({ rows: [] }) // UPDATE position 1
        .mockResolvedValueOnce({ rows: [mockPurchase] }) // INSERT purchase 2
        .mockResolvedValueOnce({ rows: [] }) // UPDATE position 2
        .mockResolvedValueOnce({ rows: [] }) // UPDATE campaign positions_sold
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.createPurchase(validDto, 'user-123');

      expect(result).toBeDefined();
      expect(result.purchase_id).toBe('purchase-uuid-123');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw error if campaign not found', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION ISOLATION LEVEL
        .mockResolvedValueOnce({ rows: [] }); // SELECT campaign - empty

      await expect(service.createPurchase(validDto, 'user-123')).rejects.toThrow('CAMPAIGN_NOT_FOUND');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw error if campaign not published', async () => {
      const mockCampaign = {
        status: 'draft',
        purchase_limit: null,
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION ISOLATION LEVEL
        .mockResolvedValueOnce({ rows: [mockCampaign] }); // SELECT campaign

      await expect(service.createPurchase(validDto, 'user-123')).rejects.toThrow(
        'Campaign is not available for purchase'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error if positions not available (concurrency)', async () => {
      const mockCampaign = {
        status: 'published',
        purchase_limit: null,
      };

      // Only 1 position locked (the other was taken by concurrent request)
      const mockPositions = [
        { position_id: 'position-1', price: '100', status: 'available' },
      ];

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION ISOLATION LEVEL
        .mockResolvedValueOnce({ rows: [mockCampaign] }) // SELECT campaign
        .mockResolvedValueOnce({ rows: mockPositions }); // SELECT positions - only 1 returned

      await expect(service.createPurchase(validDto, 'user-123')).rejects.toThrow(
        'Some positions are no longer available'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should enforce purchase limit', async () => {
      const mockCampaign = {
        status: 'published',
        purchase_limit: 3,
      };

      const mockUserPurchases = [{ count: '2' }]; // User already has 2 purchases

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION ISOLATION LEVEL
        .mockResolvedValueOnce({ rows: [mockCampaign] }) // SELECT campaign
        .mockResolvedValueOnce({ rows: mockUserPurchases }); // SELECT user purchase count

      await expect(service.createPurchase(validDto, 'user-123')).rejects.toThrow(
        'Purchase limit exceeded'
      );

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should use provided idempotency key', async () => {
      const mockCampaign = {
        status: 'published',
        purchase_limit: null,
      };

      const mockPositions = [
        { position_id: 'position-1', price: '100', status: 'available' },
        { position_id: 'position-2', price: '200', status: 'available' },
      ];

      const mockPurchase = {
        purchase_id: 'purchase-uuid-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 100,
        total_amount: 100,
        status: 'pending',
        idempotency_key: 'custom-idempotency-key',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION ISOLATION LEVEL
        .mockResolvedValueOnce({ rows: [mockCampaign] }) // SELECT campaign
        .mockResolvedValueOnce({ rows: mockPositions }) // SELECT positions
        .mockResolvedValueOnce({ rows: [mockPurchase] }) // INSERT purchase 1
        .mockResolvedValueOnce({ rows: [] }) // UPDATE position 1
        .mockResolvedValueOnce({ rows: [mockPurchase] }) // INSERT purchase 2
        .mockResolvedValueOnce({ rows: [] }) // UPDATE position 2
        .mockResolvedValueOnce({ rows: [] }) // UPDATE campaign
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.createPurchase(validDto, 'user-123', 'custom-idempotency-key');

      expect(result).toBeDefined();
      // Verify idempotency key was used in INSERT
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO purchases'),
        expect.arrayContaining(['custom-idempotency-key'])
      );
    });
  });

  describe('updatePurchaseStatus', () => {
    it('should update purchase status to completed', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 100,
        total_amount: 100,
        status: 'completed',
        payment_intent_id: 'pi_123',
        completed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockPurchase] }) // UPDATE purchase
        .mockResolvedValueOnce({ rows: [] }) // UPDATE position to sold
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.updatePurchaseStatus('purchase-123', PurchaseStatus.COMPLETED, 'pi_123');

      expect(result.status).toBe(PurchaseStatus.COMPLETED);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'sold'"),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw error if purchase not found', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }); // UPDATE purchase - empty

      await expect(
        service.updatePurchaseStatus('non-existent', PurchaseStatus.COMPLETED)
      ).rejects.toThrow('PURCHASE_NOT_FOUND');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getPurchaseById', () => {
    it('should return purchase when found', async () => {
      const mockPurchase = {
        purchase_id: 'purchase-123',
        user_id: 'user-123',
        campaign_id: 'campaign-123',
        position_id: 'position-1',
        quantity: 1,
        price_per_position: 100,
        total_amount: 100,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockPurchase] });

      const result = await service.getPurchaseById('purchase-123');

      expect(result).toBeDefined();
      expect(result?.purchase_id).toBe('purchase-123');
    });

    it('should return null when purchase not found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const result = await service.getPurchaseById('non-existent');

      expect(result).toBeNull();
    });
  });
});

