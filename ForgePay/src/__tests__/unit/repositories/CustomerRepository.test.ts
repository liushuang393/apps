import { CustomerRepository, CreateCustomerParams, UpdateCustomerParams } from '../../../repositories/CustomerRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CustomerRepository', () => {
  let mockPool: any;
  let repository: CustomerRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new CustomerRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new customer with all fields', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: { plan: 'pro', source: 'website' },
      };

      const mockRow = {
        id: 'cust-123',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: params.name,
        metadata: params.metadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'cust-123',
        developerId: params.developerId,
        stripeCustomerId: params.stripeCustomerId,
        email: params.email,
        name: params.name,
        metadata: params.metadata,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO customers'),
        [
          params.developerId,
          params.stripeCustomerId,
          params.email,
          params.name,
          JSON.stringify(params.metadata),
        ]
      );
    });

    it('should create a customer without optional fields', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_456',
        email: 'minimal@example.com',
      };

      const mockRow = {
        id: 'cust-456',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.name).toBeNull();
      expect(result.metadata).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO customers'),
        [
          params.developerId,
          params.stripeCustomerId,
          params.email,
          null,
          null,
        ]
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_789',
        email: 'error@example.com',
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_tx',
        email: 'transaction@example.com',
      };

      const mockRow = {
        id: 'cust-tx',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: null,
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
    it('should find a customer by ID', async () => {
      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: { plan: 'pro' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('cust-123');

      expect(result).toEqual({
        id: 'cust-123',
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: { plan: 'pro' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM customers'),
        ['cust-123']
      );
    });

    it('should return null if customer not found', async () => {
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

      await expect(repository.findById('cust-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByStripeCustomerId', () => {
    it('should find a customer by Stripe customer ID', async () => {
      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByStripeCustomerId('cus_stripe_123');

      expect(result).not.toBeNull();
      expect(result?.stripeCustomerId).toBe('cus_stripe_123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE stripe_customer_id = $1'),
        ['cus_stripe_123']
      );
    });

    it('should return null if customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByStripeCustomerId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeCustomerId('cus_stripe_123')).rejects.toThrow('Query failed');
    });
  });

  describe('findByDeveloperIdAndEmail', () => {
    it('should find a customer by developer ID and email', async () => {
      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByDeveloperIdAndEmail('dev-123', 'customer@example.com');

      expect(result).not.toBeNull();
      expect(result?.developerId).toBe('dev-123');
      expect(result?.email).toBe('customer@example.com');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1 AND email = $2'),
        ['dev-123', 'customer@example.com']
      );
    });

    it('should return null if customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByDeveloperIdAndEmail('dev-123', 'nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperIdAndEmail('dev-123', 'customer@example.com')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperIdAndEmail('dev-123', 'customer@example.com', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    it('should find a customer by email', async () => {
      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByEmail('customer@example.com');

      expect(result).not.toBeNull();
      expect(result?.email).toBe('customer@example.com');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE email = $1'),
        ['customer@example.com']
      );
    });

    it('should return the most recently created customer when multiple exist', async () => {
      const mockRow = {
        id: 'cust-recent',
        developer_id: 'dev-456',
        stripe_customer_id: 'cus_stripe_recent',
        email: 'shared@example.com',
        name: 'Recent Customer',
        metadata: null,
        created_at: new Date('2024-06-01'),
        updated_at: new Date('2024-06-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByEmail('shared@example.com');

      expect(result?.id).toBe('cust-recent');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['shared@example.com']
      );
    });

    it('should return null if customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByEmail('customer@example.com')).rejects.toThrow('Query failed');
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all customers for a developer', async () => {
      const mockRows = [
        {
          id: 'cust-1',
          developer_id: 'dev-123',
          stripe_customer_id: 'cus_stripe_1',
          email: 'customer1@example.com',
          name: 'Customer One',
          metadata: null,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
        {
          id: 'cust-2',
          developer_id: 'dev-123',
          stripe_customer_id: 'cus_stripe_2',
          email: 'customer2@example.com',
          name: 'Customer Two',
          metadata: { plan: 'enterprise' },
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result).toHaveLength(2);
      expect(result[0].developerId).toBe('dev-123');
      expect(result[1].developerId).toBe('dev-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1'),
        ['dev-123']
      );
    });

    it('should return customers ordered by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['dev-123']
      );
    });

    it('should return empty array if no customers found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByDeveloperId('dev-empty');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findOrCreate', () => {
    it('should return existing customer if found', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_new',
        email: 'existing@example.com',
      };

      const mockRow = {
        id: 'cust-existing',
        developer_id: params.developerId,
        stripe_customer_id: 'cus_existing',
        email: params.email,
        name: 'Existing Customer',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      // First call is findByDeveloperIdAndEmail
      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findOrCreate(params);

      expect(result.created).toBe(false);
      expect(result.customer.id).toBe('cust-existing');
      expect(mockPool.query).toHaveBeenCalledTimes(1); // Only findByDeveloperIdAndEmail was called
    });

    it('should create new customer if not found', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_new',
        email: 'new@example.com',
        name: 'New Customer',
      };

      const mockCreatedRow = {
        id: 'cust-new',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: params.name,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      // First call: findByDeveloperIdAndEmail returns empty
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      // Second call: create returns new customer
      mockPool.query.mockResolvedValueOnce({
        rows: [mockCreatedRow],
        rowCount: 1,
      } as any);

      const result = await repository.findOrCreate(params);

      expect(result.created).toBe(true);
      expect(result.customer.id).toBe('cust-new');
      expect(result.customer.email).toBe(params.email);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_tx',
        email: 'transaction@example.com',
      };

      const mockRow = {
        id: 'cust-tx',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findOrCreate(params, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update customer email', async () => {
      const params: UpdateCustomerParams = {
        email: 'newemail@example.com',
      };

      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'newemail@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('cust-123', params);

      expect(result?.email).toBe('newemail@example.com');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE customers'),
        ['newemail@example.com', 'cust-123']
      );
    });

    it('should update customer name', async () => {
      const params: UpdateCustomerParams = {
        name: 'Jane Doe',
      };

      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'Jane Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('cust-123', params);

      expect(result?.name).toBe('Jane Doe');
    });

    it('should update customer metadata', async () => {
      const params: UpdateCustomerParams = {
        metadata: { plan: 'enterprise', tier: 'gold' },
      };

      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: { plan: 'enterprise', tier: 'gold' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('cust-123', params);

      expect(result?.metadata).toEqual({ plan: 'enterprise', tier: 'gold' });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE customers'),
        [JSON.stringify(params.metadata), 'cust-123']
      );
    });

    it('should update multiple fields at once', async () => {
      const params: UpdateCustomerParams = {
        email: 'updated@example.com',
        name: 'Updated Name',
        metadata: { status: 'premium' },
      };

      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'updated@example.com',
        name: 'Updated Name',
        metadata: { status: 'premium' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('cust-123', params);

      expect(result?.email).toBe('updated@example.com');
      expect(result?.name).toBe('Updated Name');
      expect(result?.metadata).toEqual({ status: 'premium' });
    });

    it('should return null if customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { email: 'new@example.com' });

      expect(result).toBeNull();
    });

    it('should return existing customer if no updates provided', async () => {
      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'customer@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('cust-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM customers'),
        ['cust-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('cust-123', { email: 'new@example.com' })).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'cust-123',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'updated@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('cust-123', { email: 'updated@example.com' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a customer', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('cust-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM customers'),
        ['cust-123']
      );
    });

    it('should return false if customer not found', async () => {
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

      const result = await repository.delete('cust-123');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('cust-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle customer with empty name string', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_empty',
        email: 'empty@example.com',
        name: '',
      };

      const mockRow = {
        id: 'cust-empty',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: '',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.name).toBe('');
    });

    it('should handle customer with empty metadata object', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_empty_meta',
        email: 'emptymeta@example.com',
        metadata: {},
      };

      const mockRow = {
        id: 'cust-empty-meta',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.metadata).toEqual({});
    });

    it('should handle customer with complex metadata', async () => {
      const complexMetadata = {
        plan: 'enterprise',
        features: ['feature1', 'feature2'],
        nested: {
          key: 'value',
          numbers: [1, 2, 3],
        },
        active: true,
        count: 42,
      };

      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_complex',
        email: 'complex@example.com',
        metadata: complexMetadata,
      };

      const mockRow = {
        id: 'cust-complex',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: complexMetadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.metadata).toEqual(complexMetadata);
    });

    it('should handle special characters in email', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_special',
        email: 'test+special.chars@sub.domain.example.com',
      };

      const mockRow = {
        id: 'cust-special',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.email).toBe('test+special.chars@sub.domain.example.com');
    });

    it('should handle unicode characters in name', async () => {
      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_stripe_unicode',
        email: 'unicode@example.com',
        name: '田中太郎 / Taro Tanaka 日本語',
      };

      const mockRow = {
        id: 'cust-unicode',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: params.name,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.name).toBe('田中太郎 / Taro Tanaka 日本語');
    });

    it('should handle very long Stripe customer ID', async () => {
      const longStripeId = 'cus_' + 'a'.repeat(100);

      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: longStripeId,
        email: 'long@example.com',
      };

      const mockRow = {
        id: 'cust-long',
        developer_id: params.developerId,
        stripe_customer_id: longStripeId,
        email: params.email,
        name: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.stripeCustomerId).toBe(longStripeId);
    });

    it('should properly map dates from database rows', async () => {
      const createdAt = new Date('2024-01-15T10:30:00Z');
      const updatedAt = new Date('2024-02-20T14:45:00Z');

      const mockRow = {
        id: 'cust-dates',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_dates',
        email: 'dates@example.com',
        name: null,
        metadata: null,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('cust-dates');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.updatedAt).toEqual(updatedAt);
    });

    it('should handle multiple customers with same email across developers', async () => {
      const mockRows = [
        {
          id: 'cust-dev1',
          developer_id: 'dev-1',
          stripe_customer_id: 'cus_1',
          email: 'shared@example.com',
          name: 'Customer for Dev 1',
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'cust-dev2',
          developer_id: 'dev-2',
          stripe_customer_id: 'cus_2',
          email: 'shared@example.com',
          name: 'Customer for Dev 2',
          metadata: null,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        },
      ];

      // findByDeveloperIdAndEmail should only return the one for that developer
      mockPool.query.mockResolvedValueOnce({
        rows: [mockRows[0]],
        rowCount: 1,
      } as any);

      const result = await repository.findByDeveloperIdAndEmail('dev-1', 'shared@example.com');

      expect(result?.developerId).toBe('dev-1');
      expect(result?.id).toBe('cust-dev1');
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_error',
        email: 'error@example.com',
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating customer',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when findById fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('cust-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding customer by ID',
        expect.objectContaining({
          error: dbError,
          customerId: 'cust-123',
        })
      );
    });

    it('should log success when customer is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateCustomerParams = {
        developerId: 'dev-123',
        stripeCustomerId: 'cus_log',
        email: 'log@example.com',
      };

      const mockRow = {
        id: 'cust-log',
        developer_id: params.developerId,
        stripe_customer_id: params.stripeCustomerId,
        email: params.email,
        name: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Customer created',
        expect.objectContaining({
          customerId: 'cust-log',
          developerId: params.developerId,
          email: params.email,
        })
      );
    });

    it('should log success when customer is updated', async () => {
      const { logger } = require('../../../utils/logger');

      const mockRow = {
        id: 'cust-update-log',
        developer_id: 'dev-123',
        stripe_customer_id: 'cus_stripe_123',
        email: 'updated@example.com',
        name: 'John Doe',
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('cust-update-log', { email: 'updated@example.com' });

      expect(logger.info).toHaveBeenCalledWith(
        'Customer updated',
        expect.objectContaining({
          customerId: 'cust-update-log',
        })
      );
    });

    it('should log success when customer is deleted', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('cust-delete-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Customer deleted',
        expect.objectContaining({
          customerId: 'cust-delete-log',
        })
      );
    });
  });
});
