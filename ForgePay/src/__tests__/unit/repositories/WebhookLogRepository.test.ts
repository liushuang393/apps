import { WebhookLogRepository, CreateWebhookLogParams, UpdateWebhookLogParams } from '../../../repositories/WebhookLogRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('WebhookLogRepository', () => {
  let mockPool: any;
  let repository: WebhookLogRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new WebhookLogRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new webhook log with all fields', async () => {
      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_stripe_123',
        eventType: 'payment_intent.succeeded',
        payload: { id: 'pi_123', amount: 1000 },
        signature: 'whsec_test_signature',
        status: 'pending',
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: params.payload,
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'wh-123',
        stripeEventId: params.stripeEventId,
        eventType: params.eventType,
        payload: params.payload,
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        errorMessage: null,
        createdAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO webhook_events'),
        [
          params.stripeEventId,
          params.eventType,
          JSON.stringify(params.payload),
          params.signature,
          'pending',
        ]
      );
    });

    it('should create a webhook log with default status when not provided', async () => {
      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_stripe_456',
        eventType: 'customer.created',
        payload: { id: 'cus_123' },
        signature: 'whsec_signature_456',
      };

      const mockRow = {
        id: 'wh-456',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: params.payload,
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.status).toBe('pending');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO webhook_events'),
        [
          params.stripeEventId,
          params.eventType,
          JSON.stringify(params.payload),
          params.signature,
          'pending',
        ]
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_stripe_error',
        eventType: 'payment_intent.failed',
        payload: {},
        signature: 'whsec_error',
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_stripe_tx',
        eventType: 'invoice.paid',
        payload: { id: 'inv_123' },
        signature: 'whsec_tx',
      };

      const mockRow = {
        id: 'wh-tx',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: params.payload,
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
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
    it('should find a webhook log by ID', async () => {
      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: { id: 'pi_123' },
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01T10:00:00Z'),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('wh-123');

      expect(result).toEqual({
        id: 'wh-123',
        stripeEventId: 'evt_stripe_123',
        eventType: 'payment_intent.succeeded',
        payload: { id: 'pi_123' },
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        lastAttemptAt: new Date('2024-01-01T10:00:00Z'),
        errorMessage: null,
        createdAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM webhook_events'),
        ['wh-123']
      );
    });

    it('should return null if webhook log not found', async () => {
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

      await expect(repository.findById('wh-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('wh-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByStripeEventId', () => {
    it('should find a webhook log by Stripe event ID', async () => {
      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: { id: 'pi_123' },
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01'),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByStripeEventId('evt_stripe_123');

      expect(result).not.toBeNull();
      expect(result?.stripeEventId).toBe('evt_stripe_123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE stripe_event_id = $1'),
        ['evt_stripe_123']
      );
    });

    it('should return null if webhook log not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByStripeEventId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeEventId('evt_stripe_123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStripeEventId('evt_stripe_123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('isEventProcessed', () => {
    it('should return true if event is processed', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'wh-123' }],
        rowCount: 1,
      } as any);

      const result = await repository.isEventProcessed('evt_stripe_123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE stripe_event_id = $1 AND status = 'processed'"),
        ['evt_stripe_123']
      );
    });

    it('should return false if event is not processed', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.isEventProcessed('evt_stripe_456');

      expect(result).toBe(false);
    });

    it('should return false if event does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.isEventProcessed('nonexistent');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.isEventProcessed('evt_stripe_123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.isEventProcessed('evt_stripe_123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByStatus', () => {
    it('should find webhook logs by status', async () => {
      const mockRows = [
        {
          id: 'wh-1',
          stripe_event_id: 'evt_1',
          event_type: 'payment_intent.succeeded',
          payload: {},
          signature: 'sig1',
          status: 'pending',
          attempts: 0,
          last_attempt_at: null,
          error_message: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'wh-2',
          stripe_event_id: 'evt_2',
          event_type: 'customer.created',
          payload: {},
          signature: 'sig2',
          status: 'pending',
          attempts: 0,
          last_attempt_at: null,
          error_message: null,
          created_at: new Date('2024-01-02'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByStatus('pending');

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('pending');
      expect(result[1].status).toBe('pending');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        ['pending', 100]
      );
    });

    it('should respect limit parameter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStatus('pending', 50);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['pending', 50]
      );
    });

    it('should return empty array if no logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByStatus('dlq');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStatus('pending')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByStatus('pending', 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByEventType', () => {
    it('should find webhook logs by event type', async () => {
      const mockRows = [
        {
          id: 'wh-1',
          stripe_event_id: 'evt_1',
          event_type: 'payment_intent.succeeded',
          payload: { amount: 1000 },
          signature: 'sig1',
          status: 'processed',
          attempts: 1,
          last_attempt_at: new Date('2024-01-01'),
          error_message: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'wh-2',
          stripe_event_id: 'evt_2',
          event_type: 'payment_intent.succeeded',
          payload: { amount: 2000 },
          signature: 'sig2',
          status: 'processed',
          attempts: 1,
          last_attempt_at: new Date('2024-01-02'),
          error_message: null,
          created_at: new Date('2024-01-02'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByEventType('payment_intent.succeeded');

      expect(result).toHaveLength(2);
      expect(result[0].eventType).toBe('payment_intent.succeeded');
      expect(result[1].eventType).toBe('payment_intent.succeeded');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE event_type = $1'),
        ['payment_intent.succeeded', 100]
      );
    });

    it('should respect limit parameter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByEventType('customer.created', 25);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['customer.created', 25]
      );
    });

    it('should return empty array if no logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByEventType('nonexistent.event');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByEventType('payment_intent.succeeded')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByEventType('payment_intent.succeeded', 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findFailedForRetry', () => {
    it('should find failed webhook logs for retry', async () => {
      const mockRows = [
        {
          id: 'wh-1',
          stripe_event_id: 'evt_1',
          event_type: 'payment_intent.failed',
          payload: {},
          signature: 'sig1',
          status: 'failed',
          attempts: 2,
          last_attempt_at: new Date('2024-01-01T10:00:00Z'),
          error_message: 'Timeout error',
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'wh-2',
          stripe_event_id: 'evt_2',
          event_type: 'invoice.payment_failed',
          payload: {},
          signature: 'sig2',
          status: 'failed',
          attempts: 3,
          last_attempt_at: new Date('2024-01-01T11:00:00Z'),
          error_message: 'Connection error',
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findFailedForRetry();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('failed');
      expect(result[0].attempts).toBeLessThan(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = 'failed' AND attempts < $1"),
        [5, 100]
      );
    });

    it('should respect maxAttempts parameter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findFailedForRetry(3);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('attempts < $1'),
        [3, 100]
      );
    });

    it('should respect limit parameter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findFailedForRetry(5, 50);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        [5, 50]
      );
    });

    it('should return empty array if no failed logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findFailedForRetry();

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findFailedForRetry()).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findFailedForRetry(5, 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findInDLQ', () => {
    it('should find webhook logs in dead letter queue', async () => {
      const mockRows = [
        {
          id: 'wh-1',
          stripe_event_id: 'evt_1',
          event_type: 'payment_intent.failed',
          payload: {},
          signature: 'sig1',
          status: 'dlq',
          attempts: 5,
          last_attempt_at: new Date('2024-01-01'),
          error_message: 'Max retries exceeded',
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findInDLQ();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('dlq');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        ['dlq', 100]
      );
    });

    it('should respect limit parameter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findInDLQ(25);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['dlq', 25]
      );
    });

    it('should return empty array if DLQ is empty', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findInDLQ();

      expect(result).toEqual([]);
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findInDLQ(100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update webhook log status', async () => {
      const params: UpdateWebhookLogParams = {
        status: 'processed',
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01'),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', params);

      expect(result?.status).toBe('processed');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE webhook_events'),
        ['processed', 'wh-123']
      );
    });

    it('should update webhook log attempts', async () => {
      const params: UpdateWebhookLogParams = {
        attempts: 3,
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'failed',
        attempts: 3,
        last_attempt_at: new Date('2024-01-01'),
        error_message: 'Error',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', params);

      expect(result?.attempts).toBe(3);
    });

    it('should update webhook log lastAttemptAt', async () => {
      const lastAttemptAt = new Date('2024-01-15T10:30:00Z');
      const params: UpdateWebhookLogParams = {
        lastAttemptAt,
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'pending',
        attempts: 1,
        last_attempt_at: lastAttemptAt,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', params);

      expect(result?.lastAttemptAt).toEqual(lastAttemptAt);
    });

    it('should update webhook log errorMessage', async () => {
      const params: UpdateWebhookLogParams = {
        errorMessage: 'Connection timeout',
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'failed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01'),
        error_message: 'Connection timeout',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', params);

      expect(result?.errorMessage).toBe('Connection timeout');
    });

    it('should update multiple fields at once', async () => {
      const lastAttemptAt = new Date('2024-01-15T10:30:00Z');
      const params: UpdateWebhookLogParams = {
        status: 'failed',
        attempts: 2,
        lastAttemptAt,
        errorMessage: 'Server unavailable',
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'failed',
        attempts: 2,
        last_attempt_at: lastAttemptAt,
        error_message: 'Server unavailable',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', params);

      expect(result?.status).toBe('failed');
      expect(result?.attempts).toBe(2);
      expect(result?.lastAttemptAt).toEqual(lastAttemptAt);
      expect(result?.errorMessage).toBe('Server unavailable');
    });

    it('should set errorMessage to null', async () => {
      const params: UpdateWebhookLogParams = {
        errorMessage: null,
      };

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01'),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', params);

      expect(result?.errorMessage).toBeNull();
    });

    it('should return null if webhook log not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { status: 'processed' });

      expect(result).toBeNull();
    });

    it('should return existing webhook log if no updates provided', async () => {
      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('wh-123', {});

      expect(result).not.toBeNull();
      // Should call findById instead of UPDATE
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM webhook_events'),
        ['wh-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('wh-123', { status: 'processed' })).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01'),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('wh-123', { status: 'processed' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('markProcessed', () => {
    it('should mark webhook log as processed', async () => {
      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date(),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.markProcessed('wh-123');

      expect(result?.status).toBe('processed');
      expect(result?.errorMessage).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE webhook_events'),
        expect.arrayContaining(['processed', 'wh-123'])
      );
    });

    it('should return null if webhook log not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.markProcessed('nonexistent');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date(),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.markProcessed('wh-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('markFailed', () => {
    it('should mark webhook log as failed with error message', async () => {
      // First call: findById
      const existingRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'pending',
        attempts: 1,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      // Second call: update
      const updatedRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'failed',
        attempts: 2,
        last_attempt_at: new Date(),
        error_message: 'Connection timeout',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 } as any);

      const result = await repository.markFailed('wh-123', 'Connection timeout');

      expect(result?.status).toBe('failed');
      expect(result?.errorMessage).toBe('Connection timeout');
      expect(result?.attempts).toBe(2);
    });

    it('should increment attempts counter', async () => {
      const existingRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'failed',
        attempts: 3,
        last_attempt_at: new Date('2024-01-01'),
        error_message: 'Previous error',
        created_at: new Date('2024-01-01'),
      };

      const updatedRow = {
        ...existingRow,
        attempts: 4,
        error_message: 'New error',
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 } as any);

      const result = await repository.markFailed('wh-123', 'New error');

      expect(result?.attempts).toBe(4);
    });

    it('should return null if webhook log not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.markFailed('nonexistent', 'Error');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const existingRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      const updatedRow = {
        ...existingRow,
        status: 'failed',
        attempts: 1,
        error_message: 'Error',
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 } as any);

      await repository.markFailed('wh-123', 'Error', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('moveToDLQ', () => {
    it('should move webhook log to dead letter queue', async () => {
      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'dlq',
        attempts: 5,
        last_attempt_at: new Date(),
        error_message: 'Max retries exceeded',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.moveToDLQ('wh-123', 'Max retries exceeded');

      expect(result?.status).toBe('dlq');
      expect(result?.errorMessage).toBe('Max retries exceeded');
    });

    it('should return null if webhook log not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.moveToDLQ('nonexistent', 'Error');

      expect(result).toBeNull();
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_stripe_123',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_sig',
        status: 'dlq',
        attempts: 5,
        last_attempt_at: new Date(),
        error_message: 'Max retries exceeded',
        created_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.moveToDLQ('wh-123', 'Max retries exceeded', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a webhook log', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('wh-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM webhook_events'),
        ['wh-123']
      );
    });

    it('should return false if webhook log not found', async () => {
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

      const result = await repository.delete('wh-123');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('wh-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('wh-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle webhook log with empty payload', async () => {
      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_empty',
        eventType: 'test.event',
        payload: {},
        signature: 'whsec_empty',
      };

      const mockRow = {
        id: 'wh-empty',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: {},
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.payload).toEqual({});
    });

    it('should handle webhook log with complex payload', async () => {
      const complexPayload = {
        id: 'evt_complex',
        object: 'event',
        data: {
          object: {
            id: 'pi_123',
            amount: 2000,
            currency: 'usd',
            metadata: {
              order_id: '12345',
              customer_name: 'John Doe',
            },
            charges: {
              data: [
                { id: 'ch_1', amount: 2000 },
              ],
            },
          },
        },
        nested: {
          arrays: [1, 2, [3, 4]],
          objects: { a: { b: { c: 'deep' } } },
        },
      };

      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_complex',
        eventType: 'payment_intent.succeeded',
        payload: complexPayload,
        signature: 'whsec_complex',
      };

      const mockRow = {
        id: 'wh-complex',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: complexPayload,
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.payload).toEqual(complexPayload);
    });

    it('should handle very long Stripe event ID', async () => {
      const longEventId = 'evt_' + 'a'.repeat(100);

      const params: CreateWebhookLogParams = {
        stripeEventId: longEventId,
        eventType: 'test.event',
        payload: {},
        signature: 'whsec_long',
      };

      const mockRow = {
        id: 'wh-long',
        stripe_event_id: longEventId,
        event_type: params.eventType,
        payload: {},
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.stripeEventId).toBe(longEventId);
    });

    it('should handle very long error message', async () => {
      const longErrorMessage = 'Error: ' + 'x'.repeat(1000);

      const existingRow = {
        id: 'wh-123',
        stripe_event_id: 'evt_123',
        event_type: 'test.event',
        payload: {},
        signature: 'whsec_sig',
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      const updatedRow = {
        ...existingRow,
        status: 'failed',
        attempts: 1,
        error_message: longErrorMessage,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 } as any);

      const result = await repository.markFailed('wh-123', longErrorMessage);

      expect(result?.errorMessage).toBe(longErrorMessage);
    });

    it('should properly map dates from database rows', async () => {
      const createdAt = new Date('2024-01-15T10:30:00Z');
      const lastAttemptAt = new Date('2024-02-20T14:45:00Z');

      const mockRow = {
        id: 'wh-dates',
        stripe_event_id: 'evt_dates',
        event_type: 'test.event',
        payload: {},
        signature: 'whsec_dates',
        status: 'processed',
        attempts: 1,
        last_attempt_at: lastAttemptAt,
        error_message: null,
        created_at: createdAt,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('wh-dates');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.lastAttemptAt).toEqual(lastAttemptAt);
    });

    it('should handle null lastAttemptAt', async () => {
      const mockRow = {
        id: 'wh-null-date',
        stripe_event_id: 'evt_null_date',
        event_type: 'test.event',
        payload: {},
        signature: 'whsec_null',
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('wh-null-date');

      expect(result?.lastAttemptAt).toBeNull();
    });

    it('should handle all webhook statuses', async () => {
      const statuses = ['pending', 'processed', 'failed', 'dlq'] as const;

      for (const status of statuses) {
        const mockRow = {
          id: `wh-${status}`,
          stripe_event_id: `evt_${status}`,
          event_type: 'test.event',
          payload: {},
          signature: 'whsec_sig',
          status,
          attempts: 0,
          last_attempt_at: null,
          error_message: null,
          created_at: new Date('2024-01-01'),
        };

        mockPool.query.mockResolvedValueOnce({
          rows: [mockRow],
          rowCount: 1,
        } as any);

        const result = await repository.findById(`wh-${status}`);

        expect(result?.status).toBe(status);
      }
    });

    it('should handle special characters in event type', async () => {
      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_special',
        eventType: 'customer.subscription.updated.v2',
        payload: {},
        signature: 'whsec_special',
      };

      const mockRow = {
        id: 'wh-special',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: {},
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.eventType).toBe('customer.subscription.updated.v2');
    });

    it('should handle unicode characters in error message', async () => {
      const unicodeError = 'Error: 日本語エラー / 中文错误 / 한국어 오류';

      const existingRow = {
        id: 'wh-unicode',
        stripe_event_id: 'evt_unicode',
        event_type: 'test.event',
        payload: {},
        signature: 'whsec_unicode',
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      const updatedRow = {
        ...existingRow,
        status: 'failed',
        attempts: 1,
        error_message: unicodeError,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 } as any);

      const result = await repository.markFailed('wh-unicode', unicodeError);

      expect(result?.errorMessage).toBe(unicodeError);
    });

    it('should handle high attempt count', async () => {
      const mockRow = {
        id: 'wh-high-attempts',
        stripe_event_id: 'evt_high',
        event_type: 'test.event',
        payload: {},
        signature: 'whsec_high',
        status: 'failed',
        attempts: 999,
        last_attempt_at: new Date('2024-01-01'),
        error_message: 'Still failing',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('wh-high-attempts');

      expect(result?.attempts).toBe(999);
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_error',
        eventType: 'test.event',
        payload: {},
        signature: 'whsec_error',
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating webhook log',
        expect.objectContaining({
          error: dbError,
          stripeEventId: params.stripeEventId,
        })
      );
    });

    it('should log error when findById fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('wh-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding webhook log by ID',
        expect.objectContaining({
          error: dbError,
          webhookLogId: 'wh-123',
        })
      );
    });

    it('should log error when findByStripeEventId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStripeEventId('evt_123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding webhook log by Stripe event ID',
        expect.objectContaining({
          error: dbError,
          stripeEventId: 'evt_123',
        })
      );
    });

    it('should log error when isEventProcessed fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.isEventProcessed('evt_123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error checking if event is processed',
        expect.objectContaining({
          error: dbError,
          stripeEventId: 'evt_123',
        })
      );
    });

    it('should log error when findByStatus fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByStatus('pending')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding webhook logs by status',
        expect.objectContaining({
          error: dbError,
          status: 'pending',
        })
      );
    });

    it('should log error when findByEventType fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByEventType('payment_intent.succeeded')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding webhook logs by event type',
        expect.objectContaining({
          error: dbError,
          eventType: 'payment_intent.succeeded',
        })
      );
    });

    it('should log error when findFailedForRetry fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findFailedForRetry()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding failed webhook logs for retry',
        expect.objectContaining({
          error: dbError,
          maxAttempts: 5,
        })
      );
    });

    it('should log error when update fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.update('wh-123', { status: 'processed' })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating webhook log',
        expect.objectContaining({
          error: dbError,
          webhookLogId: 'wh-123',
        })
      );
    });

    it('should log error when delete fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('wh-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error deleting webhook log',
        expect.objectContaining({
          error: dbError,
          webhookLogId: 'wh-123',
        })
      );
    });

    it('should log success when webhook log is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateWebhookLogParams = {
        stripeEventId: 'evt_log',
        eventType: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_log',
      };

      const mockRow = {
        id: 'wh-log',
        stripe_event_id: params.stripeEventId,
        event_type: params.eventType,
        payload: {},
        signature: params.signature,
        status: 'pending',
        attempts: 0,
        last_attempt_at: null,
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Webhook log created',
        expect.objectContaining({
          webhookLogId: 'wh-log',
          stripeEventId: params.stripeEventId,
          eventType: params.eventType,
        })
      );
    });

    it('should log success when webhook log is updated', async () => {
      const { logger } = require('../../../utils/logger');

      const mockRow = {
        id: 'wh-update-log',
        stripe_event_id: 'evt_update',
        event_type: 'payment_intent.succeeded',
        payload: {},
        signature: 'whsec_update',
        status: 'processed',
        attempts: 1,
        last_attempt_at: new Date('2024-01-01'),
        error_message: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('wh-update-log', { status: 'processed' });

      expect(logger.info).toHaveBeenCalledWith(
        'Webhook log updated',
        expect.objectContaining({
          webhookLogId: 'wh-update-log',
        })
      );
    });

    it('should log success when webhook log is deleted', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('wh-delete-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Webhook log deleted',
        expect.objectContaining({
          webhookLogId: 'wh-delete-log',
        })
      );
    });

    it('should not log delete when webhook log not found', async () => {
      const { logger } = require('../../../utils/logger');
      logger.info.mockClear();

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.delete('nonexistent');

      expect(logger.info).not.toHaveBeenCalledWith(
        'Webhook log deleted',
        expect.any(Object)
      );
    });
  });
});
