import { CouponRepository, CreateCouponParams, UpdateCouponParams, RecordRedemptionParams, DiscountType } from '../../../repositories/CouponRepository';

// Mock the database pool
jest.mock('../../../config/database', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  },
}));

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { pool } from '../../../config/database';

describe('CouponRepository', () => {
  let mockPool: jest.Mocked<typeof pool>;
  let repository: CouponRepository;

  beforeEach(() => {
    mockPool = pool as jest.Mocked<typeof pool>;
    repository = new CouponRepository();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new coupon with all fields', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'SUMMER20',
        name: 'Summer Sale 20% Off',
        discountType: 'percentage' as DiscountType,
        discountValue: 20,
        currency: 'USD',
        minPurchaseAmount: 50,
        maxRedemptions: 100,
        appliesToProducts: ['prod-1', 'prod-2'],
        expiresAt: new Date('2024-12-31'),
        stripeCouponId: 'stripe_coupon_123',
        metadata: { campaign: 'summer2024' },
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: params.developerId,
        code: params.code.toUpperCase(),
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: params.currency,
        min_purchase_amount: params.minPurchaseAmount,
        max_redemptions: params.maxRedemptions,
        redemption_count: 0,
        applies_to_products: params.appliesToProducts,
        active: true,
        expires_at: params.expiresAt,
        stripe_coupon_id: params.stripeCouponId,
        metadata: params.metadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'coupon-123',
        developerId: params.developerId,
        code: params.code.toUpperCase(),
        name: params.name,
        discountType: params.discountType,
        discountValue: params.discountValue,
        currency: params.currency,
        minPurchaseAmount: params.minPurchaseAmount,
        maxRedemptions: params.maxRedemptions,
        redemptionCount: 0,
        appliesToProducts: params.appliesToProducts,
        active: true,
        expiresAt: params.expiresAt,
        stripeCouponId: params.stripeCouponId,
        metadata: params.metadata,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO coupons'),
        [
          params.developerId,
          params.code.toUpperCase(),
          params.name,
          params.discountType,
          params.discountValue,
          params.currency,
          params.minPurchaseAmount,
          params.maxRedemptions,
          params.appliesToProducts,
          params.expiresAt,
          params.stripeCouponId,
          JSON.stringify(params.metadata),
        ]
      );
    });

    it('should create a coupon with minimal required fields', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'simple10',
        name: 'Simple 10% Off',
        discountType: 'percentage' as DiscountType,
        discountValue: 10,
      };

      const mockRow = {
        id: 'coupon-456',
        developer_id: params.developerId,
        code: 'SIMPLE10',
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.currency).toBeNull();
      expect(result.minPurchaseAmount).toBeNull();
      expect(result.maxRedemptions).toBeNull();
      expect(result.appliesToProducts).toBeNull();
      expect(result.expiresAt).toBeNull();
      expect(result.stripeCouponId).toBeNull();
      expect(result.metadata).toEqual({});

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO coupons'),
        [
          params.developerId,
          'SIMPLE10',
          params.name,
          params.discountType,
          params.discountValue,
          null,
          null,
          null,
          null,
          null,
          null,
          JSON.stringify({}),
        ]
      );
    });

    it('should create a fixed_amount coupon', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'FLAT5',
        name: '$5 Off',
        discountType: 'fixed_amount' as DiscountType,
        discountValue: 500, // cents
        currency: 'USD',
      };

      const mockRow = {
        id: 'coupon-fixed',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: params.currency,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.discountType).toBe('fixed_amount');
      expect(result.discountValue).toBe(500);
      expect(result.currency).toBe('USD');
    });

    it('should convert code to uppercase', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'lowercase',
        name: 'Test',
        discountType: 'percentage' as DiscountType,
        discountValue: 10,
      };

      const mockRow = {
        id: 'coupon-upper',
        developer_id: params.developerId,
        code: 'LOWERCASE',
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      await repository.create(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO coupons'),
        expect.arrayContaining(['LOWERCASE'])
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'ERROR',
        name: 'Error Coupon',
        discountType: 'percentage' as DiscountType,
        discountValue: 10,
      };

      const dbError = new Error('Database connection failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'TX_COUPON',
        name: 'Transaction Coupon',
        discountType: 'percentage' as DiscountType,
        discountValue: 15,
      };

      const mockRow = {
        id: 'coupon-tx',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      await repository.create(params, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should find a coupon by ID', async () => {
      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'SUMMER20',
        name: 'Summer Sale',
        discount_type: 'percentage',
        discount_value: 20,
        currency: 'USD',
        min_purchase_amount: 50,
        max_redemptions: 100,
        redemption_count: 25,
        applies_to_products: ['prod-1'],
        active: true,
        expires_at: '2024-12-31T00:00:00Z',
        stripe_coupon_id: 'stripe_123',
        metadata: { source: 'email' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findById('coupon-123');

      expect(result).toEqual({
        id: 'coupon-123',
        developerId: 'dev-123',
        code: 'SUMMER20',
        name: 'Summer Sale',
        discountType: 'percentage',
        discountValue: 20,
        currency: 'USD',
        minPurchaseAmount: 50,
        maxRedemptions: 100,
        redemptionCount: 25,
        appliesToProducts: ['prod-1'],
        active: true,
        expiresAt: new Date('2024-12-31T00:00:00Z'),
        stripeCouponId: 'stripe_123',
        metadata: { source: 'email' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM coupons'),
        ['coupon-123']
      );
    });

    it('should return null if coupon not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle null expires_at', async () => {
      const mockRow = {
        id: 'coupon-no-expiry',
        developer_id: 'dev-123',
        code: 'NOEXPIRE',
        name: 'Never Expires',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findById('coupon-no-expiry');

      expect(result?.expiresAt).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.findById('coupon-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      await repository.findById('coupon-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByCode', () => {
    it('should find a coupon by developer ID and code', async () => {
      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'DISCOUNT10',
        name: '10% Discount',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findByCode('dev-123', 'discount10');

      expect(result).not.toBeNull();
      expect(result?.code).toBe('DISCOUNT10');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1 AND code = $2'),
        ['dev-123', 'DISCOUNT10']
      );
    });

    it('should convert code to uppercase for search', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.findByCode('dev-123', 'lowercase');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['dev-123', 'LOWERCASE']
      );
    });

    it('should return null if coupon not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.findByCode('dev-123', 'NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.findByCode('dev-123', 'CODE')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.findByCode('dev-123', 'CODE', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all coupons for a developer with pagination', async () => {
      const mockRows = [
        {
          id: 'coupon-1',
          developer_id: 'dev-123',
          code: 'COUPON1',
          name: 'Coupon One',
          discount_type: 'percentage',
          discount_value: 10,
          currency: null,
          min_purchase_amount: null,
          max_redemptions: null,
          redemption_count: 5,
          applies_to_products: null,
          active: true,
          expires_at: null,
          stripe_coupon_id: null,
          metadata: {},
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
        {
          id: 'coupon-2',
          developer_id: 'dev-123',
          code: 'COUPON2',
          name: 'Coupon Two',
          discount_type: 'fixed_amount',
          discount_value: 500,
          currency: 'USD',
          min_purchase_amount: 1000,
          max_redemptions: 50,
          redemption_count: 10,
          applies_to_products: ['prod-1'],
          active: true,
          expires_at: '2024-12-31',
          stripe_coupon_id: 'stripe_456',
          metadata: { campaign: 'winter' },
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
      ];

      // First call for count
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ total: '2' }],
        rowCount: 1,
      });

      // Second call for data
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      });

      const result = await repository.findByDeveloperId('dev-123');

      expect(result.coupons).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.coupons[0].developerId).toBe('dev-123');
      expect(result.coupons[1].developerId).toBe('dev-123');
    });

    it('should apply pagination options', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ total: '50' }],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.findByDeveloperId('dev-123', { limit: 10, offset: 20 });

      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        ['dev-123', 10, 20]
      );
    });

    it('should filter active coupons only when activeOnly is true', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ total: '5' }],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.findByDeveloperId('dev-123', { activeOnly: true });

      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('AND active = true AND (expires_at IS NULL OR expires_at > NOW())'),
        ['dev-123']
      );
    });

    it('should use default limit and offset', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.findByDeveloperId('dev-123');

      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        ['dev-123', 20, 0] // default limit 20, offset 0
      );
    });

    it('should return empty array if no coupons found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.findByDeveloperId('dev-empty');

      expect(result.coupons).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.findByDeveloperId('dev-123', undefined, mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update coupon name', async () => {
      const params: UpdateCouponParams = {
        name: 'Updated Coupon Name',
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Updated Coupon Name',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.name).toBe('Updated Coupon Name');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE coupons SET'),
        ['Updated Coupon Name', 'coupon-123']
      );
    });

    it('should update coupon active status', async () => {
      const params: UpdateCouponParams = {
        active: false,
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: false,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.active).toBe(false);
    });

    it('should update coupon maxRedemptions', async () => {
      const params: UpdateCouponParams = {
        maxRedemptions: 500,
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: 500,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.maxRedemptions).toBe(500);
    });

    it('should update coupon expiresAt', async () => {
      const newExpiry = new Date('2025-12-31');
      const params: UpdateCouponParams = {
        expiresAt: newExpiry,
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: newExpiry.toISOString(),
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.expiresAt).toEqual(newExpiry);
    });

    it('should update coupon stripeCouponId', async () => {
      const params: UpdateCouponParams = {
        stripeCouponId: 'new_stripe_id',
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: 'new_stripe_id',
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.stripeCouponId).toBe('new_stripe_id');
    });

    it('should update coupon metadata', async () => {
      const newMetadata = { campaign: 'updated', version: 2 };
      const params: UpdateCouponParams = {
        metadata: newMetadata,
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: newMetadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.metadata).toEqual(newMetadata);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE coupons'),
        [JSON.stringify(newMetadata), 'coupon-123']
      );
    });

    it('should update multiple fields at once', async () => {
      const params: UpdateCouponParams = {
        name: 'Multi Update',
        active: false,
        maxRedemptions: 200,
        metadata: { batch: true },
      };

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Multi Update',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: 200,
        redemption_count: 0,
        applies_to_products: null,
        active: false,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: { batch: true },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', params);

      expect(result?.name).toBe('Multi Update');
      expect(result?.active).toBe(false);
      expect(result?.maxRedemptions).toBe(200);
      expect(result?.metadata).toEqual({ batch: true });
    });

    it('should return null if coupon not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.update('nonexistent', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should return existing coupon if no updates provided', async () => {
      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.update('coupon-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM coupons'),
        ['coupon-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.update('coupon-123', { name: 'New Name' })).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Updated',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      await repository.update('coupon-123', { name: 'Updated' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('should deactivate a coupon', async () => {
      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: false,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.deactivate('coupon-123');

      expect(result?.active).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE coupons SET'),
        [false, 'coupon-123']
      );
    });

    it('should return null if coupon not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.deactivate('nonexistent');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'coupon-123',
        developer_id: 'dev-123',
        code: 'TEST',
        name: 'Test',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: false,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      await repository.deactivate('coupon-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a coupon with no redemptions', async () => {
      // First check for redemptions
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      });

      // Then delete
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await repository.delete('coupon-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT COUNT(*) as count FROM coupon_redemptions'),
        ['coupon-123']
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('DELETE FROM coupons'),
        ['coupon-123']
      );
    });

    it('should throw error if coupon has existing redemptions', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      });

      await expect(repository.delete('coupon-123')).rejects.toThrow('Cannot delete coupon with existing redemptions');
    });

    it('should return false if coupon not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Delete failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.delete('coupon-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      await repository.delete('coupon-123', mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('incrementRedemptionCount', () => {
    it('should increment redemption count', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      await repository.incrementRedemptionCount('coupon-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE coupons SET redemption_count = redemption_count + 1'),
        ['coupon-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.incrementRedemptionCount('coupon-123')).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      await repository.incrementRedemptionCount('coupon-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('recordRedemption', () => {
    it('should record a coupon redemption with all fields', async () => {
      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        checkoutSessionId: 'cs_789',
        discountAmount: 500,
        originalAmount: 2500,
        currency: 'USD',
      };

      const mockRedemptionRow = {
        id: 'redemption-1',
        coupon_id: params.couponId,
        customer_id: params.customerId,
        checkout_session_id: params.checkoutSessionId,
        discount_amount: params.discountAmount,
        original_amount: params.originalAmount,
        currency: params.currency,
        redeemed_at: new Date('2024-01-15'),
      };

      // Insert redemption
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRedemptionRow],
        rowCount: 1,
      });

      // Increment count
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await repository.recordRedemption(params);

      expect(result).toEqual({
        id: 'redemption-1',
        couponId: params.couponId,
        customerId: params.customerId,
        checkoutSessionId: params.checkoutSessionId,
        discountAmount: params.discountAmount,
        originalAmount: params.originalAmount,
        currency: params.currency,
        redeemedAt: new Date('2024-01-15'),
      });

      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO coupon_redemptions'),
        [
          params.couponId,
          params.customerId,
          params.checkoutSessionId,
          params.discountAmount,
          params.originalAmount,
          params.currency,
        ]
      );

      // Should also increment redemption count
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE coupons SET redemption_count = redemption_count + 1'),
        [params.couponId]
      );
    });

    it('should record redemption without checkout session', async () => {
      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        discountAmount: 300,
        originalAmount: 1500,
        currency: 'EUR',
      };

      const mockRedemptionRow = {
        id: 'redemption-2',
        coupon_id: params.couponId,
        customer_id: params.customerId,
        checkout_session_id: null,
        discount_amount: params.discountAmount,
        original_amount: params.originalAmount,
        currency: params.currency,
        redeemed_at: new Date('2024-01-15'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRedemptionRow],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await repository.recordRedemption(params);

      expect(result.checkoutSessionId).toBeNull();
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        [params.couponId, params.customerId, null, params.discountAmount, params.originalAmount, params.currency]
      );
    });

    it('should throw error on database failure', async () => {
      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        discountAmount: 500,
        originalAmount: 2500,
        currency: 'USD',
      };

      const dbError = new Error('Insert failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.recordRedemption(params)).rejects.toThrow('Insert failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        discountAmount: 500,
        originalAmount: 2500,
        currency: 'USD',
      };

      const mockRedemptionRow = {
        id: 'redemption-tx',
        coupon_id: params.couponId,
        customer_id: params.customerId,
        checkout_session_id: null,
        discount_amount: params.discountAmount,
        original_amount: params.originalAmount,
        currency: params.currency,
        redeemed_at: new Date('2024-01-15'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRedemptionRow],
        rowCount: 1,
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      await repository.recordRedemption(params, mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('getRedemptions', () => {
    it('should get all redemptions for a coupon', async () => {
      const mockRows = [
        {
          id: 'redemption-1',
          coupon_id: 'coupon-123',
          customer_id: 'cust-1',
          checkout_session_id: 'cs_1',
          discount_amount: 500,
          original_amount: 2500,
          currency: 'USD',
          redeemed_at: new Date('2024-01-15'),
        },
        {
          id: 'redemption-2',
          coupon_id: 'coupon-123',
          customer_id: 'cust-2',
          checkout_session_id: null,
          discount_amount: 500,
          original_amount: 3000,
          currency: 'USD',
          redeemed_at: new Date('2024-01-10'),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      });

      const result = await repository.getRedemptions('coupon-123');

      expect(result).toHaveLength(2);
      expect(result[0].couponId).toBe('coupon-123');
      expect(result[1].couponId).toBe('coupon-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY redeemed_at DESC'),
        ['coupon-123']
      );
    });

    it('should return empty array if no redemptions found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.getRedemptions('coupon-no-redemptions');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.getRedemptions('coupon-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.getRedemptions('coupon-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('getCustomerRedemptions', () => {
    it('should get all redemptions for a customer', async () => {
      const mockRows = [
        {
          id: 'redemption-1',
          coupon_id: 'coupon-1',
          customer_id: 'cust-123',
          checkout_session_id: 'cs_1',
          discount_amount: 500,
          original_amount: 2500,
          currency: 'USD',
          redeemed_at: new Date('2024-01-15'),
        },
        {
          id: 'redemption-2',
          coupon_id: 'coupon-2',
          customer_id: 'cust-123',
          checkout_session_id: 'cs_2',
          discount_amount: 1000,
          original_amount: 5000,
          currency: 'USD',
          redeemed_at: new Date('2024-01-10'),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      });

      const result = await repository.getCustomerRedemptions('cust-123');

      expect(result).toHaveLength(2);
      expect(result[0].customerId).toBe('cust-123');
      expect(result[1].customerId).toBe('cust-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE customer_id = $1'),
        ['cust-123']
      );
    });

    it('should return empty array if no redemptions found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repository.getCustomerRedemptions('cust-no-redemptions');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.getCustomerRedemptions('cust-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await repository.getCustomerRedemptions('cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('hasCustomerRedeemedCoupon', () => {
    it('should return true if customer has redeemed the coupon', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '1' }],
        rowCount: 1,
      });

      const result = await repository.hasCustomerRedeemedCoupon('coupon-123', 'cust-456');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE coupon_id = $1 AND customer_id = $2'),
        ['coupon-123', 'cust-456']
      );
    });

    it('should return false if customer has not redeemed the coupon', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      });

      const result = await repository.hasCustomerRedeemedCoupon('coupon-123', 'cust-789');

      expect(result).toBe(false);
    });

    it('should return true if customer redeemed multiple times', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      });

      const result = await repository.hasCustomerRedeemedCoupon('coupon-123', 'cust-frequent');

      expect(result).toBe(true);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      (mockPool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(repository.hasCustomerRedeemedCoupon('coupon-123', 'cust-456')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      });

      await repository.hasCustomerRedeemedCoupon('coupon-123', 'cust-456', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle coupon with empty name string', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'EMPTY',
        name: '',
        discountType: 'percentage' as DiscountType,
        discountValue: 10,
      };

      const mockRow = {
        id: 'coupon-empty',
        developer_id: params.developerId,
        code: params.code,
        name: '',
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.name).toBe('');
    });

    it('should handle coupon with empty applies_to_products array', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'NOPRODUCTS',
        name: 'No Products',
        discountType: 'percentage' as DiscountType,
        discountValue: 10,
        appliesToProducts: [],
      };

      const mockRow = {
        id: 'coupon-empty-products',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: [],
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.appliesToProducts).toEqual([]);
    });

    it('should handle coupon with complex metadata', async () => {
      const complexMetadata = {
        campaign: 'black-friday',
        rules: {
          minItems: 3,
          excludedCategories: ['sale', 'clearance'],
        },
        analytics: {
          source: 'email',
          segment: ['vip', 'returning'],
        },
      };

      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'COMPLEX',
        name: 'Complex Coupon',
        discountType: 'percentage' as DiscountType,
        discountValue: 25,
        metadata: complexMetadata,
      };

      const mockRow = {
        id: 'coupon-complex',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: complexMetadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.metadata).toEqual(complexMetadata);
    });

    it('should handle special characters in coupon code', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'SPECIAL_20%OFF',
        name: 'Special Offer',
        discountType: 'percentage' as DiscountType,
        discountValue: 20,
      };

      const mockRow = {
        id: 'coupon-special',
        developer_id: params.developerId,
        code: 'SPECIAL_20%OFF',
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.code).toBe('SPECIAL_20%OFF');
    });

    it('should handle zero discount value', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'ZERO',
        name: 'Zero Discount',
        discountType: 'percentage' as DiscountType,
        discountValue: 0,
      };

      const mockRow = {
        id: 'coupon-zero',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: 0,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.discountValue).toBe(0);
    });

    it('should handle 100% percentage discount', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'FREE100',
        name: '100% Off',
        discountType: 'percentage' as DiscountType,
        discountValue: 100,
      };

      const mockRow = {
        id: 'coupon-100',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: 100,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.discountValue).toBe(100);
    });

    it('should handle large fixed amount discount', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'BIGDISCOUNT',
        name: 'Big Discount',
        discountType: 'fixed_amount' as DiscountType,
        discountValue: 99999999, // Large amount in cents
        currency: 'USD',
      };

      const mockRow = {
        id: 'coupon-big',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: 99999999,
        currency: 'USD',
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.discountValue).toBe(99999999);
    });

    it('should properly map dates from database rows', async () => {
      const createdAt = new Date('2024-01-15T10:30:00Z');
      const updatedAt = new Date('2024-02-20T14:45:00Z');
      const expiresAt = new Date('2024-12-31T23:59:59Z');

      const mockRow = {
        id: 'coupon-dates',
        developer_id: 'dev-123',
        code: 'DATES',
        name: 'Date Test',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: expiresAt.toISOString(),
        stripe_coupon_id: null,
        metadata: {},
        created_at: createdAt,
        updated_at: updatedAt,
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findById('coupon-dates');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.updatedAt).toEqual(updatedAt);
      expect(result?.expiresAt).toEqual(expiresAt);
    });

    it('should handle multiple coupons with same code across developers', async () => {
      const mockRow = {
        id: 'coupon-dev1',
        developer_id: 'dev-1',
        code: 'SHARED',
        name: 'Shared Code Dev 1',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findByCode('dev-1', 'SHARED');

      expect(result?.developerId).toBe('dev-1');
      expect(result?.code).toBe('SHARED');
    });

    it('should handle empty metadata object from database', async () => {
      const mockRow = {
        id: 'coupon-empty-meta',
        developer_id: 'dev-123',
        code: 'EMPTYMETA',
        name: 'Empty Metadata',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: null, // null from database
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findById('coupon-empty-meta');

      expect(result?.metadata).toEqual({});
    });

    it('should handle unicode characters in coupon name', async () => {
      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'UNICODE',
        name: '特別割引 / Special Discount 日本語',
        discountType: 'percentage' as DiscountType,
        discountValue: 15,
      };

      const mockRow = {
        id: 'coupon-unicode',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.name).toBe('特別割引 / Special Discount 日本語');
    });

    it('should handle very long stripe coupon ID', async () => {
      const longStripeId = 'stripe_coupon_' + 'a'.repeat(100);

      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'LONGSTRIPE',
        name: 'Long Stripe ID',
        discountType: 'percentage' as DiscountType,
        discountValue: 10,
        stripeCouponId: longStripeId,
      };

      const mockRow = {
        id: 'coupon-long-stripe',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: longStripeId,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.stripeCouponId).toBe(longStripeId);
    });

    it('should handle very high redemption count', async () => {
      const mockRow = {
        id: 'coupon-high-redemptions',
        developer_id: 'dev-123',
        code: 'POPULAR',
        name: 'Popular Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 999999,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.findById('coupon-high-redemptions');

      expect(result?.redemptionCount).toBe(999999);
    });

    it('should handle coupon with many products in applies_to_products', async () => {
      const manyProducts = Array.from({ length: 100 }, (_, i) => `prod-${i}`);

      const params: CreateCouponParams = {
        developerId: 'dev-123',
        code: 'MANYPRODS',
        name: 'Many Products',
        discountType: 'percentage' as DiscountType,
        discountValue: 5,
        appliesToProducts: manyProducts,
      };

      const mockRow = {
        id: 'coupon-many-products',
        developer_id: params.developerId,
        code: params.code,
        name: params.name,
        discount_type: params.discountType,
        discount_value: params.discountValue,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: manyProducts,
        active: true,
        expires_at: null,
        stripe_coupon_id: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      const result = await repository.create(params);

      expect(result.appliesToProducts).toHaveLength(100);
    });
  });

  describe('redemption edge cases', () => {
    it('should handle redemption with zero discount amount', async () => {
      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        discountAmount: 0,
        originalAmount: 1000,
        currency: 'USD',
      };

      const mockRedemptionRow = {
        id: 'redemption-zero',
        coupon_id: params.couponId,
        customer_id: params.customerId,
        checkout_session_id: null,
        discount_amount: 0,
        original_amount: params.originalAmount,
        currency: params.currency,
        redeemed_at: new Date('2024-01-15'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRedemptionRow],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await repository.recordRedemption(params);

      expect(result.discountAmount).toBe(0);
    });

    it('should handle redemption with discount equal to original amount', async () => {
      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        discountAmount: 5000,
        originalAmount: 5000,
        currency: 'USD',
      };

      const mockRedemptionRow = {
        id: 'redemption-full',
        coupon_id: params.couponId,
        customer_id: params.customerId,
        checkout_session_id: null,
        discount_amount: 5000,
        original_amount: 5000,
        currency: params.currency,
        redeemed_at: new Date('2024-01-15'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRedemptionRow],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await repository.recordRedemption(params);

      expect(result.discountAmount).toBe(result.originalAmount);
    });

    it('should handle redemption with different currency', async () => {
      const params: RecordRedemptionParams = {
        couponId: 'coupon-123',
        customerId: 'cust-456',
        discountAmount: 1000,
        originalAmount: 5000,
        currency: 'JPY',
      };

      const mockRedemptionRow = {
        id: 'redemption-jpy',
        coupon_id: params.couponId,
        customer_id: params.customerId,
        checkout_session_id: null,
        discount_amount: params.discountAmount,
        original_amount: params.originalAmount,
        currency: 'JPY',
        redeemed_at: new Date('2024-01-15'),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRedemptionRow],
        rowCount: 1,
      });

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await repository.recordRedemption(params);

      expect(result.currency).toBe('JPY');
    });
  });
});
