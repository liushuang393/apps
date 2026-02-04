import {
  ProductRepository,
  CreateProductParams,
  UpdateProductParams,
} from '../../../repositories/ProductRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ProductRepository', () => {
  let repository: ProductRepository;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    // Create mock client
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    } as any;

    repository = new ProductRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new product with all fields', async () => {
      const params: CreateProductParams = {
        developerId: 'dev-123',
        stripeProductId: 'prod_stripe_123',
        name: 'Pro Plan',
        description: 'Professional plan with all features',
        type: 'subscription',
        active: true,
        metadata: { tier: 'pro' },
      };

      const mockRow = {
        id: 'prod-123',
        developer_id: params.developerId,
        stripe_product_id: params.stripeProductId,
        name: params.name,
        description: params.description,
        type: params.type,
        active: params.active,
        metadata: params.metadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'prod-123',
        developerId: params.developerId,
        stripeProductId: params.stripeProductId,
        name: params.name,
        description: params.description,
        type: params.type,
        active: params.active,
        metadata: params.metadata,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO products'),
        [
          params.developerId,
          params.stripeProductId,
          params.name,
          params.description,
          params.type,
          params.active,
          JSON.stringify(params.metadata),
        ]
      );
    });

    it('should create a product with minimal fields', async () => {
      const params: CreateProductParams = {
        developerId: 'dev-123',
        stripeProductId: 'prod_stripe_123',
        name: 'Basic Plan',
        type: 'one_time',
      };

      const mockRow = {
        id: 'prod-456',
        developer_id: params.developerId,
        stripe_product_id: params.stripeProductId,
        name: params.name,
        description: null,
        type: params.type,
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.create(params);

      expect(result.description).toBeNull();
      expect(result.metadata).toBeNull();
      expect(result.active).toBe(true);
    });

    it('should use provided client for transactions', async () => {
      const params: CreateProductParams = {
        developerId: 'dev-123',
        stripeProductId: 'prod_stripe_123',
        name: 'Pro Plan',
        type: 'subscription',
      };

      const mockRow = {
        id: 'prod-123',
        developer_id: params.developerId,
        stripe_product_id: params.stripeProductId,
        name: params.name,
        description: null,
        type: params.type,
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValue({ rows: [mockRow] } as any);

      await repository.create(params, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      const params: CreateProductParams = {
        developerId: 'dev-123',
        stripeProductId: 'prod_stripe_123',
        name: 'Pro Plan',
        type: 'subscription',
      };

      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.create(params)).rejects.toThrow('Database error');
    });
  });

  describe('findById', () => {
    it('should find a product by ID', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Pro Plan',
        description: 'Professional plan',
        type: 'subscription',
        active: true,
        metadata: { tier: 'pro' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.findById('prod-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('prod-123');
      expect(result?.name).toBe('Pro Plan');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM products'),
        ['prod-123']
      );
    });

    it('should return null if product not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByStripeProductId', () => {
    it('should find a product by Stripe product ID', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Pro Plan',
        description: null,
        type: 'subscription',
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.findByStripeProductId('prod_stripe_123');

      expect(result).not.toBeNull();
      expect(result?.stripeProductId).toBe('prod_stripe_123');
    });

    it('should return null if product not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any);

      const result = await repository.findByStripeProductId('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all products for a developer', async () => {
      const mockRows = [
        {
          id: 'prod-1',
          developer_id: 'dev-123',
          stripe_product_id: 'prod_stripe_1',
          name: 'Product 1',
          description: null,
          type: 'subscription',
          active: true,
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'prod-2',
          developer_id: 'dev-123',
          stripe_product_id: 'prod_stripe_2',
          name: 'Product 2',
          description: null,
          type: 'one_time',
          active: false,
          metadata: null,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        },
      ];

      mockPool.query.mockResolvedValue({ rows: mockRows } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('prod-1');
      expect(result[1].id).toBe('prod-2');
    });

    it('should find only active products when activeOnly is true', async () => {
      const mockRows = [
        {
          id: 'prod-1',
          developer_id: 'dev-123',
          stripe_product_id: 'prod_stripe_1',
          name: 'Product 1',
          description: null,
          type: 'subscription',
          active: true,
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValue({ rows: mockRows } as any);

      const result = await repository.findByDeveloperId('dev-123', true);

      expect(result).toHaveLength(1);
      expect(result[0].active).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND active = true'),
        ['dev-123']
      );
    });

    it('should return empty array if no products found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result).toEqual([]);
    });
  });

  describe('findActiveByDeveloperId', () => {
    it('should find only active products', async () => {
      const mockRows = [
        {
          id: 'prod-1',
          developer_id: 'dev-123',
          stripe_product_id: 'prod_stripe_1',
          name: 'Product 1',
          description: null,
          type: 'subscription',
          active: true,
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValue({ rows: mockRows } as any);

      const result = await repository.findActiveByDeveloperId('dev-123');

      expect(result).toHaveLength(1);
      expect(result[0].active).toBe(true);
    });
  });

  describe('update', () => {
    it('should update product name', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Updated Name',
        description: 'Original description',
        type: 'subscription',
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.update('prod-123', { name: 'Updated Name' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Updated Name');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE products'),
        ['Updated Name', 'prod-123']
      );
    });

    it('should update multiple fields', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Updated Name',
        description: 'Updated description',
        type: 'subscription',
        active: false,
        metadata: { updated: true },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const params: UpdateProductParams = {
        name: 'Updated Name',
        description: 'Updated description',
        active: false,
        metadata: { updated: true },
      };

      const result = await repository.update('prod-123', params);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Updated Name');
      expect(result?.description).toBe('Updated description');
      expect(result?.active).toBe(false);
      expect(result?.metadata).toEqual({ updated: true });
    });

    it('should return null if product not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any);

      const result = await repository.update('non-existent', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should handle empty update params', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Original Name',
        description: null,
        type: 'subscription',
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.update('prod-123', {});

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Original Name');
    });
  });

  describe('archive', () => {
    it('should archive a product', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Pro Plan',
        description: null,
        type: 'subscription',
        active: false,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await repository.archive('prod-123');

      expect(result).not.toBeNull();
      expect(result?.active).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE products'),
        ['prod-123']
      );
    });

    it('should return null if product not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any);

      const result = await repository.archive('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a product', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 } as any);

      const result = await repository.delete('prod-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM products'),
        ['prod-123']
      );
    });

    it('should return false if product not found', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 0 } as any);

      const result = await repository.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('countByDeveloperId', () => {
    it('should count all products for a developer', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: '5' }] } as any);

      const result = await repository.countByDeveloperId('dev-123');

      expect(result).toBe(5);
    });

    it('should count only active products when activeOnly is true', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: '3' }] } as any);

      const result = await repository.countByDeveloperId('dev-123', true);

      expect(result).toBe(3);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND active = true'),
        ['dev-123']
      );
    });

    it('should return 0 if no products found', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: '0' }] } as any);

      const result = await repository.countByDeveloperId('dev-123');

      expect(result).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw error on findById failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.findById('prod-123')).rejects.toThrow('Database error');
    });

    it('should throw error on findByStripeProductId failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.findByStripeProductId('prod_stripe_123')).rejects.toThrow('Database error');
    });

    it('should throw error on findByDeveloperId failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow('Database error');
    });

    it('should throw error on update failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.update('prod-123', { name: 'New Name' })).rejects.toThrow('Database error');
    });

    it('should throw error on archive failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.archive('prod-123')).rejects.toThrow('Database error');
    });

    it('should throw error on delete failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.delete('prod-123')).rejects.toThrow('Database error');
    });

    it('should throw error on countByDeveloperId failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(repository.countByDeveloperId('dev-123')).rejects.toThrow('Database error');
    });

    it('should handle null rowCount on delete', async () => {
      mockPool.query.mockResolvedValue({ rowCount: null } as any);

      const result = await repository.delete('prod-123');

      expect(result).toBe(false);
    });
  });

  describe('transaction support', () => {
    it('should use provided client for findById', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Pro Plan',
        description: null,
        type: 'subscription',
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValue({ rows: [mockRow] } as any);

      await repository.findById('prod-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for findByStripeProductId', async () => {
      mockClient.query.mockResolvedValue({ rows: [] } as any);

      await repository.findByStripeProductId('prod_stripe_123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for findByDeveloperId', async () => {
      mockClient.query.mockResolvedValue({ rows: [] } as any);

      await repository.findByDeveloperId('dev-123', false, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for findActiveByDeveloperId', async () => {
      mockClient.query.mockResolvedValue({ rows: [] } as any);

      await repository.findActiveByDeveloperId('dev-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for update', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Updated Name',
        description: null,
        type: 'subscription',
        active: true,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValue({ rows: [mockRow] } as any);

      await repository.update('prod-123', { name: 'Updated Name' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for archive', async () => {
      const mockRow = {
        id: 'prod-123',
        developer_id: 'dev-123',
        stripe_product_id: 'prod_stripe_123',
        name: 'Pro Plan',
        description: null,
        type: 'subscription',
        active: false,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValue({ rows: [mockRow] } as any);

      await repository.archive('prod-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for delete', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 } as any);

      await repository.delete('prod-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should use provided client for countByDeveloperId', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ count: '5' }] } as any);

      await repository.countByDeveloperId('dev-123', false, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });
});
