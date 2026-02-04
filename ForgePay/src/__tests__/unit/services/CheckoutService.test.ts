import { CheckoutService, CreateSessionParams } from '../../../services/CheckoutService';
import { CheckoutSession } from '../../../repositories/CheckoutSessionRepository';
import { Product } from '../../../repositories/ProductRepository';
import { Price } from '../../../repositories/PriceRepository';

// Mock client for database pool
const mockDbClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../../../config/database', () => ({
  pool: {
    connect: jest.fn(() => Promise.resolve(mockDbClient)),
  },
}));

// Mock repositories
jest.mock('../../../repositories/CheckoutSessionRepository', () => ({
  checkoutSessionRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByStripeSessionId: jest.fn(),
    findByPurchaseIntentId: jest.fn(),
    findByDeveloperId: jest.fn(),
    findExpiredSessions: jest.fn(),
    markComplete: jest.fn(),
    markExpired: jest.fn(),
  },
}));

jest.mock('../../../repositories/ProductRepository', () => ({
  productRepository: {
    findById: jest.fn(),
  },
}));

jest.mock('../../../repositories/PriceRepository', () => ({
  priceRepository: {
    findById: jest.fn(),
    findByProductIdAndCurrency: jest.fn(),
  },
}));

jest.mock('../../../repositories/CustomerRepository', () => ({
  customerRepository: {},
}));

// Mock StripeClient
jest.mock('../../../services/StripeClient', () => ({
  stripeClient: {
    createCheckoutSession: jest.fn(),
    expireCheckoutSession: jest.fn(),
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

import { checkoutSessionRepository } from '../../../repositories/CheckoutSessionRepository';
import { productRepository } from '../../../repositories/ProductRepository';
import { priceRepository } from '../../../repositories/PriceRepository';
import { stripeClient } from '../../../services/StripeClient';

const mockCheckoutSessionRepo = checkoutSessionRepository as jest.Mocked<typeof checkoutSessionRepository>;
const mockProductRepo = productRepository as jest.Mocked<typeof productRepository>;
const mockPriceRepo = priceRepository as jest.Mocked<typeof priceRepository>;
const mockStripeClient = stripeClient as jest.Mocked<typeof stripeClient>;

describe('CheckoutService', () => {
  let service: CheckoutService;

  const mockProduct: Product = {
    id: 'prod-123',
    developerId: 'dev-123',
    stripeProductId: 'stripe_prod_123',
    name: 'Test Product',
    description: 'A test product',
    type: 'one_time',
    active: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSubscriptionProduct: Product = {
    ...mockProduct,
    id: 'prod-sub-123',
    name: 'Subscription Product',
    type: 'subscription',
  };

  const mockPrice: Price = {
    id: 'price-123',
    productId: 'prod-123',
    stripePriceId: 'stripe_price_123',
    amount: 1000,
    currency: 'usd',
    interval: null,
    active: true,
    createdAt: new Date(),
  };

  const mockEurPrice: Price = {
    ...mockPrice,
    id: 'price-eur-123',
    stripePriceId: 'stripe_price_eur_123',
    currency: 'eur',
  };

  const mockCheckoutSession: CheckoutSession = {
    id: 'session-123',
    developerId: 'dev-123',
    stripeSessionId: 'cs_test_123',
    purchaseIntentId: 'pi-123',
    productId: 'prod-123',
    priceId: 'price-123',
    customerId: null,
    status: 'open',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };

  const mockStripeSession = {
    sessionId: 'cs_test_123',
    url: 'https://checkout.stripe.com/pay/cs_test_123',
    expiresAt: new Date(Date.now() + 86400000),
  };

  const defaultCreateParams: CreateSessionParams = {
    developerId: 'dev-123',
    productId: 'prod-123',
    priceId: 'price-123',
    purchaseIntentId: 'pi-123',
    customerEmail: 'test@example.com',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  beforeEach(() => {
    service = new CheckoutService();
    jest.clearAllMocks();

    // Reset mock client
    mockDbClient.query.mockReset();
    mockDbClient.release.mockReset();
  });

  describe('createSession', () => {
    beforeEach(() => {
      mockDbClient.query.mockResolvedValue({ rows: [] });
    });

    it('should create a checkout session successfully', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      const result = await service.createSession(defaultCreateParams);

      expect(result).toEqual({
        sessionId: mockCheckoutSession.id,
        checkoutUrl: mockStripeSession.url,
        expiresAt: mockStripeSession.expiresAt,
      });

      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalled();
      expect(mockProductRepo.findById).toHaveBeenCalledWith('prod-123', mockDbClient);
      expect(mockPriceRepo.findById).toHaveBeenCalledWith('price-123', mockDbClient);
    });

    it('should throw error when product is not found', async () => {
      mockProductRepo.findById.mockResolvedValue(null);

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(
        'Product not found'
      );

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockDbClient.release).toHaveBeenCalled();
    });

    it('should throw error when product is not active', async () => {
      mockProductRepo.findById.mockResolvedValue({ ...mockProduct, active: false });

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(
        'Product is not active'
      );

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error when price is not found', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(null);

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(
        'Price not found'
      );

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error when price is not active', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue({ ...mockPrice, active: false });

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(
        'Price is not active'
      );

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw error when price does not belong to product', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue({ ...mockPrice, productId: 'other-product' });

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(
        'Price does not belong to the specified product'
      );

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should return existing open session for same purchase intent', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(mockCheckoutSession);

      const result = await service.createSession(defaultCreateParams);

      expect(result).toEqual({
        sessionId: mockCheckoutSession.id,
        checkoutUrl: `https://checkout.stripe.com/c/pay/${mockCheckoutSession.stripeSessionId}`,
        expiresAt: mockCheckoutSession.expiresAt,
      });

      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockStripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('should create new session if existing session is not open', async () => {
      const expiredSession = { ...mockCheckoutSession, status: 'expired' as const };
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(expiredSession);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      const result = await service.createSession(defaultCreateParams);

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalled();
      expect(result.sessionId).toBe(mockCheckoutSession.id);
    });

    it('should use subscription mode for subscription products', async () => {
      mockProductRepo.findById.mockResolvedValue(mockSubscriptionProduct);
      mockPriceRepo.findById.mockResolvedValue({ ...mockPrice, productId: mockSubscriptionProduct.id });
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession({
        ...defaultCreateParams,
        productId: mockSubscriptionProduct.id,
      });

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
        })
      );
    });

    it('should use payment mode for one_time products', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession(defaultCreateParams);

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
        })
      );
    });

    it('should find alternative price when currency does not match', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice); // USD price
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockPriceRepo.findByProductIdAndCurrency.mockResolvedValue([mockEurPrice]);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession({
        ...defaultCreateParams,
        currency: 'eur',
      });

      expect(mockPriceRepo.findByProductIdAndCurrency).toHaveBeenCalledWith(
        'prod-123',
        'eur',
        true,
        mockDbClient
      );

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: mockEurPrice.stripePriceId,
        })
      );
    });

    it('should use original price if no alternative currency price found', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice); // USD price
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockPriceRepo.findByProductIdAndCurrency.mockResolvedValue([]);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession({
        ...defaultCreateParams,
        currency: 'eur',
      });

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: mockPrice.stripePriceId, // Original USD price
        })
      );
    });

    it('should default currency to usd if not provided', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession(defaultCreateParams);

      // Should not look for alternative currency since default matches price currency
      expect(mockPriceRepo.findByProductIdAndCurrency).not.toHaveBeenCalled();
    });

    it('should pass metadata to Stripe checkout session', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession({
        ...defaultCreateParams,
        metadata: { custom_field: 'custom_value' },
      });

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            custom_field: 'custom_value',
            requested_currency: 'usd',
            original_price_id: 'price-123',
          }),
        })
      );
    });

    it('should rollback transaction and rethrow on Stripe error', async () => {
      const stripeError = new Error('Stripe API error');
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockRejectedValue(stripeError);

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(stripeError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockDbClient.release).toHaveBeenCalled();
    });

    it('should rollback transaction and rethrow on database error', async () => {
      const dbError = new Error('Database error');
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockRejectedValue(dbError);

      await expect(service.createSession(defaultCreateParams)).rejects.toThrow(dbError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockDbClient.release).toHaveBeenCalled();
    });

    it('should pass customerEmail to Stripe checkout session', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession(defaultCreateParams);

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: 'test@example.com',
        })
      );
    });

    it('should pass success and cancel URLs to Stripe checkout session', async () => {
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockPriceRepo.findById.mockResolvedValue(mockPrice);
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);
      mockStripeClient.createCheckoutSession.mockResolvedValue(mockStripeSession);
      mockCheckoutSessionRepo.create.mockResolvedValue(mockCheckoutSession);

      await service.createSession(defaultCreateParams);

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      );
    });
  });

  describe('getSession', () => {
    it('should return session by ID', async () => {
      mockCheckoutSessionRepo.findById.mockResolvedValue(mockCheckoutSession);

      const result = await service.getSession('session-123');

      expect(result).toEqual(mockCheckoutSession);
      expect(mockCheckoutSessionRepo.findById).toHaveBeenCalledWith('session-123');
    });

    it('should return null if session not found', async () => {
      mockCheckoutSessionRepo.findById.mockResolvedValue(null);

      const result = await service.getSession('invalid-session');

      expect(result).toBeNull();
    });
  });

  describe('getSessionByStripeId', () => {
    it('should return session by Stripe session ID', async () => {
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);

      const result = await service.getSessionByStripeId('cs_test_123');

      expect(result).toEqual(mockCheckoutSession);
      expect(mockCheckoutSessionRepo.findByStripeSessionId).toHaveBeenCalledWith('cs_test_123');
    });

    it('should return null if session not found', async () => {
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(null);

      const result = await service.getSessionByStripeId('invalid-stripe-id');

      expect(result).toBeNull();
    });
  });

  describe('getSessionByPurchaseIntentId', () => {
    it('should return session by purchase intent ID', async () => {
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(mockCheckoutSession);

      const result = await service.getSessionByPurchaseIntentId('pi-123');

      expect(result).toEqual(mockCheckoutSession);
      expect(mockCheckoutSessionRepo.findByPurchaseIntentId).toHaveBeenCalledWith('pi-123');
    });

    it('should return null if session not found', async () => {
      mockCheckoutSessionRepo.findByPurchaseIntentId.mockResolvedValue(null);

      const result = await service.getSessionByPurchaseIntentId('invalid-pi');

      expect(result).toBeNull();
    });
  });

  describe('markSessionComplete', () => {
    it('should mark session as complete', async () => {
      const completedSession = { ...mockCheckoutSession, status: 'complete' as const };
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(completedSession);

      const result = await service.markSessionComplete('session-123');

      expect(result).toEqual(completedSession);
      expect(mockCheckoutSessionRepo.markComplete).toHaveBeenCalledWith(
        'session-123',
        undefined
      );
    });

    it('should mark session as complete with customer ID', async () => {
      const completedSession = {
        ...mockCheckoutSession,
        status: 'complete' as const,
        customerId: 'cust-123',
      };
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(completedSession);

      const result = await service.markSessionComplete('session-123', 'cust-123');

      expect(result).toEqual(completedSession);
      expect(mockCheckoutSessionRepo.markComplete).toHaveBeenCalledWith(
        'session-123',
        'cust-123'
      );
    });

    it('should return null if session not found', async () => {
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(null);

      const result = await service.markSessionComplete('invalid-session');

      expect(result).toBeNull();
    });
  });

  describe('markSessionExpired', () => {
    it('should mark session as expired', async () => {
      const expiredSession = { ...mockCheckoutSession, status: 'expired' as const };
      mockCheckoutSessionRepo.markExpired.mockResolvedValue(expiredSession);

      const result = await service.markSessionExpired('session-123');

      expect(result).toEqual(expiredSession);
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledWith('session-123');
    });

    it('should return null if session not found', async () => {
      mockCheckoutSessionRepo.markExpired.mockResolvedValue(null);

      const result = await service.markSessionExpired('invalid-session');

      expect(result).toBeNull();
    });
  });

  describe('expireSession', () => {
    it('should expire session in both Stripe and database', async () => {
      const expiredSession = { ...mockCheckoutSession, status: 'expired' as const };
      mockCheckoutSessionRepo.findById.mockResolvedValue(mockCheckoutSession);
      mockStripeClient.expireCheckoutSession.mockResolvedValue({} as any);
      mockCheckoutSessionRepo.markExpired.mockResolvedValue(expiredSession);

      const result = await service.expireSession('session-123');

      expect(result).toEqual(expiredSession);
      expect(mockStripeClient.expireCheckoutSession).toHaveBeenCalledWith('cs_test_123');
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledWith('session-123');
    });

    it('should return null if session not found', async () => {
      mockCheckoutSessionRepo.findById.mockResolvedValue(null);

      const result = await service.expireSession('invalid-session');

      expect(result).toBeNull();
      expect(mockStripeClient.expireCheckoutSession).not.toHaveBeenCalled();
    });

    it('should continue to mark expired even if Stripe expire fails', async () => {
      const expiredSession = { ...mockCheckoutSession, status: 'expired' as const };
      mockCheckoutSessionRepo.findById.mockResolvedValue(mockCheckoutSession);
      mockStripeClient.expireCheckoutSession.mockRejectedValue(new Error('Stripe error'));
      mockCheckoutSessionRepo.markExpired.mockResolvedValue(expiredSession);

      const result = await service.expireSession('session-123');

      expect(result).toEqual(expiredSession);
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledWith('session-123');
    });
  });

  describe('processExpiredSessions', () => {
    it('should process and mark all expired sessions', async () => {
      const expiredSessions = [
        { ...mockCheckoutSession, id: 'session-1' },
        { ...mockCheckoutSession, id: 'session-2' },
        { ...mockCheckoutSession, id: 'session-3' },
      ];
      mockCheckoutSessionRepo.findExpiredSessions.mockResolvedValue(expiredSessions);
      mockCheckoutSessionRepo.markExpired.mockResolvedValue({ ...mockCheckoutSession, status: 'expired' as const });

      const count = await service.processExpiredSessions();

      expect(count).toBe(3);
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledTimes(3);
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledWith('session-1');
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledWith('session-2');
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledWith('session-3');
    });

    it('should return 0 when no expired sessions found', async () => {
      mockCheckoutSessionRepo.findExpiredSessions.mockResolvedValue([]);

      const count = await service.processExpiredSessions();

      expect(count).toBe(0);
      expect(mockCheckoutSessionRepo.markExpired).not.toHaveBeenCalled();
    });

    it('should continue processing other sessions if one fails', async () => {
      const expiredSessions = [
        { ...mockCheckoutSession, id: 'session-1' },
        { ...mockCheckoutSession, id: 'session-2' },
        { ...mockCheckoutSession, id: 'session-3' },
      ];
      mockCheckoutSessionRepo.findExpiredSessions.mockResolvedValue(expiredSessions);
      mockCheckoutSessionRepo.markExpired
        .mockResolvedValueOnce({ ...mockCheckoutSession, status: 'expired' as const })
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({ ...mockCheckoutSession, status: 'expired' as const });

      const count = await service.processExpiredSessions();

      expect(count).toBe(2); // 2 succeeded, 1 failed
      expect(mockCheckoutSessionRepo.markExpired).toHaveBeenCalledTimes(3);
    });
  });

  describe('getSessionsByDeveloper', () => {
    it('should return sessions for developer', async () => {
      const sessions = [mockCheckoutSession, { ...mockCheckoutSession, id: 'session-2' }];
      mockCheckoutSessionRepo.findByDeveloperId.mockResolvedValue(sessions);

      const result = await service.getSessionsByDeveloper('dev-123');

      expect(result).toEqual(sessions);
      expect(mockCheckoutSessionRepo.findByDeveloperId).toHaveBeenCalledWith(
        'dev-123',
        undefined,
        100
      );
    });

    it('should filter by status', async () => {
      mockCheckoutSessionRepo.findByDeveloperId.mockResolvedValue([mockCheckoutSession]);

      await service.getSessionsByDeveloper('dev-123', 'open');

      expect(mockCheckoutSessionRepo.findByDeveloperId).toHaveBeenCalledWith(
        'dev-123',
        'open',
        100
      );
    });

    it('should respect custom limit', async () => {
      mockCheckoutSessionRepo.findByDeveloperId.mockResolvedValue([]);

      await service.getSessionsByDeveloper('dev-123', undefined, 50);

      expect(mockCheckoutSessionRepo.findByDeveloperId).toHaveBeenCalledWith(
        'dev-123',
        undefined,
        50
      );
    });

    it('should return empty array when no sessions found', async () => {
      mockCheckoutSessionRepo.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getSessionsByDeveloper('dev-123');

      expect(result).toEqual([]);
    });

    it('should filter by complete status', async () => {
      const completedSession = { ...mockCheckoutSession, status: 'complete' as const };
      mockCheckoutSessionRepo.findByDeveloperId.mockResolvedValue([completedSession]);

      await service.getSessionsByDeveloper('dev-123', 'complete');

      expect(mockCheckoutSessionRepo.findByDeveloperId).toHaveBeenCalledWith(
        'dev-123',
        'complete',
        100
      );
    });

    it('should filter by expired status', async () => {
      const expiredSession = { ...mockCheckoutSession, status: 'expired' as const };
      mockCheckoutSessionRepo.findByDeveloperId.mockResolvedValue([expiredSession]);

      await service.getSessionsByDeveloper('dev-123', 'expired');

      expect(mockCheckoutSessionRepo.findByDeveloperId).toHaveBeenCalledWith(
        'dev-123',
        'expired',
        100
      );
    });
  });

  describe('constructor dependency injection', () => {
    it('should use injected repositories', async () => {
      const customCheckoutRepo = {
        findById: jest.fn().mockResolvedValue(mockCheckoutSession),
        findByStripeSessionId: jest.fn(),
        findByPurchaseIntentId: jest.fn(),
        findByDeveloperId: jest.fn(),
        findExpiredSessions: jest.fn(),
        create: jest.fn(),
        markComplete: jest.fn(),
        markExpired: jest.fn(),
      };
      const customProductRepo = { findById: jest.fn() };
      const customPriceRepo = { findById: jest.fn(), findByProductIdAndCurrency: jest.fn() };
      const customCustomerRepo = {};
      const customStripe = {
        createCheckoutSession: jest.fn(),
        expireCheckoutSession: jest.fn(),
      };

      const customService = new CheckoutService(
        customCheckoutRepo as any,
        customProductRepo as any,
        customPriceRepo as any,
        customCustomerRepo as any,
        customStripe as any
      );

      await customService.getSession('session-123');

      expect(customCheckoutRepo.findById).toHaveBeenCalledWith('session-123');
    });

    it('should use default repositories when not injected', () => {
      const defaultService = new CheckoutService();
      
      // Service should be created without errors
      expect(defaultService).toBeInstanceOf(CheckoutService);
    });
  });
});
