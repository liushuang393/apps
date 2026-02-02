import { PriceRepository, CreatePriceParams, UpdatePriceParams } from './PriceRepository';

// Mock the logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('PriceRepository', () => {
  let mockPool: any;
  let repository: PriceRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new PriceRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new price with all fields', async () => {
      const params: CreatePriceParams = {
        productId: 'prod-123',
        stripePriceId: 'price_stripe_123',
        amount: 2000,
        currency: 'USD',
        interval: 'month',
        active: true,
      };

      const mockRow = {
        id: 'price-123',
        product_id: params.productId,
        stripe_price_id: params.stripePriceId,
        amount: params.amount,
        currency: 'usd',
        interval: params.interval,
        active: params.active,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'price-123',
        productId: params.productId,
        stripePriceId: params.stripePriceId,
        amount: params.amount,
        currency: 'usd',
        interval: params.interval,
        active: params.active,
        createdAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO prices'),
        [
          params.productId,
          params.stripePriceId,
          params.amount,
          'usd', // Currency normalized to lowercase
          params.interval,
          params.active,
        ]
      );
    });

    it('should create a one-time price without interval', async () => {
      const params: CreatePriceParams = {
        productId: 'prod-123',
        stripePriceId: 'price_stripe_123',
        amount: 5000,
        currency: 'EUR',
      };

      const mockRow = {
        id: 'price-456',
        product_id: params.productId,
        stripe_price_id: params.stripePriceId,
        amount: params.amount,
        currency: 'eur',
        interval: null,
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.interval).toBeNull();
      expect(result.active).toBe(true); // Default value
    });

    it('should normalize currency to lowercase', async () => {
      const params: CreatePriceParams = {
        productId: 'prod-123',
        stripePriceId: 'price_stripe_123',
        amount: 1000,
        currency: 'GBP',
      };

      const mockRow = {
        id: 'price-789',
        product_id: params.productId,
        stripe_price_id: params.stripePriceId,
        amount: params.amount,
        currency: 'gbp',
        interval: null,
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['gbp'])
      );
    });
  });

  describe('findById', () => {
    it('should find a price by ID', async () => {
      const mockRow = {
        id: 'price-123',
        product_id: 'prod-123',
        stripe_price_id: 'price_stripe_123',
        amount: 2000,
        currency: 'usd',
        interval: 'month',
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('price-123');

      expect(result).toEqual({
        id: 'price-123',
        productId: 'prod-123',
        stripePriceId: 'price_stripe_123',
        amount: 2000,
        currency: 'usd',
        interval: 'month',
        active: true,
        createdAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM prices'),
        ['price-123']
      );
    });

    it('should return null if price not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByStripePriceId', () => {
    it('should find a price by Stripe price ID', async () => {
      const mockRow = {
        id: 'price-123',
        product_id: 'prod-123',
        stripe_price_id: 'price_stripe_123',
        amount: 2000,
        currency: 'usd',
        interval: 'month',
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByStripePriceId('price_stripe_123');

      expect(result).not.toBeNull();
      expect(result?.stripePriceId).toBe('price_stripe_123');
    });
  });

  describe('findByProductId', () => {
    it('should find all prices for a product', async () => {
      const mockRows = [
        {
          id: 'price-1',
          product_id: 'prod-123',
          stripe_price_id: 'price_1',
          amount: 2000,
          currency: 'usd',
          interval: 'month',
          active: true,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'price-2',
          product_id: 'prod-123',
          stripe_price_id: 'price_2',
          amount: 20000,
          currency: 'usd',
          interval: 'year',
          active: true,
          created_at: new Date('2024-01-02'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByProductId('prod-123');

      expect(result).toHaveLength(2);
      expect(result[0].productId).toBe('prod-123');
      expect(result[1].productId).toBe('prod-123');
    });

    it('should filter by active status when activeOnly is true', async () => {
      const mockRows = [
        {
          id: 'price-1',
          product_id: 'prod-123',
          stripe_price_id: 'price_1',
          amount: 2000,
          currency: 'usd',
          interval: 'month',
          active: true,
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      await repository.findByProductId('prod-123', true);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND active = true'),
        ['prod-123']
      );
    });
  });

  describe('findByProductIdAndCurrency', () => {
    it('should find prices by product and currency', async () => {
      const mockRows = [
        {
          id: 'price-1',
          product_id: 'prod-123',
          stripe_price_id: 'price_1',
          amount: 2000,
          currency: 'eur',
          interval: 'month',
          active: true,
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findByProductIdAndCurrency('prod-123', 'EUR');

      expect(result).toHaveLength(1);
      expect(result[0].currency).toBe('eur');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE product_id = $1 AND currency = $2'),
        ['prod-123', 'eur']
      );
    });

    it('should normalize currency to lowercase', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByProductIdAndCurrency('prod-123', 'GBP');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['gbp'])
      );
    });
  });

  describe('findByCurrency', () => {
    it('should find all prices for a currency', async () => {
      const mockRows = [
        {
          id: 'price-1',
          product_id: 'prod-123',
          stripe_price_id: 'price_1',
          amount: 2000,
          currency: 'jpy',
          interval: null,
          active: true,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'price-2',
          product_id: 'prod-456',
          stripe_price_id: 'price_2',
          amount: 3000,
          currency: 'jpy',
          interval: 'month',
          active: true,
          created_at: new Date('2024-01-02'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByCurrency('JPY');

      expect(result).toHaveLength(2);
      expect(result[0].currency).toBe('jpy');
      expect(result[1].currency).toBe('jpy');
    });
  });

  describe('update', () => {
    it('should update price active status', async () => {
      const params: UpdatePriceParams = {
        active: false,
      };

      const mockRow = {
        id: 'price-123',
        product_id: 'prod-123',
        stripe_price_id: 'price_stripe_123',
        amount: 2000,
        currency: 'usd',
        interval: 'month',
        active: false,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('price-123', params);

      expect(result?.active).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE prices'),
        [false, 'price-123']
      );
    });

    it('should return null if price not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { active: false });

      expect(result).toBeNull();
    });

    it('should return existing price if no updates provided', async () => {
      const mockRow = {
        id: 'price-123',
        product_id: 'prod-123',
        stripe_price_id: 'price_stripe_123',
        amount: 2000,
        currency: 'usd',
        interval: 'month',
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('price-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM prices'),
        ['price-123']
      );
    });
  });

  describe('deactivate', () => {
    it('should deactivate a price', async () => {
      const mockRow = {
        id: 'price-123',
        product_id: 'prod-123',
        stripe_price_id: 'price_stripe_123',
        amount: 2000,
        currency: 'usd',
        interval: 'month',
        active: false,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.deactivate('price-123');

      expect(result?.active).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE prices'),
        ['price-123']
      );
    });
  });

  describe('delete', () => {
    it('should delete a price', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('price-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM prices'),
        ['price-123']
      );
    });

    it('should return false if price not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('countByProductId', () => {
    it('should count all prices for a product', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      const result = await repository.countByProductId('prod-123');

      expect(result).toBe(5);
    });

    it('should count only active prices when activeOnly is true', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '3' }],
        rowCount: 1,
      } as any);

      const result = await repository.countByProductId('prod-123', true);

      expect(result).toBe(3);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND active = true'),
        ['prod-123']
      );
    });
  });

  describe('edge cases', () => {
    it('should handle zero amount prices', async () => {
      const params: CreatePriceParams = {
        productId: 'prod-123',
        stripePriceId: 'price_free',
        amount: 0,
        currency: 'usd',
      };

      const mockRow = {
        id: 'price-free',
        product_id: params.productId,
        stripe_price_id: params.stripePriceId,
        amount: 0,
        currency: 'usd',
        interval: null,
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.amount).toBe(0);
    });

    it('should handle large amounts', async () => {
      const params: CreatePriceParams = {
        productId: 'prod-123',
        stripePriceId: 'price_enterprise',
        amount: 999999999,
        currency: 'usd',
      };

      const mockRow = {
        id: 'price-enterprise',
        product_id: params.productId,
        stripe_price_id: params.stripePriceId,
        amount: 999999999,
        currency: 'usd',
        interval: null,
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.amount).toBe(999999999);
    });

    it('should handle year interval for subscriptions', async () => {
      const params: CreatePriceParams = {
        productId: 'prod-123',
        stripePriceId: 'price_yearly',
        amount: 20000,
        currency: 'usd',
        interval: 'year',
      };

      const mockRow = {
        id: 'price-yearly',
        product_id: params.productId,
        stripe_price_id: params.stripePriceId,
        amount: 20000,
        currency: 'usd',
        interval: 'year',
        active: true,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.interval).toBe('year');
    });
  });
});
