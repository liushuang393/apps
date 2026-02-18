import { DeveloperRepository, CreateDeveloperParams, UpdateDeveloperParams } from '../../../repositories/DeveloperRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('DeveloperRepository', () => {
  let mockPool: any;
  let repository: DeveloperRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new DeveloperRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new developer with all fields', async () => {
      const params: CreateDeveloperParams = {
        email: 'developer@example.com',
        apiKeyHash: 'hashed_api_key_123',
        stripeAccountId: 'acct_stripe_123',
        webhookSecret: 'whsec_secret_123',
        testMode: false,
      };

      const mockRow = {
        id: 'dev-123',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: params.stripeAccountId,
        webhook_secret: params.webhookSecret,
        test_mode: params.testMode,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'dev-123',
        email: params.email,
        stripeAccountId: params.stripeAccountId,
        apiKeyHash: params.apiKeyHash,
        webhookSecret: params.webhookSecret,
        testMode: false,
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
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO developers'),
        [
          params.email,
          params.apiKeyHash,
          params.stripeAccountId,
          params.webhookSecret,
          false,
        ]
      );
    });

    it('should create a developer without optional fields', async () => {
      const params: CreateDeveloperParams = {
        email: 'minimal@example.com',
        apiKeyHash: 'hashed_api_key_456',
      };

      const mockRow = {
        id: 'dev-456',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.stripeAccountId).toBeNull();
      expect(result.webhookSecret).toBeNull();
      expect(result.testMode).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO developers'),
        [
          params.email,
          params.apiKeyHash,
          null,
          null,
          true,
        ]
      );
    });

    it('should default testMode to true when not provided', async () => {
      const params: CreateDeveloperParams = {
        email: 'test@example.com',
        apiKeyHash: 'hashed_key',
      };

      const mockRow = {
        id: 'dev-default',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO developers'),
        expect.arrayContaining([true])
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateDeveloperParams = {
        email: 'error@example.com',
        apiKeyHash: 'hashed_key',
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateDeveloperParams = {
        email: 'transaction@example.com',
        apiKeyHash: 'hashed_key_tx',
      };

      const mockRow = {
        id: 'dev-tx',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
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
    it('should find a developer by ID', async () => {
      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: 'whsec_123',
        test_mode: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('dev-123');

      expect(result).toEqual({
        id: 'dev-123',
        email: 'developer@example.com',
        stripeAccountId: 'acct_123',
        apiKeyHash: 'hashed_key',
        webhookSecret: 'whsec_123',
        testMode: false,
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
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM developers WHERE id = $1'),
        ['dev-123']
      );
    });

    it('should return null if developer not found', async () => {
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

      await expect(repository.findById('dev-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('dev-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    it('should find a developer by email', async () => {
      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByEmail('developer@example.com');

      expect(result).not.toBeNull();
      expect(result?.email).toBe('developer@example.com');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM developers WHERE email = $1'),
        ['developer@example.com']
      );
    });

    it('should return null if developer not found', async () => {
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

      await expect(repository.findByEmail('developer@example.com')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByEmail('developer@example.com', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByStripeAccountId', () => {
    it('should find a developer by Stripe account ID', async () => {
      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_stripe_123',
        webhook_secret: 'whsec_123',
        test_mode: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByStripeAccountId('acct_stripe_123');

      expect(result).not.toBeNull();
      expect(result?.stripeAccountId).toBe('acct_stripe_123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM developers WHERE stripe_account_id = $1'),
        ['acct_stripe_123']
      );
    });

    it('should return null if developer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByStripeAccountId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeAccountId('acct_123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStripeAccountId('acct_123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByApiKeyHash', () => {
    it('should find a developer by API key hash', async () => {
      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_api_key_unique',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByApiKeyHash('hashed_api_key_unique');

      expect(result).not.toBeNull();
      expect(result?.apiKeyHash).toBe('hashed_api_key_unique');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM developers WHERE api_key_hash = $1'),
        ['hashed_api_key_unique']
      );
    });

    it('should return null if developer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByApiKeyHash('nonexistent_hash');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByApiKeyHash('hashed_key')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByApiKeyHash('hashed_key', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update developer email', async () => {
      const params: UpdateDeveloperParams = {
        email: 'newemail@example.com',
      };

      const mockRow = {
        id: 'dev-123',
        email: 'newemail@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.email).toBe('newemail@example.com');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE developers'),
        ['newemail@example.com', 'dev-123']
      );
    });

    it('should update developer stripeAccountId', async () => {
      const params: UpdateDeveloperParams = {
        stripeAccountId: 'acct_new_123',
      };

      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_new_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.stripeAccountId).toBe('acct_new_123');
    });

    it('should update developer webhookSecret', async () => {
      const params: UpdateDeveloperParams = {
        webhookSecret: 'whsec_new_secret',
      };

      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: 'whsec_new_secret',
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.webhookSecret).toBe('whsec_new_secret');
    });

    it('should update developer testMode', async () => {
      const params: UpdateDeveloperParams = {
        testMode: false,
      };

      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.testMode).toBe(false);
    });

    it('should update developer apiKeyHash', async () => {
      const params: UpdateDeveloperParams = {
        apiKeyHash: 'new_hashed_key',
      };

      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'new_hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.apiKeyHash).toBe('new_hashed_key');
    });

    it('should update multiple fields at once', async () => {
      const params: UpdateDeveloperParams = {
        email: 'updated@example.com',
        stripeAccountId: 'acct_updated',
        webhookSecret: 'whsec_updated',
        testMode: false,
        apiKeyHash: 'updated_hash',
      };

      const mockRow = {
        id: 'dev-123',
        email: 'updated@example.com',
        api_key_hash: 'updated_hash',
        stripe_account_id: 'acct_updated',
        webhook_secret: 'whsec_updated',
        test_mode: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.email).toBe('updated@example.com');
      expect(result?.stripeAccountId).toBe('acct_updated');
      expect(result?.webhookSecret).toBe('whsec_updated');
      expect(result?.testMode).toBe(false);
      expect(result?.apiKeyHash).toBe('updated_hash');
    });

    it('should return null if developer not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { email: 'new@example.com' });

      expect(result).toBeNull();
    });

    it('should return existing developer if no updates provided', async () => {
      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM developers'),
        ['dev-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('dev-123', { email: 'new@example.com' })).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'dev-123',
        email: 'updated@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('dev-123', { email: 'updated@example.com' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a developer', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('dev-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM developers WHERE id = $1'),
        ['dev-123']
      );
    });

    it('should return false if developer not found', async () => {
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

      const result = await repository.delete('dev-123');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('dev-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('dev-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should list developers with default pagination', async () => {
      const mockRows = [
        {
          id: 'dev-1',
          email: 'dev1@example.com',
          api_key_hash: 'hash_1',
          stripe_account_id: 'acct_1',
          webhook_secret: null,
          test_mode: true,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
        {
          id: 'dev-2',
          email: 'dev2@example.com',
          api_key_hash: 'hash_2',
          stripe_account_id: 'acct_2',
          webhook_secret: 'whsec_2',
          test_mode: false,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({
          rows: mockRows,
          rowCount: 2,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '10' }],
          rowCount: 1,
        } as any);

      const result = await repository.list();

      expect(result.developers).toHaveLength(2);
      expect(result.total).toBe(10);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC LIMIT'),
        [50, 0]
      );
    });

    it('should list developers with custom limit and offset', async () => {
      const mockRows = [
        {
          id: 'dev-1',
          email: 'dev1@example.com',
          api_key_hash: 'hash_1',
          stripe_account_id: null,
          webhook_secret: null,
          test_mode: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({
          rows: mockRows,
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '100' }],
          rowCount: 1,
        } as any);

      const result = await repository.list({ limit: 10, offset: 20 });

      expect(result.developers).toHaveLength(1);
      expect(result.total).toBe(100);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [10, 20]
      );
    });

    it('should filter developers by testMode true', async () => {
      const mockRows = [
        {
          id: 'dev-test',
          email: 'test@example.com',
          api_key_hash: 'hash_test',
          stripe_account_id: null,
          webhook_secret: null,
          test_mode: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({
          rows: mockRows,
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '5' }],
          rowCount: 1,
        } as any);

      const result = await repository.list({ testMode: true });

      expect(result.developers).toHaveLength(1);
      expect(result.developers[0].testMode).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE test_mode = $1'),
        [true, 50, 0]
      );
    });

    it('should filter developers by testMode false', async () => {
      const mockRows = [
        {
          id: 'dev-live',
          email: 'live@example.com',
          api_key_hash: 'hash_live',
          stripe_account_id: 'acct_live',
          webhook_secret: 'whsec_live',
          test_mode: false,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({
          rows: mockRows,
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '3' }],
          rowCount: 1,
        } as any);

      const result = await repository.list({ testMode: false });

      expect(result.developers).toHaveLength(1);
      expect(result.developers[0].testMode).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE test_mode = $1'),
        [false, 50, 0]
      );
    });

    it('should return empty array if no developers found', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '0' }],
          rowCount: 1,
        } as any);

      const result = await repository.list();

      expect(result.developers).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.list()).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '0' }],
          rowCount: 1,
        } as any);

      await repository.list({}, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should combine testMode filter with pagination', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '0' }],
          rowCount: 1,
        } as any);

      await repository.list({ testMode: true, limit: 25, offset: 50 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE test_mode = $1'),
        [true, 25, 50]
      );
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in email', async () => {
      const params: CreateDeveloperParams = {
        email: 'test+special.chars@sub.domain.example.com',
        apiKeyHash: 'hashed_key',
      };

      const mockRow = {
        id: 'dev-special',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
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

    it('should handle very long API key hash', async () => {
      const longHash = 'hash_' + 'a'.repeat(500);

      const params: CreateDeveloperParams = {
        email: 'long@example.com',
        apiKeyHash: longHash,
      };

      const mockRow = {
        id: 'dev-long',
        email: params.email,
        api_key_hash: longHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.apiKeyHash).toBe(longHash);
    });

    it('should handle very long Stripe account ID', async () => {
      const longStripeId = 'acct_' + 'a'.repeat(100);

      const params: CreateDeveloperParams = {
        email: 'stripe@example.com',
        apiKeyHash: 'hash',
        stripeAccountId: longStripeId,
      };

      const mockRow = {
        id: 'dev-stripe',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: longStripeId,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.stripeAccountId).toBe(longStripeId);
    });

    it('should properly map dates from database rows', async () => {
      const createdAt = new Date('2024-01-15T10:30:00Z');
      const updatedAt = new Date('2024-02-20T14:45:00Z');

      const mockRow = {
        id: 'dev-dates',
        email: 'dates@example.com',
        api_key_hash: 'hash',
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('dev-dates');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.updatedAt).toEqual(updatedAt);
    });

    it('should handle null stripeAccountId', async () => {
      const mockRow = {
        id: 'dev-null-stripe',
        email: 'nostripe@example.com',
        api_key_hash: 'hash',
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('dev-null-stripe');

      expect(result?.stripeAccountId).toBeNull();
    });

    it('should handle null webhookSecret', async () => {
      const mockRow = {
        id: 'dev-null-webhook',
        email: 'nowebhook@example.com',
        api_key_hash: 'hash',
        stripe_account_id: 'acct_123',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('dev-null-webhook');

      expect(result?.webhookSecret).toBeNull();
    });

    it('should correctly set testMode to false', async () => {
      const params: CreateDeveloperParams = {
        email: 'live@example.com',
        apiKeyHash: 'hash',
        testMode: false,
      };

      const mockRow = {
        id: 'dev-live',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.testMode).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO developers'),
        expect.arrayContaining([false])
      );
    });

    it('should handle webhook secret with special characters', async () => {
      const specialSecret = 'whsec_test123!@#$%^&*()_+-=[]{}|;:,.<>?';

      const params: CreateDeveloperParams = {
        email: 'webhook@example.com',
        apiKeyHash: 'hash',
        webhookSecret: specialSecret,
      };

      const mockRow = {
        id: 'dev-webhook-special',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: specialSecret,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.webhookSecret).toBe(specialSecret);
    });

    it('should handle update with empty string stripeAccountId', async () => {
      const params: UpdateDeveloperParams = {
        stripeAccountId: '',
      };

      const mockRow = {
        id: 'dev-123',
        email: 'developer@example.com',
        api_key_hash: 'hashed_key',
        stripe_account_id: '',
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('dev-123', params);

      expect(result?.stripeAccountId).toBe('');
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateDeveloperParams = {
        email: 'error@example.com',
        apiKeyHash: 'hash',
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating developer',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when findById fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('dev-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding developer',
        expect.objectContaining({
          error: dbError,
          id: 'dev-123',
        })
      );
    });

    it('should log error when findByEmail fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByEmail('test@example.com')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding developer by email',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when findByStripeAccountId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeAccountId('acct_123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding developer by Stripe account',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when findByApiKeyHash fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByApiKeyHash('hash')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding developer by API key',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when update fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('dev-123', { email: 'new@example.com' })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating developer',
        expect.objectContaining({
          error: dbError,
          id: 'dev-123',
        })
      );
    });

    it('should log error when delete fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('dev-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error deleting developer',
        expect.objectContaining({
          error: dbError,
          id: 'dev-123',
        })
      );
    });

    it('should log error when list fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('List failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.list()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error listing developers',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log success when developer is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateDeveloperParams = {
        email: 'log@example.com',
        apiKeyHash: 'hash',
      };

      const mockRow = {
        id: 'dev-log',
        email: params.email,
        api_key_hash: params.apiKeyHash,
        stripe_account_id: null,
        webhook_secret: null,
        test_mode: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Developer created',
        expect.objectContaining({
          developerId: 'dev-log',
          email: '***', // Email is masked in the log
        })
      );
    });

    it('should log success when developer is deleted', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('dev-delete-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Developer deleted',
        expect.objectContaining({
          developerId: 'dev-delete-log',
        })
      );
    });

    it('should not log when delete does not find developer', async () => {
      const { logger } = require('../../../utils/logger');
      jest.clearAllMocks();

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.delete('nonexistent');

      expect(logger.info).not.toHaveBeenCalledWith(
        'Developer deleted',
        expect.anything()
      );
    });
  });
});
