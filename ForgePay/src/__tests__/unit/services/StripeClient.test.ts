// Create mock functions at module scope
const mockCheckoutSessionsCreate = jest.fn();
const mockCheckoutSessionsRetrieve = jest.fn();
const mockCheckoutSessionsExpire = jest.fn();
const mockProductsCreate = jest.fn();
const mockProductsUpdate = jest.fn();
const mockPricesCreate = jest.fn();
const mockPricesUpdate = jest.fn();
const mockCustomersList = jest.fn();
const mockCustomersCreate = jest.fn();
const mockRefundsCreate = jest.fn();
const mockSubscriptionsCancel = jest.fn();
const mockSubscriptionsUpdate = jest.fn();
const mockSubscriptionsRetrieve = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockBillingPortalSessionsCreate = jest.fn();
const mockCouponsCreate = jest.fn();
const mockCouponsUpdate = jest.fn();
const mockCouponsDel = jest.fn();
const mockCouponsRetrieve = jest.fn();
const mockWebhooksConstructEvent = jest.fn();

// Mock error classes
class MockStripeCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeCardError';
  }
}

class MockStripeRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeRateLimitError';
  }
}

class MockStripeInvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeInvalidRequestError';
  }
}

class MockStripeAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeAPIError';
  }
}

class MockStripeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeConnectionError';
  }
}

class MockStripeAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeAuthenticationError';
  }
}

// Mock the Stripe SDK - using factory function to avoid hoisting issues
jest.mock('stripe', () => {
  const mockFn = jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockCheckoutSessionsCreate,
        retrieve: mockCheckoutSessionsRetrieve,
        expire: mockCheckoutSessionsExpire,
      },
    },
    products: {
      create: mockProductsCreate,
      update: mockProductsUpdate,
    },
    prices: {
      create: mockPricesCreate,
      update: mockPricesUpdate,
    },
    customers: {
      list: mockCustomersList,
      create: mockCustomersCreate,
    },
    refunds: {
      create: mockRefundsCreate,
    },
    subscriptions: {
      cancel: mockSubscriptionsCancel,
      update: mockSubscriptionsUpdate,
      retrieve: mockSubscriptionsRetrieve,
    },
    paymentIntents: {
      retrieve: mockPaymentIntentsRetrieve,
    },
    billingPortal: {
      sessions: {
        create: mockBillingPortalSessionsCreate,
      },
    },
    coupons: {
      create: mockCouponsCreate,
      update: mockCouponsUpdate,
      del: mockCouponsDel,
      retrieve: mockCouponsRetrieve,
    },
    webhooks: {
      constructEvent: mockWebhooksConstructEvent,
    },
  }));
  
  // Add errors object to mock constructor
  (mockFn as unknown as { errors: Record<string, unknown> }).errors = {
    StripeCardError: MockStripeCardError,
    StripeRateLimitError: MockStripeRateLimitError,
    StripeInvalidRequestError: MockStripeInvalidRequestError,
    StripeAPIError: MockStripeAPIError,
    StripeConnectionError: MockStripeConnectionError,
    StripeAuthenticationError: MockStripeAuthenticationError,
  };
  
  return mockFn;
});

import { StripeClient, CreateCheckoutSessionParams, CreateProductParams, CreatePriceParams, CreateRefundParams } from '../../../services/StripeClient';

// Get the mocked Stripe constructor
const MockStripeConstructor = jest.requireMock('stripe') as jest.Mock;

// Mock config
jest.mock('../../../config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_mock_key',
      webhookSecret: 'whsec_mock_secret',
    },
  },
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../../../utils/logger';

describe('StripeClient', () => {
  let client: StripeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new StripeClient('sk_test_custom_key');
  });

  describe('constructor', () => {
    it('should initialize Stripe with provided API key', () => {
      new StripeClient('sk_test_another_key');
      expect(MockStripeConstructor).toHaveBeenCalledWith('sk_test_another_key', {
        apiVersion: '2023-10-16',
        typescript: true,
        maxNetworkRetries: 3,
        timeout: 80000,
      });
    });

    it('should use default API key from config when not provided', () => {
      jest.clearAllMocks();
      new StripeClient();
      expect(MockStripeConstructor).toHaveBeenCalledWith('sk_test_mock_key', expect.any(Object));
    });
  });

  describe('createCheckoutSession', () => {
    const mockSessionParams: CreateCheckoutSessionParams = {
      productId: 'prod-123',
      priceId: 'price_test_123',
      purchaseIntentId: 'pi-123',
      customerEmail: 'test@example.com',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      mode: 'payment',
      metadata: { custom_key: 'custom_value' },
    };

    const mockStripeSession = {
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };

    beforeEach(() => {
      mockCheckoutSessionsCreate.mockResolvedValue(mockStripeSession);
    });

    it('should create a checkout session successfully', async () => {
      const result = await client.createCheckoutSession(mockSessionParams);

      expect(result).toEqual({
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
        expiresAt: expect.any(Date),
      });

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{ price: 'price_test_123', quantity: 1 }],
          success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'https://example.com/cancel',
          client_reference_id: 'pi-123',
          automatic_tax: { enabled: true },
        })
      );
    });

    it('should include customer email when provided', async () => {
      await client.createCheckoutSession(mockSessionParams);

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_email: 'test@example.com',
          customer_creation: 'always',
        })
      );
    });

    it('should use customer ID when provided instead of email', async () => {
      const params = {
        ...mockSessionParams,
        customerId: 'cus_test_123',
        customerEmail: undefined,
      };

      await client.createCheckoutSession(params);

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_test_123',
        })
      );
    });

    it('should set customer_creation to always when no customer info provided', async () => {
      const params = {
        ...mockSessionParams,
        customerId: undefined,
        customerEmail: undefined,
      };

      await client.createCheckoutSession(params);

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_creation: 'always',
        })
      );
    });

    it('should add subscription_data for subscription mode', async () => {
      const params = { ...mockSessionParams, mode: 'subscription' as const };

      await client.createCheckoutSession(params);

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          subscription_data: {
            metadata: { purchase_intent_id: 'pi-123' },
          },
        })
      );
    });

    it('should include metadata in session', async () => {
      await client.createCheckoutSession(mockSessionParams);

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            purchase_intent_id: 'pi-123',
            product_id: 'prod-123',
            custom_key: 'custom_value',
          }),
        })
      );
    });

    it('should log session creation', async () => {
      await client.createCheckoutSession(mockSessionParams);

      expect(logger.info).toHaveBeenCalledWith('Stripe checkout session created', {
        sessionId: 'cs_test_123',
        purchaseIntentId: 'pi-123',
        mode: 'payment',
      });
    });

    it('should handle Stripe card error', async () => {
      const cardError = new MockStripeCardError('Card declined');
      mockCheckoutSessionsCreate.mockRejectedValue(cardError);

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Card error: Card declined');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle Stripe rate limit error', async () => {
      const rateLimitError = new MockStripeRateLimitError('Rate limit');
      mockCheckoutSessionsCreate.mockRejectedValue(rateLimitError);

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Rate limit exceeded. Please try again later.');
    });

    it('should handle Stripe invalid request error', async () => {
      const invalidError = new MockStripeInvalidRequestError('Invalid price');
      mockCheckoutSessionsCreate.mockRejectedValue(invalidError);

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Invalid request: Invalid price');
    });

    it('should handle Stripe API error', async () => {
      const apiError = new MockStripeAPIError('API error');
      mockCheckoutSessionsCreate.mockRejectedValue(apiError);

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Stripe API error: API error');
    });

    it('should handle Stripe connection error', async () => {
      const connectionError = new MockStripeConnectionError('Connection failed');
      mockCheckoutSessionsCreate.mockRejectedValue(connectionError);

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Connection to Stripe failed. Please try again.');
    });

    it('should handle Stripe authentication error', async () => {
      const authError = new MockStripeAuthenticationError('Invalid API key');
      mockCheckoutSessionsCreate.mockRejectedValue(authError);

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Stripe authentication failed. Check API keys.');
    });

    it('should handle unknown errors', async () => {
      mockCheckoutSessionsCreate.mockRejectedValue('Unknown error string');

      await expect(client.createCheckoutSession(mockSessionParams)).rejects.toThrow('Unknown Stripe error');
    });
  });

  describe('getCheckoutSession', () => {
    const mockSession = {
      id: 'cs_test_123',
      payment_status: 'paid',
      customer: { id: 'cus_123' },
      payment_intent: { id: 'pi_123' },
    };

    beforeEach(() => {
      mockCheckoutSessionsRetrieve.mockResolvedValue(mockSession);
    });

    it('should retrieve a checkout session with expanded fields', async () => {
      const result = await client.getCheckoutSession('cs_test_123');

      expect(result).toEqual(mockSession);
      expect(mockCheckoutSessionsRetrieve).toHaveBeenCalledWith('cs_test_123', {
        expand: ['customer', 'payment_intent', 'subscription'],
      });
    });

    it('should handle errors when retrieving session', async () => {
      const error = new MockStripeInvalidRequestError('Session not found');
      mockCheckoutSessionsRetrieve.mockRejectedValue(error);

      await expect(client.getCheckoutSession('invalid_session')).rejects.toThrow('Invalid request: Session not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('expireCheckoutSession', () => {
    const mockExpiredSession = {
      id: 'cs_test_123',
      status: 'expired',
    };

    beforeEach(() => {
      mockCheckoutSessionsExpire.mockResolvedValue(mockExpiredSession);
    });

    it('should expire a checkout session', async () => {
      const result = await client.expireCheckoutSession('cs_test_123');

      expect(result).toEqual(mockExpiredSession);
      expect(mockCheckoutSessionsExpire).toHaveBeenCalledWith('cs_test_123');
    });

    it('should log when session is expired', async () => {
      await client.expireCheckoutSession('cs_test_123');

      expect(logger.info).toHaveBeenCalledWith('Stripe checkout session expired', {
        sessionId: 'cs_test_123',
      });
    });

    it('should handle errors when expiring session', async () => {
      const error = new MockStripeInvalidRequestError('Session already expired');
      mockCheckoutSessionsExpire.mockRejectedValue(error);

      await expect(client.expireCheckoutSession('cs_test_123')).rejects.toThrow('Invalid request: Session already expired');
    });
  });

  describe('createProduct', () => {
    const mockProductParams: CreateProductParams = {
      name: 'Test Product',
      description: 'A test product description',
      type: 'one_time',
      metadata: { custom: 'value' },
    };

    const mockProduct = {
      id: 'prod_test_123',
      name: 'Test Product',
      description: 'A test product description',
    };

    beforeEach(() => {
      mockProductsCreate.mockResolvedValue(mockProduct);
    });

    it('should create a product successfully', async () => {
      const result = await client.createProduct(mockProductParams);

      expect(result).toEqual(mockProduct);
      expect(mockProductsCreate).toHaveBeenCalledWith({
        name: 'Test Product',
        description: 'A test product description',
        metadata: { custom: 'value', type: 'one_time' },
      });
    });

    it('should create product without type in metadata when not provided', async () => {
      const params = { name: 'Simple Product' };

      await client.createProduct(params);

      expect(mockProductsCreate).toHaveBeenCalledWith({
        name: 'Simple Product',
        description: undefined,
        metadata: {},
      });
    });

    it('should log product creation', async () => {
      await client.createProduct(mockProductParams);

      expect(logger.info).toHaveBeenCalledWith('Stripe product created', {
        productId: 'prod_test_123',
        name: 'Test Product',
      });
    });

    it('should handle errors when creating product', async () => {
      const error = new MockStripeInvalidRequestError('Invalid product name');
      mockProductsCreate.mockRejectedValue(error);

      await expect(client.createProduct(mockProductParams)).rejects.toThrow('Invalid request: Invalid product name');
    });
  });

  describe('updateProduct', () => {
    const mockUpdatedProduct = {
      id: 'prod_test_123',
      name: 'Updated Product',
      active: true,
    };

    beforeEach(() => {
      mockProductsUpdate.mockResolvedValue(mockUpdatedProduct);
    });

    it('should update a product with all fields', async () => {
      const result = await client.updateProduct('prod_test_123', {
        name: 'Updated Product',
        description: 'Updated description',
        active: true,
        metadata: { key: 'value' },
      });

      expect(result).toEqual(mockUpdatedProduct);
      expect(mockProductsUpdate).toHaveBeenCalledWith('prod_test_123', {
        name: 'Updated Product',
        description: 'Updated description',
        active: true,
        metadata: { key: 'value' },
      });
    });

    it('should update product with partial fields', async () => {
      await client.updateProduct('prod_test_123', { name: 'New Name' });

      expect(mockProductsUpdate).toHaveBeenCalledWith('prod_test_123', {
        name: 'New Name',
      });
    });

    it('should handle empty update params', async () => {
      await client.updateProduct('prod_test_123', {});

      expect(mockProductsUpdate).toHaveBeenCalledWith('prod_test_123', {});
    });

    it('should log product update', async () => {
      await client.updateProduct('prod_test_123', { name: 'Updated' });

      expect(logger.info).toHaveBeenCalledWith('Stripe product updated', {
        productId: 'prod_test_123',
      });
    });

    it('should handle errors when updating product', async () => {
      const error = new MockStripeInvalidRequestError('Product not found');
      mockProductsUpdate.mockRejectedValue(error);

      await expect(client.updateProduct('invalid_id', { name: 'Test' })).rejects.toThrow('Invalid request: Product not found');
    });
  });

  describe('archiveProduct', () => {
    const mockArchivedProduct = {
      id: 'prod_test_123',
      active: false,
    };

    beforeEach(() => {
      mockProductsUpdate.mockResolvedValue(mockArchivedProduct);
    });

    it('should archive a product by setting active to false', async () => {
      const result = await client.archiveProduct('prod_test_123');

      expect(result).toEqual(mockArchivedProduct);
      expect(mockProductsUpdate).toHaveBeenCalledWith('prod_test_123', {
        active: false,
      });
    });

    it('should log product archive', async () => {
      await client.archiveProduct('prod_test_123');

      expect(logger.info).toHaveBeenCalledWith('Stripe product archived', {
        productId: 'prod_test_123',
      });
    });

    it('should handle errors when archiving product', async () => {
      const error = new MockStripeInvalidRequestError('Product not found');
      mockProductsUpdate.mockRejectedValue(error);

      await expect(client.archiveProduct('invalid_id')).rejects.toThrow('Invalid request: Product not found');
    });
  });

  describe('createPrice', () => {
    const mockPriceParams: CreatePriceParams = {
      productId: 'prod_test_123',
      unitAmount: 1999,
      currency: 'USD',
      metadata: { tier: 'premium' },
    };

    const mockPrice = {
      id: 'price_test_123',
      product: 'prod_test_123',
      unit_amount: 1999,
      currency: 'usd',
    };

    beforeEach(() => {
      mockPricesCreate.mockResolvedValue(mockPrice);
    });

    it('should create a one-time price', async () => {
      const result = await client.createPrice(mockPriceParams);

      expect(result).toEqual(mockPrice);
      expect(mockPricesCreate).toHaveBeenCalledWith({
        product: 'prod_test_123',
        unit_amount: 1999,
        currency: 'usd',
        tax_behavior: 'exclusive',
        metadata: { tier: 'premium' },
      });
    });

    it('should create a recurring price', async () => {
      const recurringParams = {
        ...mockPriceParams,
        recurring: { interval: 'month' as const },
      };

      await client.createPrice(recurringParams);

      expect(mockPricesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: { interval: 'month' },
        })
      );
    });

    it('should create a yearly recurring price', async () => {
      const yearlyParams = {
        ...mockPriceParams,
        recurring: { interval: 'year' as const },
      };

      await client.createPrice(yearlyParams);

      expect(mockPricesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: { interval: 'year' },
        })
      );
    });

    it('should convert currency to lowercase', async () => {
      await client.createPrice({ ...mockPriceParams, currency: 'EUR' });

      expect(mockPricesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'eur',
        })
      );
    });

    it('should create price without metadata', async () => {
      const params = { ...mockPriceParams, metadata: undefined };

      await client.createPrice(params);

      const callArgs = mockPricesCreate.mock.calls[0][0];
      expect(callArgs.metadata).toBeUndefined();
    });

    it('should log price creation', async () => {
      await client.createPrice(mockPriceParams);

      expect(logger.info).toHaveBeenCalledWith('Stripe price created', {
        priceId: 'price_test_123',
        productId: 'prod_test_123',
        amount: 1999,
        currency: 'USD',
      });
    });

    it('should handle errors when creating price', async () => {
      const error = new MockStripeInvalidRequestError('Invalid product');
      mockPricesCreate.mockRejectedValue(error);

      await expect(client.createPrice(mockPriceParams)).rejects.toThrow('Invalid request: Invalid product');
    });
  });

  describe('deactivatePrice', () => {
    const mockDeactivatedPrice = {
      id: 'price_test_123',
      active: false,
    };

    beforeEach(() => {
      mockPricesUpdate.mockResolvedValue(mockDeactivatedPrice);
    });

    it('should deactivate a price', async () => {
      const result = await client.deactivatePrice('price_test_123');

      expect(result).toEqual(mockDeactivatedPrice);
      expect(mockPricesUpdate).toHaveBeenCalledWith('price_test_123', {
        active: false,
      });
    });

    it('should log price deactivation', async () => {
      await client.deactivatePrice('price_test_123');

      expect(logger.info).toHaveBeenCalledWith('Stripe price deactivated', {
        priceId: 'price_test_123',
      });
    });

    it('should handle errors when deactivating price', async () => {
      const error = new MockStripeInvalidRequestError('Price not found');
      mockPricesUpdate.mockRejectedValue(error);

      await expect(client.deactivatePrice('invalid_price')).rejects.toThrow('Invalid request: Price not found');
    });
  });

  describe('findOrCreateCustomer', () => {
    const mockExistingCustomer = {
      id: 'cus_existing_123',
      email: 'existing@example.com',
    };

    const mockNewCustomer = {
      id: 'cus_new_123',
      email: 'new@example.com',
      name: 'New Customer',
    };

    it('should return existing customer if found', async () => {
      mockCustomersList.mockResolvedValue({
        data: [mockExistingCustomer],
      });

      const result = await client.findOrCreateCustomer('existing@example.com');

      expect(result).toEqual(mockExistingCustomer);
      expect(mockCustomersList).toHaveBeenCalledWith({
        email: 'existing@example.com',
        limit: 1,
      });
      expect(mockCustomersCreate).not.toHaveBeenCalled();
    });

    it('should create new customer if not found', async () => {
      mockCustomersList.mockResolvedValue({ data: [] });
      mockCustomersCreate.mockResolvedValue(mockNewCustomer);

      const result = await client.findOrCreateCustomer('new@example.com', 'New Customer', { source: 'web' });

      expect(result).toEqual(mockNewCustomer);
      expect(mockCustomersCreate).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New Customer',
        metadata: { source: 'web' },
      });
    });

    it('should create customer without name and metadata', async () => {
      mockCustomersList.mockResolvedValue({ data: [] });
      mockCustomersCreate.mockResolvedValue({ id: 'cus_123', email: 'test@example.com' });

      await client.findOrCreateCustomer('test@example.com');

      expect(mockCustomersCreate).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: undefined,
        metadata: undefined,
      });
    });

    it('should log when creating new customer', async () => {
      mockCustomersList.mockResolvedValue({ data: [] });
      mockCustomersCreate.mockResolvedValue(mockNewCustomer);

      await client.findOrCreateCustomer('new@example.com');

      expect(logger.info).toHaveBeenCalledWith('Stripe customer created', {
        customerId: 'cus_new_123',
      });
    });

    it('should handle errors when finding/creating customer', async () => {
      const error = new MockStripeAPIError('API error');
      mockCustomersList.mockRejectedValue(error);

      await expect(client.findOrCreateCustomer('test@example.com')).rejects.toThrow('Stripe API error: API error');
    });
  });

  describe('createRefund', () => {
    const mockRefundParams: CreateRefundParams = {
      paymentIntentId: 'pi_test_123',
      amount: 1000,
      reason: 'requested_by_customer',
    };

    const mockRefund = {
      id: 'ref_test_123',
      payment_intent: 'pi_test_123',
      amount: 1000,
      status: 'succeeded',
    };

    beforeEach(() => {
      mockRefundsCreate.mockResolvedValue(mockRefund);
    });

    it('should create a partial refund', async () => {
      const result = await client.createRefund(mockRefundParams);

      expect(result).toEqual(mockRefund);
      expect(mockRefundsCreate).toHaveBeenCalledWith({
        payment_intent: 'pi_test_123',
        amount: 1000,
        reason: 'requested_by_customer',
      });
    });

    it('should create a full refund without amount', async () => {
      await client.createRefund({ paymentIntentId: 'pi_test_123' });

      expect(mockRefundsCreate).toHaveBeenCalledWith({
        payment_intent: 'pi_test_123',
        reason: undefined,
      });
    });

    it('should handle duplicate reason', async () => {
      await client.createRefund({
        paymentIntentId: 'pi_test_123',
        reason: 'duplicate',
      });

      expect(mockRefundsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'duplicate',
        })
      );
    });

    it('should handle fraudulent reason', async () => {
      await client.createRefund({
        paymentIntentId: 'pi_test_123',
        reason: 'fraudulent',
      });

      expect(mockRefundsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'fraudulent',
        })
      );
    });

    it('should log refund creation', async () => {
      await client.createRefund(mockRefundParams);

      expect(logger.info).toHaveBeenCalledWith('Stripe refund created', {
        refundId: 'ref_test_123',
        paymentIntentId: 'pi_test_123',
        amount: 1000,
      });
    });

    it('should handle errors when creating refund', async () => {
      const error = new MockStripeInvalidRequestError('Charge already refunded');
      mockRefundsCreate.mockRejectedValue(error);

      await expect(client.createRefund(mockRefundParams)).rejects.toThrow('Invalid request: Charge already refunded');
    });
  });

  describe('cancelSubscription', () => {
    const mockCanceledSubscription = {
      id: 'sub_test_123',
      status: 'canceled',
    };

    const mockSubscriptionAtPeriodEnd = {
      id: 'sub_test_123',
      status: 'active',
      cancel_at_period_end: true,
    };

    it('should cancel subscription immediately', async () => {
      mockSubscriptionsCancel.mockResolvedValue(mockCanceledSubscription);

      const result = await client.cancelSubscription('sub_test_123', true);

      expect(result).toEqual(mockCanceledSubscription);
      expect(mockSubscriptionsCancel).toHaveBeenCalledWith('sub_test_123');
    });

    it('should cancel subscription at period end (default)', async () => {
      mockSubscriptionsUpdate.mockResolvedValue(mockSubscriptionAtPeriodEnd);

      const result = await client.cancelSubscription('sub_test_123');

      expect(result).toEqual(mockSubscriptionAtPeriodEnd);
      expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_test_123', {
        cancel_at_period_end: true,
      });
    });

    it('should cancel subscription at period end with explicit false', async () => {
      mockSubscriptionsUpdate.mockResolvedValue(mockSubscriptionAtPeriodEnd);

      await client.cancelSubscription('sub_test_123', false);

      expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_test_123', {
        cancel_at_period_end: true,
      });
    });

    it('should log subscription cancellation', async () => {
      mockSubscriptionsCancel.mockResolvedValue(mockCanceledSubscription);

      await client.cancelSubscription('sub_test_123', true);

      expect(logger.info).toHaveBeenCalledWith('Stripe subscription canceled', {
        subscriptionId: 'sub_test_123',
        immediately: true,
      });
    });

    it('should handle errors when canceling subscription', async () => {
      const error = new MockStripeInvalidRequestError('Subscription not found');
      mockSubscriptionsCancel.mockRejectedValue(error);

      await expect(client.cancelSubscription('invalid_sub', true)).rejects.toThrow('Invalid request: Subscription not found');
    });
  });

  describe('verifyWebhookSignature', () => {
    const mockEvent = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: { object: {} },
    };

    it('should verify webhook signature and return event', () => {
      mockWebhooksConstructEvent.mockReturnValue(mockEvent);

      const result = client.verifyWebhookSignature('payload', 'sig_test_123');

      expect(result).toEqual(mockEvent);
      expect(mockWebhooksConstructEvent).toHaveBeenCalledWith(
        'payload',
        'sig_test_123',
        'whsec_mock_secret'
      );
    });

    it('should handle Buffer payload', () => {
      mockWebhooksConstructEvent.mockReturnValue(mockEvent);
      const bufferPayload = Buffer.from('payload');

      client.verifyWebhookSignature(bufferPayload, 'sig_test_123');

      expect(mockWebhooksConstructEvent).toHaveBeenCalledWith(
        bufferPayload,
        'sig_test_123',
        'whsec_mock_secret'
      );
    });

    it('should throw error on invalid signature', () => {
      const signatureError = new Error('Invalid signature');
      mockWebhooksConstructEvent.mockImplementation(() => {
        throw signatureError;
      });

      expect(() => client.verifyWebhookSignature('payload', 'invalid_sig')).toThrow(signatureError);
      expect(logger.error).toHaveBeenCalledWith('Webhook signature verification failed', {
        error: signatureError,
      });
    });
  });

  describe('createBillingPortalSession', () => {
    const mockPortalSession = {
      id: 'bps_test_123',
      url: 'https://billing.stripe.com/session/test',
      return_url: 'https://example.com/account',
    };

    beforeEach(() => {
      mockBillingPortalSessionsCreate.mockResolvedValue(mockPortalSession);
    });

    it('should create a billing portal session', async () => {
      const result = await client.createBillingPortalSession('cus_test_123', 'https://example.com/account');

      expect(result).toEqual(mockPortalSession);
      expect(mockBillingPortalSessionsCreate).toHaveBeenCalledWith({
        customer: 'cus_test_123',
        return_url: 'https://example.com/account',
      });
    });

    it('should log portal session creation', async () => {
      await client.createBillingPortalSession('cus_test_123', 'https://example.com/account');

      expect(logger.info).toHaveBeenCalledWith('Stripe billing portal session created', {
        customerId: 'cus_test_123',
      });
    });

    it('should handle errors when creating portal session', async () => {
      const error = new MockStripeInvalidRequestError('Customer not found');
      mockBillingPortalSessionsCreate.mockRejectedValue(error);

      await expect(client.createBillingPortalSession('invalid_cus', 'https://example.com')).rejects.toThrow('Invalid request: Customer not found');
    });
  });

  describe('getSubscription', () => {
    const mockSubscription = {
      id: 'sub_test_123',
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };

    beforeEach(() => {
      mockSubscriptionsRetrieve.mockResolvedValue(mockSubscription);
    });

    it('should retrieve a subscription', async () => {
      const result = await client.getSubscription('sub_test_123');

      expect(result).toEqual(mockSubscription);
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_test_123');
    });

    it('should handle errors when retrieving subscription', async () => {
      const error = new MockStripeInvalidRequestError('Subscription not found');
      mockSubscriptionsRetrieve.mockRejectedValue(error);

      await expect(client.getSubscription('invalid_sub')).rejects.toThrow('Invalid request: Subscription not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getPaymentIntent', () => {
    const mockPaymentIntent = {
      id: 'pi_test_123',
      status: 'succeeded',
      amount: 1999,
      currency: 'usd',
    };

    beforeEach(() => {
      mockPaymentIntentsRetrieve.mockResolvedValue(mockPaymentIntent);
    });

    it('should retrieve a payment intent', async () => {
      const result = await client.getPaymentIntent('pi_test_123');

      expect(result).toEqual(mockPaymentIntent);
      expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith('pi_test_123');
    });

    it('should handle errors when retrieving payment intent', async () => {
      const error = new MockStripeInvalidRequestError('Payment intent not found');
      mockPaymentIntentsRetrieve.mockRejectedValue(error);

      await expect(client.getPaymentIntent('invalid_pi')).rejects.toThrow('Invalid request: Payment intent not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('error handling edge cases', () => {
    it('should handle non-Error thrown values', async () => {
      mockProductsCreate.mockRejectedValue('string error');

      await expect(client.createProduct({ name: 'Test' })).rejects.toThrow('Unknown Stripe error');
    });

    it('should preserve Error instance for unknown error types', async () => {
      const customError = new Error('Custom error message');
      mockProductsCreate.mockRejectedValue(customError);

      await expect(client.createProduct({ name: 'Test' })).rejects.toThrow('Custom error message');
    });
  });

  describe('singleton export', () => {
    it('should export a stripeClient singleton', async () => {
      // Import the singleton to verify it's exported
      const { stripeClient } = await import('../../../services/StripeClient');
      expect(stripeClient).toBeInstanceOf(StripeClient);
    });
  });
});
