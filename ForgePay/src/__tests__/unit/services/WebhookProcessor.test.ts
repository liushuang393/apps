import Stripe from 'stripe';
import { WebhookProcessor } from '../../../services/WebhookProcessor';
import { WebhookLog } from '../../../repositories/WebhookLogRepository';
import { Entitlement } from '../../../repositories/EntitlementRepository';
import { Customer } from '../../../repositories/CustomerRepository';
import { CheckoutSession } from '../../../repositories/CheckoutSessionRepository';
import { Product } from '../../../repositories/ProductRepository';
import { EntitlementStatus, CheckoutSessionStatus } from '../../../types';

// Helper function to create mock Stripe events without strict type checking
const createMockEvent = (id: string, type: string, data: any): Stripe.Event => ({
  id,
  type,
  data: { object: data },
  object: 'event',
  api_version: '2023-10-16',
  created: Date.now(),
  livemode: false,
  pending_webhooks: 0,
  request: null,
} as Stripe.Event);

// Mock all dependencies
jest.mock('../../../repositories/WebhookLogRepository', () => ({
  webhookLogRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByStripeEventId: jest.fn(),
    markProcessed: jest.fn(),
    markFailed: jest.fn(),
    moveToDLQ: jest.fn(),
  },
}));

jest.mock('../../../repositories/CustomerRepository', () => ({
  customerRepository: {
    findById: jest.fn(),
    findOrCreate: jest.fn(),
  },
}));

jest.mock('../../../repositories/CheckoutSessionRepository', () => ({
  checkoutSessionRepository: {
    findByStripeSessionId: jest.fn(),
    markComplete: jest.fn(),
  },
}));

jest.mock('../../../repositories/ProductRepository', () => ({
  productRepository: {
    findById: jest.fn(),
  },
}));

jest.mock('../../../services/EntitlementService', () => ({
  entitlementService: {
    grantEntitlement: jest.fn(),
    getEntitlement: jest.fn(),
    getEntitlementBySubscriptionId: jest.fn(),
    renewEntitlement: jest.fn(),
    suspendEntitlement: jest.fn(),
    reactivateEntitlement: jest.fn(),
    revokeEntitlement: jest.fn(),
  },
}));

jest.mock('../../../services/StripeClient', () => ({
  stripeClient: {
    verifyWebhookSignature: jest.fn(),
    getSubscription: jest.fn(),
  },
}));

jest.mock('../../../services/EmailService', () => ({
  emailService: {
    sendPaymentFailureNotification: jest.fn(),
    sendChargebackNotification: jest.fn(),
  },
}));

jest.mock('../../../config', () => ({
  config: {
    app: {
      baseUrl: 'https://test.example.com',
    },
    email: {
      fromEmail: 'test@example.com',
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

import { webhookLogRepository } from '../../../repositories/WebhookLogRepository';
import { customerRepository } from '../../../repositories/CustomerRepository';
import { checkoutSessionRepository } from '../../../repositories/CheckoutSessionRepository';
import { productRepository } from '../../../repositories/ProductRepository';
import { entitlementService } from '../../../services/EntitlementService';
import { stripeClient } from '../../../services/StripeClient';
import { emailService } from '../../../services/EmailService';
import { logger } from '../../../utils/logger';

const mockWebhookLogRepo = webhookLogRepository as jest.Mocked<typeof webhookLogRepository>;
const mockCustomerRepo = customerRepository as jest.Mocked<typeof customerRepository>;
const mockCheckoutSessionRepo = checkoutSessionRepository as jest.Mocked<typeof checkoutSessionRepository>;
const mockProductRepo = productRepository as jest.Mocked<typeof productRepository>;
const mockEntitlementSvc = entitlementService as jest.Mocked<typeof entitlementService>;
const mockStripeClient = stripeClient as jest.Mocked<typeof stripeClient>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;

  // Mock data
  const mockWebhookLog: WebhookLog = {
    id: 'wh-log-123',
    stripeEventId: 'evt_123',
    eventType: 'checkout.session.completed',
    payload: {},
    signature: 'sig_123',
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    errorMessage: null,
    createdAt: new Date(),
  };

  const mockCustomer: Customer = {
    id: 'cust-123',
    developerId: 'dev-123',
    stripeCustomerId: 'cus_stripe_123',
    email: 'customer@example.com',
    name: 'Test Customer',
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProduct: Product = {
    id: 'prod-123',
    developerId: 'dev-123',
    name: 'Test Product',
    description: 'A test product',
    stripeProductId: 'prod_stripe_123',
    type: 'one_time',
    active: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCheckoutSession: CheckoutSession = {
    id: 'cs-123',
    developerId: 'dev-123',
    productId: 'prod-123',
    priceId: 'price-123',
    purchaseIntentId: 'pi_123',
    stripeSessionId: 'cs_stripe_123',
    status: 'pending' as CheckoutSessionStatus,
    customerId: null,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    expiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  };

  const mockEntitlement: Entitlement = {
    id: 'ent-123',
    customerId: 'cust-123',
    productId: 'prod-123',
    purchaseIntentId: 'pi_123',
    paymentId: 'pay_123',
    subscriptionId: null,
    status: 'active' as EntitlementStatus,
    expiresAt: null,
    revokedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockStripeSubscription: Partial<Stripe.Subscription> = {
    id: 'sub_123',
    status: 'active',
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    cancel_at_period_end: false,
  };

  beforeEach(() => {
    processor = new WebhookProcessor();
    jest.clearAllMocks();
  });

  // ============================================
  // processWebhook tests
  // ============================================
  describe('processWebhook', () => {
    describe('signature verification', () => {
      it('should return error when signature verification fails', async () => {
        mockStripeClient.verifyWebhookSignature.mockImplementation(() => {
          throw new Error('Invalid signature');
        });

        const result = await processor.processWebhook('payload', 'invalid-sig');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid signature');
        expect(result.eventId).toBe('');
        expect(result.eventType).toBe('');
        expect(logger.warn).toHaveBeenCalledWith(
          'Webhook signature verification failed',
          expect.any(Object)
        );
      });
    });

    describe('idempotency', () => {
      it('should return early if event already processed', async () => {
        const mockEvent = createMockEvent('evt_123', 'checkout.session.completed', {});

        mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
        mockWebhookLogRepo.findByStripeEventId.mockResolvedValue({
          ...mockWebhookLog,
          status: 'processed',
        });

        const result = await processor.processWebhook('payload', 'sig');

        expect(result.success).toBe(true);
        expect(result.processed).toBe(false);
        expect(result.eventId).toBe('evt_123');
        expect(logger.info).toHaveBeenCalledWith(
          'Webhook event already processed',
          expect.any(Object)
        );
      });
    });

    describe('event processing', () => {
      it('should create new webhook log for new event', async () => {
        const mockEvent = createMockEvent('evt_new_123', 'checkout.session.completed', {
          id: 'cs_stripe_123',
          client_reference_id: 'pi_123',
          customer: 'cus_stripe_123',
          customer_details: {
            email: 'customer@example.com',
            name: 'Test Customer',
          },
          payment_intent: 'pay_123',
          subscription: null,
        });

        mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
        mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
        mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
        mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
        mockCustomerRepo.findOrCreate.mockResolvedValue({
          customer: mockCustomer,
          created: true,
        });
        mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
        mockEntitlementSvc.grantEntitlement.mockResolvedValue({
          entitlement: mockEntitlement,
          unlockToken: 'token_123',
        });
        mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

        const result = await processor.processWebhook('payload', 'sig');

        expect(result.success).toBe(true);
        expect(result.processed).toBe(true);
        expect(mockWebhookLogRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            stripeEventId: 'evt_new_123',
            eventType: 'checkout.session.completed',
            status: 'pending',
          })
        );
      });

      it('should reuse existing webhook log for retry', async () => {
        const mockEvent = createMockEvent('evt_123', 'checkout.session.completed', {
          id: 'cs_stripe_123',
          client_reference_id: 'pi_123',
          customer: 'cus_stripe_123',
          customer_details: {
            email: 'customer@example.com',
            name: 'Test Customer',
          },
          payment_intent: 'pay_123',
          subscription: null,
        });

        const pendingLog = { ...mockWebhookLog, status: 'failed' as const, attempts: 1 };

        mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
        mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(pendingLog);
        mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
        mockCustomerRepo.findOrCreate.mockResolvedValue({
          customer: mockCustomer,
          created: false,
        });
        mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
        mockEntitlementSvc.grantEntitlement.mockResolvedValue({
          entitlement: mockEntitlement,
          unlockToken: 'token_123',
        });
        mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

        const result = await processor.processWebhook('payload', 'sig');

        expect(result.success).toBe(true);
        expect(mockWebhookLogRepo.create).not.toHaveBeenCalled();
      });
    });

    describe('error handling and retry logic', () => {
      it('should mark as failed when processing fails with retries remaining', async () => {
        const mockEvent = createMockEvent('evt_123', 'checkout.session.completed', {
          id: 'cs_stripe_123',
          client_reference_id: 'pi_123',
        });

        mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
        mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
        mockWebhookLogRepo.create.mockResolvedValue({ ...mockWebhookLog, attempts: 1 });
        mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(null);
        mockWebhookLogRepo.markFailed.mockResolvedValue(mockWebhookLog);

        const result = await processor.processWebhook('payload', 'sig');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Checkout session not found');
        expect(mockWebhookLogRepo.markFailed).toHaveBeenCalled();
        expect(mockWebhookLogRepo.moveToDLQ).not.toHaveBeenCalled();
      });

      it('should move to DLQ after max retries exceeded', async () => {
        const mockEvent = createMockEvent('evt_123', 'checkout.session.completed', {
          id: 'cs_stripe_123',
          client_reference_id: 'pi_123',
        });

        mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
        mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
        mockWebhookLogRepo.create.mockResolvedValue({ ...mockWebhookLog, attempts: 4 }); // 4 attempts, +1 = 5 = max
        mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(null);
        mockWebhookLogRepo.moveToDLQ.mockResolvedValue(mockWebhookLog);

        const result = await processor.processWebhook('payload', 'sig');

        expect(result.success).toBe(false);
        expect(mockWebhookLogRepo.moveToDLQ).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
          'Webhook moved to DLQ after max retries',
          expect.any(Object)
        );
      });
    });
  });

  // ============================================
  // checkout.session.completed handler tests
  // ============================================
  describe('handleCheckoutSessionCompleted', () => {
    it('should process checkout completion successfully', async () => {
      const mockEvent = createMockEvent('evt_checkout_123', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: 'pi_123',
        customer: 'cus_stripe_123',
        customer_details: {
          email: 'customer@example.com',
          name: 'Test Customer',
        },
        payment_intent: 'pay_123',
        subscription: null,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockCustomerRepo.findOrCreate.mockResolvedValue({
        customer: mockCustomer,
        created: true,
      });
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
      mockEntitlementSvc.grantEntitlement.mockResolvedValue({
        entitlement: mockEntitlement,
        unlockToken: 'token_123',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.grantEntitlement).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-123',
          productId: 'prod-123',
          purchaseIntentId: 'pi_123',
          paymentId: 'pay_123',
          subscriptionId: undefined,
          expiresAt: null,
        })
      );
    });

    it('should handle subscription checkout with expiry date', async () => {
      const subscriptionId = 'sub_123';
      const mockEvent = createMockEvent('evt_checkout_sub_123', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: 'pi_123',
        customer: 'cus_stripe_123',
        customer_details: {
          email: 'customer@example.com',
          name: 'Test Customer',
        },
        payment_intent: 'pay_123',
        subscription: subscriptionId,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockCustomerRepo.findOrCreate.mockResolvedValue({
        customer: mockCustomer,
        created: true,
      });
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription as Stripe.Subscription);
      mockEntitlementSvc.grantEntitlement.mockResolvedValue({
        entitlement: { ...mockEntitlement, subscriptionId },
        unlockToken: 'token_123',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockStripeClient.getSubscription).toHaveBeenCalledWith(subscriptionId);
      expect(mockEntitlementSvc.grantEntitlement).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId,
          expiresAt: expect.any(Date),
        })
      );
    });

    it('should throw error when purchase_intent_id is missing', async () => {
      const mockEvent = createMockEvent('evt_no_pi', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: null,
        metadata: {},
        customer: 'cus_stripe_123',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue({ ...mockWebhookLog, attempts: 0 });
      mockWebhookLogRepo.markFailed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing purchase_intent_id');
    });

    it('should throw error when checkout session not found', async () => {
      const mockEvent = createMockEvent('evt_no_session', 'checkout.session.completed', {
        id: 'cs_nonexistent',
        client_reference_id: 'pi_123',
        customer: 'cus_stripe_123',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue({ ...mockWebhookLog, attempts: 0 });
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(null);
      mockWebhookLogRepo.markFailed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Checkout session not found');
    });

    it('should throw error when customer email is missing', async () => {
      const mockEvent = createMockEvent('evt_no_email', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: 'pi_123',
        customer: 'cus_stripe_123',
        customer_details: {
          email: null,
          name: 'Test Customer',
        },
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue({ ...mockWebhookLog, attempts: 0 });
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockWebhookLogRepo.markFailed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing customer email');
    });

    it('should use metadata purchase_intent_id when client_reference_id is null', async () => {
      const mockEvent = createMockEvent('evt_metadata_pi', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: null,
        metadata: { purchase_intent_id: 'pi_from_metadata' },
        customer: 'cus_stripe_123',
        customer_details: {
          email: 'customer@example.com',
          name: 'Test Customer',
        },
        payment_intent: 'pay_123',
        subscription: null,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockCustomerRepo.findOrCreate.mockResolvedValue({
        customer: mockCustomer,
        created: true,
      });
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
      mockEntitlementSvc.grantEntitlement.mockResolvedValue({
        entitlement: mockEntitlement,
        unlockToken: 'token_123',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.grantEntitlement).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseIntentId: 'pi_from_metadata',
        })
      );
    });
  });

  // ============================================
  // invoice.paid handler tests
  // ============================================
  describe('handleInvoicePaid', () => {
    it('should renew subscription entitlement on invoice paid', async () => {
      const mockEvent = createMockEvent('evt_invoice_paid', 'invoice.paid', {
        id: 'in_123',
        subscription: 'sub_123',
        billing_reason: 'subscription_cycle',
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription as Stripe.Subscription);
      mockEntitlementSvc.renewEntitlement.mockResolvedValue(subEntitlement);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.renewEntitlement).toHaveBeenCalledWith(
        'ent-123',
        expect.any(Date)
      );
    });

    it('should skip first invoice (subscription_create)', async () => {
      const mockEvent = createMockEvent('evt_invoice_first', 'invoice.paid', {
        id: 'in_123',
        subscription: 'sub_123',
        billing_reason: 'subscription_create',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlementBySubscriptionId).not.toHaveBeenCalled();
      expect(mockEntitlementSvc.renewEntitlement).not.toHaveBeenCalled();
    });

    it('should skip invoice without subscription', async () => {
      const mockEvent = createMockEvent('evt_invoice_no_sub', 'invoice.paid', {
        id: 'in_123',
        subscription: null,
        billing_reason: 'manual',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.renewEntitlement).not.toHaveBeenCalled();
    });

    it('should handle missing entitlement gracefully', async () => {
      const mockEvent = createMockEvent('evt_invoice_no_ent', 'invoice.paid', {
        id: 'in_123',
        subscription: 'sub_unknown',
        billing_reason: 'subscription_cycle',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(null);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'No entitlement found for subscription',
        expect.any(Object)
      );
    });
  });

  // ============================================
  // invoice.payment_failed handler tests
  // ============================================
  describe('handleInvoicePaymentFailed', () => {
    it('should suspend entitlement when subscription is past_due', async () => {
      const mockEvent = createMockEvent('evt_payment_failed', 'invoice.payment_failed', {
        id: 'in_123',
        subscription: 'sub_123',
        attempt_count: 2,
        amount_due: 1999,
        currency: 'usd',
        last_finalization_error: { message: 'Card declined' },
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockCustomerRepo.findById.mockResolvedValue(mockCustomer);
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockStripeClient.getSubscription.mockResolvedValue({
        ...mockStripeSubscription,
        status: 'past_due',
      } as Stripe.Subscription);
      mockEmailService.sendPaymentFailureNotification.mockResolvedValue(true);
      mockEntitlementSvc.suspendEntitlement.mockResolvedValue({
        ...subEntitlement,
        status: 'suspended',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEmailService.sendPaymentFailureNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: 'customer@example.com',
          productName: 'Test Product',
          amount: 1999,
          currency: 'usd',
        })
      );
      expect(mockEntitlementSvc.suspendEntitlement).toHaveBeenCalledWith(
        'ent-123',
        'Payment failed, subscription past due'
      );
    });

    it('should send notification but not suspend when subscription is active', async () => {
      const mockEvent = createMockEvent('evt_payment_failed_active', 'invoice.payment_failed', {
        id: 'in_123',
        subscription: 'sub_123',
        attempt_count: 1,
        amount_due: 1999,
        currency: 'usd',
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockCustomerRepo.findById.mockResolvedValue(mockCustomer);
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockStripeClient.getSubscription.mockResolvedValue({
        ...mockStripeSubscription,
        status: 'active',
      } as Stripe.Subscription);
      mockEmailService.sendPaymentFailureNotification.mockResolvedValue(true);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEmailService.sendPaymentFailureNotification).toHaveBeenCalled();
      expect(mockEntitlementSvc.suspendEntitlement).not.toHaveBeenCalled();
    });

    it('should skip invoice without subscription', async () => {
      const mockEvent = createMockEvent('evt_payment_failed_no_sub', 'invoice.payment_failed', {
        id: 'in_123',
        subscription: null,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlementBySubscriptionId).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // customer.subscription.updated handler tests
  // ============================================
  describe('handleSubscriptionUpdated', () => {
    it('should suspend entitlement when subscription becomes past_due', async () => {
      const mockEvent = createMockEvent('evt_sub_updated', 'customer.subscription.updated', {
        id: 'sub_123',
        status: 'past_due',
        cancel_at_period_end: false,
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockEntitlementSvc.suspendEntitlement.mockResolvedValue({
        ...subEntitlement,
        status: 'suspended',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.suspendEntitlement).toHaveBeenCalledWith(
        'ent-123',
        'Subscription past due'
      );
    });

    it('should reactivate entitlement when subscription becomes active from suspended', async () => {
      const mockEvent = createMockEvent('evt_sub_reactivated', 'customer.subscription.updated', {
        id: 'sub_123',
        status: 'active',
        cancel_at_period_end: false,
      });

      const suspendedEntitlement = {
        ...mockEntitlement,
        subscriptionId: 'sub_123',
        status: 'suspended' as EntitlementStatus,
      };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(suspendedEntitlement);
      mockEntitlementSvc.reactivateEntitlement.mockResolvedValue({
        ...suspendedEntitlement,
        status: 'active',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.reactivateEntitlement).toHaveBeenCalledWith('ent-123');
    });

    it('should log when subscription is scheduled for cancellation', async () => {
      const mockEvent = createMockEvent('evt_sub_cancel_scheduled', 'customer.subscription.updated', {
        id: 'sub_123',
        status: 'active',
        cancel_at_period_end: true,
        cancel_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Subscription scheduled for cancellation',
        expect.any(Object)
      );
    });

    it('should handle missing entitlement gracefully', async () => {
      const mockEvent = createMockEvent('evt_sub_no_ent', 'customer.subscription.updated', {
        id: 'sub_unknown',
        status: 'active',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(null);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.suspendEntitlement).not.toHaveBeenCalled();
      expect(mockEntitlementSvc.reactivateEntitlement).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // customer.subscription.deleted handler tests
  // ============================================
  describe('handleSubscriptionDeleted', () => {
    it('should revoke entitlement when subscription is deleted', async () => {
      const mockEvent = createMockEvent('evt_sub_deleted', 'customer.subscription.deleted', {
        id: 'sub_123',
        status: 'canceled',
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_123' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockEntitlementSvc.revokeEntitlement.mockResolvedValue({
        ...subEntitlement,
        status: 'revoked',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.revokeEntitlement).toHaveBeenCalledWith(
        'ent-123',
        'Subscription cancelled'
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Subscription deleted, entitlement revoked',
        expect.any(Object)
      );
    });

    it('should handle missing entitlement gracefully', async () => {
      const mockEvent = createMockEvent('evt_sub_deleted_no_ent', 'customer.subscription.deleted', {
        id: 'sub_unknown',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(null);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.revokeEntitlement).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // charge.refunded handler tests
  // ============================================
  describe('handleChargeRefunded', () => {
    it('should revoke entitlement on full refund', async () => {
      const mockEvent = createMockEvent('evt_full_refund', 'charge.refunded', {
        id: 'ch_123',
        payment_intent: 'pay_123',
        amount: 1999,
        amount_refunded: 1999,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(mockEntitlement);
      mockEntitlementSvc.revokeEntitlement.mockResolvedValue({
        ...mockEntitlement,
        status: 'revoked',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.revokeEntitlement).toHaveBeenCalledWith(
        'ent-123',
        'Full refund processed'
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Full refund processed, entitlement revoked',
        expect.any(Object)
      );
    });

    it('should not revoke entitlement on partial refund', async () => {
      const mockEvent = createMockEvent('evt_partial_refund', 'charge.refunded', {
        id: 'ch_123',
        payment_intent: 'pay_123',
        amount: 1999,
        amount_refunded: 500,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(mockEntitlement);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.revokeEntitlement).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Partial refund processed, entitlement maintained',
        expect.any(Object)
      );
    });

    it('should skip when payment_intent is missing', async () => {
      const mockEvent = createMockEvent('evt_refund_no_pi', 'charge.refunded', {
        id: 'ch_123',
        payment_intent: null,
        amount: 1999,
        amount_refunded: 1999,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlement).not.toHaveBeenCalled();
    });

    it('should handle missing entitlement gracefully', async () => {
      const mockEvent = createMockEvent('evt_refund_no_ent', 'charge.refunded', {
        id: 'ch_123',
        payment_intent: 'pay_unknown',
        amount: 1999,
        amount_refunded: 1999,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(null);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'No entitlement found for refunded payment',
        expect.any(Object)
      );
    });
  });

  // ============================================
  // charge.dispute.created handler tests
  // ============================================
  describe('handleDisputeCreated', () => {
    it('should revoke entitlement and send notification on dispute', async () => {
      const mockEvent = createMockEvent('evt_dispute_created', 'charge.dispute.created', {
        id: 'dp_123',
        payment_intent: 'pay_123',
        reason: 'fraudulent',
        amount: 1999,
        currency: 'usd',
        evidence_details: {
          due_by: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        },
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(mockEntitlement);
      mockEntitlementSvc.revokeEntitlement.mockResolvedValue({
        ...mockEntitlement,
        status: 'revoked',
      });
      mockCustomerRepo.findById.mockResolvedValue(mockCustomer);
      mockProductRepo.findById.mockResolvedValue(mockProduct);
      mockEmailService.sendChargebackNotification.mockResolvedValue(true);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.revokeEntitlement).toHaveBeenCalledWith(
        'ent-123',
        'Chargeback dispute created: fraudulent'
      );
      expect(mockEmailService.sendChargebackNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: 'customer@example.com',
          productName: 'Test Product',
          amount: 1999,
          currency: 'usd',
          chargebackReason: 'fraudulent',
          chargebackId: 'dp_123',
        })
      );
    });

    it('should skip when payment_intent is missing', async () => {
      const mockEvent = createMockEvent('evt_dispute_no_pi', 'charge.dispute.created', {
        id: 'dp_123',
        payment_intent: null,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlement).not.toHaveBeenCalled();
    });

    it('should handle missing entitlement gracefully', async () => {
      const mockEvent = createMockEvent('evt_dispute_no_ent', 'charge.dispute.created', {
        id: 'dp_123',
        payment_intent: 'pay_unknown',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent as Stripe.Event);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(null);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'No entitlement found for disputed payment',
        expect.any(Object)
      );
    });
  });

  // ============================================
  // charge.dispute.closed handler tests
  // ============================================
  describe('handleDisputeClosed', () => {
    it('should restore entitlement when dispute is won', async () => {
      const mockEvent = createMockEvent('evt_dispute_won', 'charge.dispute.closed', {
        id: 'dp_123',
        payment_intent: 'pay_123',
        status: 'won',
      });

      const revokedEntitlement = { ...mockEntitlement, status: 'revoked' as EntitlementStatus };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(revokedEntitlement);
      mockEntitlementSvc.reactivateEntitlement.mockResolvedValue({
        ...revokedEntitlement,
        status: 'active',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.reactivateEntitlement).toHaveBeenCalledWith('ent-123');
      expect(logger.info).toHaveBeenCalledWith(
        'Chargeback dispute won, entitlement restored',
        expect.any(Object)
      );
    });

    it('should not restore entitlement when dispute is lost', async () => {
      const mockEvent = createMockEvent('evt_dispute_lost', 'charge.dispute.closed', {
        id: 'dp_123',
        payment_intent: 'pay_123',
        status: 'lost',
      });

      const revokedEntitlement = { ...mockEntitlement, status: 'revoked' as EntitlementStatus };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(revokedEntitlement);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.reactivateEntitlement).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Chargeback dispute lost, entitlement remains revoked',
        expect.any(Object)
      );
    });

    it('should skip when payment_intent is missing', async () => {
      const mockEvent = createMockEvent('evt_dispute_closed_no_pi', 'charge.dispute.closed', {
        id: 'dp_123',
        payment_intent: null,
        status: 'won',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlement).not.toHaveBeenCalled();
    });

    it('should handle missing entitlement gracefully', async () => {
      const mockEvent = createMockEvent('evt_dispute_closed_no_ent', 'charge.dispute.closed', {
        id: 'dp_123',
        payment_intent: 'pay_unknown',
        status: 'won',
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(null);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.reactivateEntitlement).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Unhandled event types
  // ============================================
  describe('unhandled event types', () => {
    it('should log debug message for unhandled event types', async () => {
      const mockEvent = createMockEvent('evt_unknown', 'customer.created', {});

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        'Unhandled webhook event type',
        { eventType: 'customer.created' }
      );
    });
  });

  // ============================================
  // retryFailedWebhook tests
  // ============================================
  describe('retryFailedWebhook', () => {
    it('should return error when webhook log not found', async () => {
      mockWebhookLogRepo.findById.mockResolvedValue(null);

      const result = await processor.retryFailedWebhook('nonexistent-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Webhook log not found');
    });

    it('should return already processed when webhook is already processed', async () => {
      mockWebhookLogRepo.findById.mockResolvedValue({
        ...mockWebhookLog,
        status: 'processed',
      });

      const result = await processor.retryFailedWebhook('wh-log-123');

      expect(result.success).toBe(true);
      expect(result.processed).toBe(false);
      expect(result.error).toBe('Already processed');
    });

    it('should successfully retry a failed webhook', async () => {
      const failedLog: WebhookLog = {
        ...mockWebhookLog,
        status: 'failed',
        attempts: 1,
        payload: {
          id: 'evt_123',
          type: 'customer.created', // Unhandled type - will succeed
          data: { object: {} },
        },
      };

      mockWebhookLogRepo.findById.mockResolvedValue(failedLog);
      mockWebhookLogRepo.markProcessed.mockResolvedValue({
        ...failedLog,
        status: 'processed',
      });

      const result = await processor.retryFailedWebhook('wh-log-123');

      expect(result.success).toBe(true);
      expect(result.processed).toBe(true);
      expect(mockWebhookLogRepo.markProcessed).toHaveBeenCalledWith('wh-log-123');
    });

    it('should mark as failed on retry error with retries remaining', async () => {
      const failedLog: WebhookLog = {
        ...mockWebhookLog,
        status: 'failed',
        attempts: 1,
        payload: {
          id: 'evt_123',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_stripe_123',
              client_reference_id: null,
              metadata: {},
            },
          },
        },
      };

      mockWebhookLogRepo.findById.mockResolvedValue(failedLog);
      mockWebhookLogRepo.markFailed.mockResolvedValue({
        ...failedLog,
        attempts: 2,
      });

      const result = await processor.retryFailedWebhook('wh-log-123');

      expect(result.success).toBe(false);
      expect(mockWebhookLogRepo.markFailed).toHaveBeenCalled();
      expect(mockWebhookLogRepo.moveToDLQ).not.toHaveBeenCalled();
    });

    it('should move to DLQ on retry error after max attempts', async () => {
      const failedLog: WebhookLog = {
        ...mockWebhookLog,
        status: 'failed',
        attempts: 4, // 4 + 1 = 5 = MAX_RETRY_ATTEMPTS
        payload: {
          id: 'evt_123',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_stripe_123',
              client_reference_id: null,
              metadata: {},
            },
          },
        },
      };

      mockWebhookLogRepo.findById.mockResolvedValue(failedLog);
      mockWebhookLogRepo.moveToDLQ.mockResolvedValue({
        ...failedLog,
        status: 'dlq',
      });

      const result = await processor.retryFailedWebhook('wh-log-123');

      expect(result.success).toBe(false);
      expect(mockWebhookLogRepo.moveToDLQ).toHaveBeenCalled();
    });
  });

  // ============================================
  // getRetryInterval tests
  // ============================================
  describe('getRetryInterval', () => {
    it('should return 1 minute for first retry', () => {
      expect(processor.getRetryInterval(0)).toBe(60 * 1000);
    });

    it('should return 5 minutes for second retry', () => {
      expect(processor.getRetryInterval(1)).toBe(5 * 60 * 1000);
    });

    it('should return 15 minutes for third retry', () => {
      expect(processor.getRetryInterval(2)).toBe(15 * 60 * 1000);
    });

    it('should return 1 hour for fourth retry', () => {
      expect(processor.getRetryInterval(3)).toBe(60 * 60 * 1000);
    });

    it('should return 6 hours for fifth retry', () => {
      expect(processor.getRetryInterval(4)).toBe(6 * 60 * 60 * 1000);
    });

    it('should return max interval for attempts beyond array', () => {
      expect(processor.getRetryInterval(10)).toBe(6 * 60 * 60 * 1000);
      expect(processor.getRetryInterval(100)).toBe(6 * 60 * 60 * 1000);
    });
  });

  // ============================================
  // canRetry tests
  // ============================================
  describe('canRetry', () => {
    it('should return true for attempts less than max', () => {
      expect(processor.canRetry(0)).toBe(true);
      expect(processor.canRetry(1)).toBe(true);
      expect(processor.canRetry(2)).toBe(true);
      expect(processor.canRetry(3)).toBe(true);
      expect(processor.canRetry(4)).toBe(true);
    });

    it('should return false when max attempts reached', () => {
      expect(processor.canRetry(5)).toBe(false);
      expect(processor.canRetry(6)).toBe(false);
      expect(processor.canRetry(100)).toBe(false);
    });
  });

  // ============================================
  // Edge cases
  // ============================================
  describe('edge cases', () => {
    it('should handle customer as object in checkout session', async () => {
      const mockEvent = createMockEvent('evt_customer_object', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: 'pi_123',
        customer: { id: 'cus_from_object' },
        customer_details: {
          email: 'customer@example.com',
          name: 'Test Customer',
        },
        payment_intent: 'pay_123',
        subscription: null,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockCustomerRepo.findOrCreate.mockResolvedValue({
        customer: { ...mockCustomer, stripeCustomerId: 'cus_from_object' },
        created: true,
      });
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
      mockEntitlementSvc.grantEntitlement.mockResolvedValue({
        entitlement: mockEntitlement,
        unlockToken: 'token_123',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockCustomerRepo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: 'cus_from_object',
        })
      );
    });

    it('should handle subscription as object in checkout session', async () => {
      const mockEvent = createMockEvent('evt_sub_object', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: 'pi_123',
        customer: 'cus_stripe_123',
        customer_details: {
          email: 'customer@example.com',
          name: 'Test Customer',
        },
        payment_intent: 'pay_123',
        subscription: { id: 'sub_from_object' },
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockCustomerRepo.findOrCreate.mockResolvedValue({
        customer: mockCustomer,
        created: true,
      });
      mockCheckoutSessionRepo.markComplete.mockResolvedValue(mockCheckoutSession);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription as Stripe.Subscription);
      mockEntitlementSvc.grantEntitlement.mockResolvedValue({
        entitlement: { ...mockEntitlement, subscriptionId: 'sub_from_object' },
        unlockToken: 'token_123',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockStripeClient.getSubscription).toHaveBeenCalledWith('sub_from_object');
    });

    it('should handle payment_intent as object in charge', async () => {
      const mockEvent = createMockEvent('evt_pi_object', 'charge.refunded', {
        id: 'ch_123',
        payment_intent: { id: 'pay_from_object' },
        amount: 1999,
        amount_refunded: 1999,
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlement.mockResolvedValue(mockEntitlement);
      mockEntitlementSvc.revokeEntitlement.mockResolvedValue({
        ...mockEntitlement,
        status: 'revoked',
      });
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlement).toHaveBeenCalledWith('pay_from_object');
    });

    it('should handle subscription as object in invoice', async () => {
      const mockEvent = createMockEvent('evt_invoice_sub_object', 'invoice.paid', {
        id: 'in_123',
        subscription: { id: 'sub_from_object' },
        billing_reason: 'subscription_cycle',
      });

      const subEntitlement = { ...mockEntitlement, subscriptionId: 'sub_from_object' };

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue(mockWebhookLog);
      mockEntitlementSvc.getEntitlementBySubscriptionId.mockResolvedValue(subEntitlement);
      mockStripeClient.getSubscription.mockResolvedValue(mockStripeSubscription as Stripe.Subscription);
      mockEntitlementSvc.renewEntitlement.mockResolvedValue(subEntitlement);
      mockWebhookLogRepo.markProcessed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(true);
      expect(mockEntitlementSvc.getEntitlementBySubscriptionId).toHaveBeenCalledWith('sub_from_object');
    });

    it('should throw error when customer is missing in checkout session', async () => {
      const mockEvent = createMockEvent('evt_no_customer', 'checkout.session.completed', {
        id: 'cs_stripe_123',
        client_reference_id: 'pi_123',
        customer: null,
        customer_details: {
          email: 'customer@example.com',
        },
      });

      mockStripeClient.verifyWebhookSignature.mockReturnValue(mockEvent);
      mockWebhookLogRepo.findByStripeEventId.mockResolvedValue(null);
      mockWebhookLogRepo.create.mockResolvedValue({ ...mockWebhookLog, attempts: 0 });
      mockCheckoutSessionRepo.findByStripeSessionId.mockResolvedValue(mockCheckoutSession);
      mockWebhookLogRepo.markFailed.mockResolvedValue(mockWebhookLog);

      const result = await processor.processWebhook('payload', 'sig');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing customer in checkout session');
    });
  });
});
