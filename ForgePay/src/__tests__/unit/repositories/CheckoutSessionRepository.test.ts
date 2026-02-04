import { CheckoutSessionRepository, CreateCheckoutSessionParams, UpdateCheckoutSessionParams } from '../../../repositories/CheckoutSessionRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CheckoutSessionRepository', () => {
  let mockPool: any;
  let repository: CheckoutSessionRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new CheckoutSessionRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new checkout session with all fields', async () => {
      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_123',
        purchaseIntentId: 'pi_openai_123',
        productId: 'prod-123',
        priceId: 'price-123',
        customerId: 'cust-123',
        status: 'open',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-123',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: params.customerId,
        status: params.status,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'session-123',
        developerId: params.developerId,
        stripeSessionId: params.stripeSessionId,
        purchaseIntentId: params.purchaseIntentId,
        productId: params.productId,
        priceId: params.priceId,
        customerId: params.customerId,
        status: params.status,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        expiresAt: params.expiresAt,
        createdAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO checkout_sessions'),
        [
          params.developerId,
          params.stripeSessionId,
          params.purchaseIntentId,
          params.productId,
          params.priceId,
          params.customerId,
          params.status,
          params.successUrl,
          params.cancelUrl,
          params.expiresAt,
        ]
      );
    });

    it('should create a checkout session without optional customerId', async () => {
      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_456',
        purchaseIntentId: 'pi_openai_456',
        productId: 'prod-456',
        priceId: 'price-456',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-456',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.customerId).toBeNull();
      expect(result.status).toBe('open');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO checkout_sessions'),
        [
          params.developerId,
          params.stripeSessionId,
          params.purchaseIntentId,
          params.productId,
          params.priceId,
          null,
          'open',
          params.successUrl,
          params.cancelUrl,
          params.expiresAt,
        ]
      );
    });

    it('should use default status of open when not provided', async () => {
      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_default',
        purchaseIntentId: 'pi_openai_default',
        productId: 'prod-default',
        priceId: 'price-default',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-default',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO checkout_sessions'),
        expect.arrayContaining(['open'])
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_error',
        purchaseIntentId: 'pi_openai_error',
        productId: 'prod-error',
        priceId: 'price-error',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_tx',
        purchaseIntentId: 'pi_openai_tx',
        productId: 'prod-tx',
        priceId: 'price-tx',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-tx',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
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
    it('should find a checkout session by ID', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: 'cust-123',
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('session-123');

      expect(result).toEqual({
        id: 'session-123',
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_123',
        purchaseIntentId: 'pi_openai_123',
        productId: 'prod-123',
        priceId: 'price-123',
        customerId: 'cust-123',
        status: 'open',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
        createdAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM checkout_sessions'),
        ['session-123']
      );
    });

    it('should return null if checkout session not found', async () => {
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

      await expect(repository.findById('session-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('session-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByStripeSessionId', () => {
    it('should find a checkout session by Stripe session ID', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByStripeSessionId('cs_stripe_123');

      expect(result).not.toBeNull();
      expect(result?.stripeSessionId).toBe('cs_stripe_123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE stripe_session_id = $1'),
        ['cs_stripe_123']
      );
    });

    it('should return null if checkout session not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByStripeSessionId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeSessionId('cs_stripe_123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStripeSessionId('cs_stripe_123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByPurchaseIntentId', () => {
    it('should find a checkout session by purchase intent ID', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByPurchaseIntentId('pi_openai_123');

      expect(result).not.toBeNull();
      expect(result?.purchaseIntentId).toBe('pi_openai_123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE purchase_intent_id = $1'),
        ['pi_openai_123']
      );
    });

    it('should return null if checkout session not found', async () => {
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

      await expect(repository.findByPurchaseIntentId('pi_openai_123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByPurchaseIntentId('pi_openai_123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all checkout sessions for a developer', async () => {
      const mockRows = [
        {
          id: 'session-1',
          developer_id: 'dev-123',
          stripe_session_id: 'cs_stripe_1',
          purchase_intent_id: 'pi_openai_1',
          product_id: 'prod-1',
          price_id: 'price-1',
          customer_id: 'cust-1',
          status: 'complete',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-02-01T12:00:00Z'),
          created_at: new Date('2024-02-01T10:00:00Z'),
        },
        {
          id: 'session-2',
          developer_id: 'dev-123',
          stripe_session_id: 'cs_stripe_2',
          purchase_intent_id: 'pi_openai_2',
          product_id: 'prod-2',
          price_id: 'price-2',
          customer_id: null,
          status: 'open',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-01T12:00:00Z'),
          created_at: new Date('2024-01-01T10:00:00Z'),
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
        ['dev-123', 100]
      );
    });

    it('should filter by status when provided', async () => {
      const mockRows = [
        {
          id: 'session-1',
          developer_id: 'dev-123',
          stripe_session_id: 'cs_stripe_1',
          purchase_intent_id: 'pi_openai_1',
          product_id: 'prod-1',
          price_id: 'price-1',
          customer_id: null,
          status: 'open',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-01T12:00:00Z'),
          created_at: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findByDeveloperId('dev-123', 'open');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('open');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND status = $2'),
        ['dev-123', 'open', 100]
      );
    });

    it('should respect custom limit', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', undefined, 50);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['dev-123', 50]
      );
    });

    it('should respect custom limit with status filter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', 'complete', 25);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $3'),
        ['dev-123', 'complete', 25]
      );
    });

    it('should return sessions ordered by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array)
      );
    });

    it('should return empty array if no sessions found', async () => {
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

      await repository.findByDeveloperId('dev-123', undefined, 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update checkout session status', async () => {
      const params: UpdateCheckoutSessionParams = {
        status: 'complete',
      };

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('session-123', params);

      expect(result?.status).toBe('complete');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE checkout_sessions'),
        ['complete', 'session-123']
      );
    });

    it('should update checkout session customerId', async () => {
      const params: UpdateCheckoutSessionParams = {
        customerId: 'cust-new',
      };

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: 'cust-new',
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('session-123', params);

      expect(result?.customerId).toBe('cust-new');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE checkout_sessions'),
        ['cust-new', 'session-123']
      );
    });

    it('should update multiple fields at once', async () => {
      const params: UpdateCheckoutSessionParams = {
        customerId: 'cust-complete',
        status: 'complete',
      };

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: 'cust-complete',
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('session-123', params);

      expect(result?.customerId).toBe('cust-complete');
      expect(result?.status).toBe('complete');
    });

    it('should return null if checkout session not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { status: 'complete' });

      expect(result).toBeNull();
    });

    it('should return existing session if no updates provided', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('session-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM checkout_sessions'),
        ['session-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('session-123', { status: 'complete' })).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('session-123', { status: 'complete' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('markComplete', () => {
    it('should mark checkout session as complete without customerId', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.markComplete('session-123');

      expect(result?.status).toBe('complete');
    });

    it('should mark checkout session as complete with customerId', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: 'cust-123',
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.markComplete('session-123', 'cust-123');

      expect(result?.status).toBe('complete');
      expect(result?.customerId).toBe('cust-123');
    });

    it('should return null if checkout session not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.markComplete('nonexistent');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: 'cust-123',
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.markComplete('session-123', 'cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('markExpired', () => {
    it('should mark checkout session as expired', async () => {
      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'expired',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.markExpired('session-123');

      expect(result?.status).toBe('expired');
    });

    it('should return null if checkout session not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.markExpired('nonexistent');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'session-123',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: null,
        status: 'expired',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.markExpired('session-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findExpiredSessions', () => {
    it('should find all expired checkout sessions', async () => {
      const mockRows = [
        {
          id: 'session-expired-1',
          developer_id: 'dev-123',
          stripe_session_id: 'cs_stripe_expired_1',
          purchase_intent_id: 'pi_openai_expired_1',
          product_id: 'prod-1',
          price_id: 'price-1',
          customer_id: null,
          status: 'open',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-01T12:00:00Z'),
          created_at: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'session-expired-2',
          developer_id: 'dev-456',
          stripe_session_id: 'cs_stripe_expired_2',
          purchase_intent_id: 'pi_openai_expired_2',
          product_id: 'prod-2',
          price_id: 'price-2',
          customer_id: null,
          status: 'open',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-01T11:00:00Z'),
          created_at: new Date('2024-01-01T09:00:00Z'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findExpiredSessions();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('open');
      expect(result[1].status).toBe('open');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = 'open'")
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at < NOW()')
      );
    });

    it('should return empty array if no expired sessions found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findExpiredSessions();

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findExpiredSessions()).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findExpiredSessions(mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a checkout session', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('session-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM checkout_sessions'),
        ['session-123']
      );
    });

    it('should return false if checkout session not found', async () => {
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

      const result = await repository.delete('session-123');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('session-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('session-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle checkout session with null customerId', async () => {
      const mockRow = {
        id: 'session-null-cust',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_null',
        purchase_intent_id: 'pi_openai_null',
        product_id: 'prod-null',
        price_id: 'price-null',
        customer_id: null,
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('session-null-cust');

      expect(result?.customerId).toBeNull();
    });

    it('should handle different checkout session statuses', async () => {
      const statuses = ['open', 'complete', 'expired'];

      for (const status of statuses) {
        const mockRow = {
          id: `session-${status}`,
          developer_id: 'dev-123',
          stripe_session_id: `cs_stripe_${status}`,
          purchase_intent_id: `pi_openai_${status}`,
          product_id: 'prod-123',
          price_id: 'price-123',
          customer_id: null,
          status: status,
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-01T12:00:00Z'),
          created_at: new Date('2024-01-01T10:00:00Z'),
        };

        mockPool.query.mockResolvedValueOnce({
          rows: [mockRow],
          rowCount: 1,
        } as any);

        const result = await repository.findById(`session-${status}`);

        expect(result?.status).toBe(status);
      }
    });

    it('should handle URLs with query parameters', async () => {
      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_url',
        purchaseIntentId: 'pi_openai_url',
        productId: 'prod-url',
        priceId: 'price-url',
        successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}&ref=checkout',
        cancelUrl: 'https://example.com/cancel?reason=user_cancelled&ref=checkout',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-url',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.successUrl).toBe(params.successUrl);
      expect(result.cancelUrl).toBe(params.cancelUrl);
    });

    it('should handle very long Stripe session ID', async () => {
      const longStripeId = 'cs_' + 'a'.repeat(100);

      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: longStripeId,
        purchaseIntentId: 'pi_openai_long',
        productId: 'prod-long',
        priceId: 'price-long',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-long',
        developer_id: params.developerId,
        stripe_session_id: longStripeId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.stripeSessionId).toBe(longStripeId);
    });

    it('should properly map dates from database rows', async () => {
      const expiresAt = new Date('2024-01-15T23:59:59Z');
      const createdAt = new Date('2024-01-15T10:30:00Z');

      const mockRow = {
        id: 'session-dates',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_dates',
        purchase_intent_id: 'pi_openai_dates',
        product_id: 'prod-dates',
        price_id: 'price-dates',
        customer_id: null,
        status: 'open',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: expiresAt,
        created_at: createdAt,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('session-dates');

      expect(result?.expiresAt).toEqual(expiresAt);
      expect(result?.createdAt).toEqual(createdAt);
    });

    it('should handle multiple sessions for same product', async () => {
      const mockRows = [
        {
          id: 'session-1',
          developer_id: 'dev-123',
          stripe_session_id: 'cs_stripe_1',
          purchase_intent_id: 'pi_openai_1',
          product_id: 'prod-shared',
          price_id: 'price-shared',
          customer_id: 'cust-1',
          status: 'complete',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-01T12:00:00Z'),
          created_at: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'session-2',
          developer_id: 'dev-123',
          stripe_session_id: 'cs_stripe_2',
          purchase_intent_id: 'pi_openai_2',
          product_id: 'prod-shared',
          price_id: 'price-shared',
          customer_id: 'cust-2',
          status: 'complete',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          expires_at: new Date('2024-01-02T12:00:00Z'),
          created_at: new Date('2024-01-02T10:00:00Z'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result).toHaveLength(2);
      expect(result[0].productId).toBe('prod-shared');
      expect(result[1].productId).toBe('prod-shared');
      expect(result[0].id).not.toBe(result[1].id);
    });

    it('should handle session expiration in the past', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');

      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_past',
        purchaseIntentId: 'pi_openai_past',
        productId: 'prod-past',
        priceId: 'price-past',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: pastDate,
      };

      const mockRow = {
        id: 'session-past',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: pastDate,
        created_at: new Date('2020-01-01T00:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.expiresAt).toEqual(pastDate);
    });

    it('should handle session expiration far in the future', async () => {
      const futureDate = new Date('2099-12-31T23:59:59Z');

      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_future',
        purchaseIntentId: 'pi_openai_future',
        productId: 'prod-future',
        priceId: 'price-future',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: futureDate,
      };

      const mockRow = {
        id: 'session-future',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: futureDate,
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.expiresAt).toEqual(futureDate);
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_error',
        purchaseIntentId: 'pi_openai_error',
        productId: 'prod-error',
        priceId: 'price-error',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating checkout session',
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

      await expect(repository.findById('session-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding checkout session by ID',
        expect.objectContaining({
          error: dbError,
          checkoutSessionId: 'session-123',
        })
      );
    });

    it('should log error when findByStripeSessionId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeSessionId('cs_stripe_123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding checkout session by Stripe session ID',
        expect.objectContaining({
          error: dbError,
          stripeSessionId: 'cs_stripe_123',
        })
      );
    });

    it('should log error when findByPurchaseIntentId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByPurchaseIntentId('pi_openai_123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding checkout session by purchase intent ID',
        expect.objectContaining({
          error: dbError,
          purchaseIntentId: 'pi_openai_123',
        })
      );
    });

    it('should log error when findByDeveloperId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding checkout sessions by developer ID',
        expect.objectContaining({
          error: dbError,
          developerId: 'dev-123',
        })
      );
    });

    it('should log error when findExpiredSessions fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findExpiredSessions()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding expired checkout sessions',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when update fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('session-123', { status: 'complete' })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating checkout session',
        expect.objectContaining({
          error: dbError,
          checkoutSessionId: 'session-123',
          params: { status: 'complete' },
        })
      );
    });

    it('should log error when delete fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('session-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error deleting checkout session',
        expect.objectContaining({
          error: dbError,
          checkoutSessionId: 'session-123',
        })
      );
    });

    it('should log success when checkout session is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateCheckoutSessionParams = {
        developerId: 'dev-123',
        stripeSessionId: 'cs_stripe_log',
        purchaseIntentId: 'pi_openai_log',
        productId: 'prod-log',
        priceId: 'price-log',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-01-01T12:00:00Z'),
      };

      const mockRow = {
        id: 'session-log',
        developer_id: params.developerId,
        stripe_session_id: params.stripeSessionId,
        purchase_intent_id: params.purchaseIntentId,
        product_id: params.productId,
        price_id: params.priceId,
        customer_id: null,
        status: 'open',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Checkout session created',
        expect.objectContaining({
          checkoutSessionId: 'session-log',
          stripeSessionId: params.stripeSessionId,
          purchaseIntentId: params.purchaseIntentId,
        })
      );
    });

    it('should log success when checkout session is updated', async () => {
      const { logger } = require('../../../utils/logger');

      const mockRow = {
        id: 'session-update-log',
        developer_id: 'dev-123',
        stripe_session_id: 'cs_stripe_123',
        purchase_intent_id: 'pi_openai_123',
        product_id: 'prod-123',
        price_id: 'price-123',
        customer_id: 'cust-123',
        status: 'complete',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        expires_at: new Date('2024-01-01T12:00:00Z'),
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('session-update-log', { status: 'complete' });

      expect(logger.info).toHaveBeenCalledWith(
        'Checkout session updated',
        expect.objectContaining({
          checkoutSessionId: 'session-update-log',
          updates: { status: 'complete' },
        })
      );
    });

    it('should log success when checkout session is deleted', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('session-delete-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Checkout session deleted',
        expect.objectContaining({
          checkoutSessionId: 'session-delete-log',
        })
      );
    });

    it('should not log delete when session not found', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.delete('nonexistent');

      expect(logger.info).not.toHaveBeenCalledWith(
        'Checkout session deleted',
        expect.any(Object)
      );
    });
  });
});
