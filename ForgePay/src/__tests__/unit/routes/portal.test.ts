import express, { Express } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';

// Mock the services before importing the router
const mockMagicLinkService = {
  sendMagicLink: jest.fn(),
  verifyMagicLink: jest.fn(),
  verifySession: jest.fn(),
  destroySession: jest.fn(),
};

const mockEntitlementService = {
  getEntitlementsByCustomerId: jest.fn(),
  getEntitlement: jest.fn(),
  revokeEntitlement: jest.fn(),
  renewEntitlement: jest.fn(),
};

const mockStripeClient = {
  getSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  createBillingPortalSession: jest.fn(),
};

const mockCustomerRepository = {
  findById: jest.fn(),
};

jest.mock('../../../services/MagicLinkService', () => ({
  magicLinkService: mockMagicLinkService,
  PortalSession: {},
}));

jest.mock('../../../services/EntitlementService', () => ({
  entitlementService: mockEntitlementService,
}));

jest.mock('../../../services/StripeClient', () => ({
  stripeClient: mockStripeClient,
}));

jest.mock('../../../repositories/CustomerRepository', () => ({
  customerRepository: mockCustomerRepository,
}));

jest.mock('../../../config', () => ({
  config: {
    app: {
      baseUrl: 'https://example.com',
    },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import portalRouter, { portalAuth } from '../../../routes/portal';

describe('Portal Routes', () => {
  let app: Express;

  // Test data
  const mockSession = {
    sessionId: 'session-123',
    customerId: 'cust-123',
    email: 'customer@example.com',
    createdAt: new Date('2024-01-01'),
    expiresAt: new Date('2024-01-02'),
  };

  const mockCustomer = {
    id: 'cust-123',
    developerId: 'dev-123',
    stripeCustomerId: 'stripe_cust_123',
    email: 'customer@example.com',
    name: 'Test Customer',
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockEntitlement = {
    id: 'ent-123',
    customerId: 'cust-123',
    productId: 'prod-123',
    purchaseIntentId: 'pi-123',
    paymentId: 'pay-123',
    subscriptionId: 'sub_stripe_123',
    status: 'active',
    expiresAt: new Date('2024-12-31'),
    revokedReason: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockStripeSubscription = {
    id: 'sub_stripe_123',
    status: 'active',
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    cancel_at_period_end: false,
    canceled_at: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh express app with router
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/portal', portalRouter);
  });

  describe('Portal Auth Middleware', () => {
    beforeEach(() => {
      // Setup default successful auth for protected routes
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);
    });

    it('should return 401 when no session is provided', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'No session provided' });
    });

    it('should return 401 when session is invalid or expired', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'invalid-session');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid or expired session' });
    });

    it('should authenticate with x-portal-session header', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(mockMagicLinkService.verifySession).toHaveBeenCalledWith('session-123');
    });

    it('should authenticate with portal_session cookie', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/portal/me')
        .set('Cookie', 'portal_session=session-123');

      expect(response.status).toBe(200);
      expect(mockMagicLinkService.verifySession).toHaveBeenCalledWith('session-123');
    });

    it('should return 500 when verifySession throws an error', async () => {
      mockMagicLinkService.verifySession.mockRejectedValue(new Error('Redis error'));

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Authentication error' });
    });
  });

  describe('POST /portal/auth/magic-link', () => {
    it('should send magic link successfully', async () => {
      const mockResult = {
        success: true,
        message: 'If your email is registered, you will receive a magic link shortly.',
      };

      mockMagicLinkService.sendMagicLink.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/portal/auth/magic-link')
        .send({ email: 'customer@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(mockMagicLinkService.sendMagicLink).toHaveBeenCalledWith('customer@example.com');
    });

    it('should return 400 when email is missing', async () => {
      const response = await request(app)
        .post('/portal/auth/magic-link')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 400 when email is not a string', async () => {
      const response = await request(app)
        .post('/portal/auth/magic-link')
        .send({ email: 12345 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 400 when email is null', async () => {
      const response = await request(app)
        .post('/portal/auth/magic-link')
        .send({ email: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 500 when sendMagicLink fails', async () => {
      mockMagicLinkService.sendMagicLink.mockRejectedValue(new Error('Email service error'));

      const response = await request(app)
        .post('/portal/auth/magic-link')
        .send({ email: 'customer@example.com' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to send magic link' });
    });
  });

  describe('GET /portal/auth/verify', () => {
    it('should verify magic link and create session successfully', async () => {
      const mockResult = {
        success: true,
        session: mockSession,
      };

      mockMagicLinkService.verifyMagicLink.mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/portal/auth/verify')
        .query({ token: 'valid-token' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        session: {
          sessionId: mockSession.sessionId,
          email: mockSession.email,
          expiresAt: mockSession.expiresAt.toISOString(),
        },
      });
      expect(response.headers['set-cookie']).toBeDefined();
      expect(response.headers['set-cookie'][0]).toMatch(/portal_session=session-123/);
      expect(mockMagicLinkService.verifyMagicLink).toHaveBeenCalledWith('valid-token');
    });

    it('should return 400 when token is missing', async () => {
      const response = await request(app)
        .get('/portal/auth/verify');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Token is required' });
    });

    it('should return 400 when token is not a string', async () => {
      const response = await request(app)
        .get('/portal/auth/verify')
        .query({ token: ['array', 'value'] });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Token is required' });
    });

    it('should return 401 when magic link verification fails', async () => {
      mockMagicLinkService.verifyMagicLink.mockResolvedValue({
        success: false,
        error: 'Magic link expired or already used',
      });

      const response = await request(app)
        .get('/portal/auth/verify')
        .query({ token: 'expired-token' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Magic link expired or already used' });
    });

    it('should return 401 with default error when no specific error provided', async () => {
      mockMagicLinkService.verifyMagicLink.mockResolvedValue({
        success: false,
      });

      const response = await request(app)
        .get('/portal/auth/verify')
        .query({ token: 'invalid-token' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid magic link' });
    });

    it('should return 500 when verifyMagicLink throws an error', async () => {
      mockMagicLinkService.verifyMagicLink.mockRejectedValue(new Error('Verification error'));

      const response = await request(app)
        .get('/portal/auth/verify')
        .query({ token: 'valid-token' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to verify magic link' });
    });
  });

  describe('POST /portal/auth/logout', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should logout successfully', async () => {
      mockMagicLinkService.destroySession.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/portal/auth/logout')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockMagicLinkService.destroySession).toHaveBeenCalledWith('session-123');
      // Check cookie is cleared
      expect(response.headers['set-cookie']).toBeDefined();
      expect(response.headers['set-cookie'][0]).toMatch(/portal_session=;/);
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .post('/portal/auth/logout');

      expect(response.status).toBe(401);
    });

    it('should return 500 when destroySession fails', async () => {
      mockMagicLinkService.destroySession.mockRejectedValue(new Error('Redis error'));

      const response = await request(app)
        .post('/portal/auth/logout')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to logout' });
    });
  });

  describe('GET /portal/me', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should return current customer info successfully', async () => {
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: mockCustomer.id,
        email: mockCustomer.email,
        name: mockCustomer.name,
        createdAt: mockCustomer.createdAt.toISOString(),
      });
      expect(mockCustomerRepository.findById).toHaveBeenCalledWith('cust-123');
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/me');

      expect(response.status).toBe(401);
    });

    it('should return 404 when customer not found', async () => {
      mockCustomerRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Customer not found' });
    });

    it('should return 500 when findById fails', async () => {
      mockCustomerRepository.findById.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get customer info' });
    });
  });

  describe('GET /portal/subscriptions', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should return subscriptions successfully', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([mockEntitlement]);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription);

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.subscriptions).toHaveLength(1);
      expect(response.body.subscriptions[0]).toMatchObject({
        id: mockEntitlement.id,
        productId: mockEntitlement.productId,
        status: mockEntitlement.status,
        stripeSubscription: {
          id: mockStripeSubscription.id,
          status: mockStripeSubscription.status,
          cancelAtPeriodEnd: mockStripeSubscription.cancel_at_period_end,
        },
      });
      expect(mockEntitlementService.getEntitlementsByCustomerId).toHaveBeenCalledWith('cust-123');
    });

    it('should filter out non-subscription entitlements', async () => {
      const nonSubscriptionEntitlement = { ...mockEntitlement, subscriptionId: null };
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([
        mockEntitlement,
        nonSubscriptionEntitlement,
      ]);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription);

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.subscriptions).toHaveLength(1);
      expect(mockStripeClient.getSubscription).toHaveBeenCalledTimes(1);
    });

    it('should return empty subscriptions when no subscription entitlements exist', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([]);

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.subscriptions).toHaveLength(0);
    });

    it('should handle Stripe API error gracefully for individual subscription', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([mockEntitlement]);
      mockStripeClient.getSubscription.mockRejectedValue(new Error('Stripe error'));

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.subscriptions).toHaveLength(1);
      expect(response.body.subscriptions[0].stripeSubscription).toBeNull();
    });

    it('should handle canceled subscription with canceledAt date', async () => {
      const canceledSubscription = {
        ...mockStripeSubscription,
        status: 'canceled',
        canceled_at: Math.floor(Date.now() / 1000) - 86400,
        cancel_at_period_end: true,
      };
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([mockEntitlement]);
      mockStripeClient.getSubscription.mockResolvedValue(canceledSubscription);

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.subscriptions[0].stripeSubscription.canceledAt).not.toBeNull();
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/subscriptions');

      expect(response.status).toBe(401);
    });

    it('should return 500 when getEntitlementsByCustomerId fails', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get subscriptions' });
    });
  });

  describe('GET /portal/entitlements', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should return all entitlements successfully', async () => {
      const entitlements = [
        mockEntitlement,
        { ...mockEntitlement, id: 'ent-456', subscriptionId: null },
      ];
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue(entitlements);

      const response = await request(app)
        .get('/portal/entitlements')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.entitlements).toHaveLength(2);
      expect(response.body.entitlements[0]).toMatchObject({
        id: mockEntitlement.id,
        productId: mockEntitlement.productId,
        purchaseIntentId: mockEntitlement.purchaseIntentId,
        status: mockEntitlement.status,
        isSubscription: true,
      });
      expect(response.body.entitlements[1].isSubscription).toBe(false);
    });

    it('should return empty entitlements when none exist', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([]);

      const response = await request(app)
        .get('/portal/entitlements')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.entitlements).toHaveLength(0);
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/entitlements');

      expect(response.status).toBe(401);
    });

    it('should return 500 when getEntitlementsByCustomerId fails', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/portal/entitlements')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get entitlements' });
    });
  });

  describe('POST /portal/subscriptions/:id/cancel', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should cancel subscription at period end successfully', async () => {
      mockEntitlementService.getEntitlement.mockResolvedValue(mockEntitlement);
      mockStripeClient.cancelSubscription.mockResolvedValue(mockStripeSubscription);
      mockEntitlementService.renewEntitlement.mockResolvedValue(mockEntitlement);

      const response = await request(app)
        .post('/portal/subscriptions/ent-123/cancel')
        .set('x-portal-session', 'session-123')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        subscription: {
          id: mockStripeSubscription.id,
          status: mockStripeSubscription.status,
          cancelAtPeriodEnd: mockStripeSubscription.cancel_at_period_end,
        },
      });
      expect(mockStripeClient.cancelSubscription).toHaveBeenCalledWith('sub_stripe_123', false);
      expect(mockEntitlementService.renewEntitlement).toHaveBeenCalled();
    });

    it('should cancel subscription immediately when requested', async () => {
      mockEntitlementService.getEntitlement.mockResolvedValue(mockEntitlement);
      mockStripeClient.cancelSubscription.mockResolvedValue(mockStripeSubscription);
      mockEntitlementService.revokeEntitlement.mockResolvedValue(mockEntitlement);

      const response = await request(app)
        .post('/portal/subscriptions/ent-123/cancel')
        .set('x-portal-session', 'session-123')
        .send({ immediately: true });

      expect(response.status).toBe(200);
      expect(mockStripeClient.cancelSubscription).toHaveBeenCalledWith('sub_stripe_123', true);
      expect(mockEntitlementService.revokeEntitlement).toHaveBeenCalledWith(
        'ent-123',
        'customer_cancelled_immediately'
      );
    });

    it('should return 404 when subscription not found', async () => {
      mockEntitlementService.getEntitlement.mockResolvedValue(null);

      const response = await request(app)
        .post('/portal/subscriptions/nonexistent/cancel')
        .set('x-portal-session', 'session-123')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Subscription not found' });
    });

    it('should return 403 when customer does not own the subscription', async () => {
      mockEntitlementService.getEntitlement.mockResolvedValue({
        ...mockEntitlement,
        customerId: 'different-customer',
      });

      const response = await request(app)
        .post('/portal/subscriptions/ent-123/cancel')
        .set('x-portal-session', 'session-123')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access denied' });
    });

    it('should return 400 when entitlement is not a subscription', async () => {
      mockEntitlementService.getEntitlement.mockResolvedValue({
        ...mockEntitlement,
        subscriptionId: null,
      });

      const response = await request(app)
        .post('/portal/subscriptions/ent-123/cancel')
        .set('x-portal-session', 'session-123')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Not a subscription' });
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .post('/portal/subscriptions/ent-123/cancel');

      expect(response.status).toBe(401);
    });

    it('should return 500 when Stripe cancelSubscription fails', async () => {
      mockEntitlementService.getEntitlement.mockResolvedValue(mockEntitlement);
      mockStripeClient.cancelSubscription.mockRejectedValue(new Error('Stripe error'));

      const response = await request(app)
        .post('/portal/subscriptions/ent-123/cancel')
        .set('x-portal-session', 'session-123')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to cancel subscription' });
    });
  });

  describe('GET /portal/billing', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should return billing portal URL successfully', async () => {
      const mockBillingSession = { url: 'https://billing.stripe.com/session/123' };
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);
      mockStripeClient.createBillingPortalSession.mockResolvedValue(mockBillingSession);

      const response = await request(app)
        .get('/portal/billing')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ url: mockBillingSession.url });
      expect(mockStripeClient.createBillingPortalSession).toHaveBeenCalledWith(
        mockCustomer.stripeCustomerId,
        expect.any(String)
      );
    });

    it('should use custom return_url when provided', async () => {
      const mockBillingSession = { url: 'https://billing.stripe.com/session/123' };
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);
      mockStripeClient.createBillingPortalSession.mockResolvedValue(mockBillingSession);

      const response = await request(app)
        .get('/portal/billing')
        .set('x-portal-session', 'session-123')
        .query({ return_url: 'https://custom.example.com/dashboard' });

      expect(response.status).toBe(200);
      expect(mockStripeClient.createBillingPortalSession).toHaveBeenCalledWith(
        mockCustomer.stripeCustomerId,
        'https://custom.example.com/dashboard'
      );
    });

    it('should return 404 when customer not found', async () => {
      mockCustomerRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/billing')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'No Stripe customer found' });
    });

    it('should return 404 when customer has no stripeCustomerId', async () => {
      mockCustomerRepository.findById.mockResolvedValue({
        ...mockCustomer,
        stripeCustomerId: null,
      });

      const response = await request(app)
        .get('/portal/billing')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'No Stripe customer found' });
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/billing');

      expect(response.status).toBe(401);
    });

    it('should return 500 when createBillingPortalSession fails', async () => {
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);
      mockStripeClient.createBillingPortalSession.mockRejectedValue(new Error('Stripe error'));

      const response = await request(app)
        .get('/portal/billing')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to create billing portal session' });
    });
  });

  describe('GET /portal/invoices', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should return invoices message when customer has stripeCustomerId', async () => {
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/portal/invoices')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Access invoices through the billing portal',
        billingPortalEndpoint: '/portal/billing',
      });
    });

    it('should return empty invoices when customer not found', async () => {
      mockCustomerRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/invoices')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ invoices: [] });
    });

    it('should return empty invoices when customer has no stripeCustomerId', async () => {
      mockCustomerRepository.findById.mockResolvedValue({
        ...mockCustomer,
        stripeCustomerId: null,
      });

      const response = await request(app)
        .get('/portal/invoices')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ invoices: [] });
    });

    it('should return 401 when not authenticated', async () => {
      mockMagicLinkService.verifySession.mockResolvedValue(null);

      const response = await request(app)
        .get('/portal/invoices');

      expect(response.status).toBe(401);
    });

    it('should return 500 when findById fails', async () => {
      mockCustomerRepository.findById.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/portal/invoices')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get invoices' });
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should handle entitlement with null expiresAt', async () => {
      const entitlementWithNoExpiry = { ...mockEntitlement, expiresAt: null };
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([entitlementWithNoExpiry]);

      const response = await request(app)
        .get('/portal/entitlements')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.entitlements[0].expiresAt).toBeNull();
    });

    it('should handle customer with null name', async () => {
      mockCustomerRepository.findById.mockResolvedValue({
        ...mockCustomer,
        name: null,
      });

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.name).toBeNull();
    });

    it('should handle multiple entitlements with different statuses', async () => {
      const entitlements = [
        { ...mockEntitlement, status: 'active' },
        { ...mockEntitlement, id: 'ent-456', status: 'suspended' },
        { ...mockEntitlement, id: 'ent-789', status: 'revoked', subscriptionId: null },
      ];
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue(entitlements);

      const response = await request(app)
        .get('/portal/entitlements')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.entitlements).toHaveLength(3);
      expect(response.body.entitlements.map((e: any) => e.status)).toEqual([
        'active',
        'suspended',
        'revoked',
      ]);
    });

    it('should handle subscriptions with all statuses correctly', async () => {
      const subscriptionStatuses = ['active', 'canceled', 'past_due', 'trialing', 'unpaid'];
      
      for (const status of subscriptionStatuses) {
        mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([mockEntitlement]);
        mockStripeClient.getSubscription.mockResolvedValue({
          ...mockStripeSubscription,
          status,
        });

        const response = await request(app)
          .get('/portal/subscriptions')
          .set('x-portal-session', 'session-123');

        expect(response.status).toBe(200);
        expect(response.body.subscriptions[0].stripeSubscription.status).toBe(status);
      }
    });
  });

  describe('Response Format', () => {
    beforeEach(() => {
      mockMagicLinkService.verifySession.mockResolvedValue(mockSession);
    });

    it('should return correct Content-Type header', async () => {
      mockCustomerRepository.findById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/portal/me')
        .set('x-portal-session', 'session-123');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return ISO 8601 formatted dates for entitlements', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([mockEntitlement]);

      const response = await request(app)
        .get('/portal/entitlements')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      expect(response.body.entitlements[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
    });

    it('should return proper dates for subscription period dates', async () => {
      mockEntitlementService.getEntitlementsByCustomerId.mockResolvedValue([mockEntitlement]);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription);

      const response = await request(app)
        .get('/portal/subscriptions')
        .set('x-portal-session', 'session-123');

      expect(response.status).toBe(200);
      const subscription = response.body.subscriptions[0].stripeSubscription;
      expect(subscription.currentPeriodStart).toBeDefined();
      expect(subscription.currentPeriodEnd).toBeDefined();
    });
  });

  describe('portalAuth export', () => {
    it('should export portalAuth middleware', () => {
      expect(portalAuth).toBeDefined();
      expect(typeof portalAuth).toBe('function');
    });
  });
});
