import Stripe from 'stripe';
import {
  WebhookLogRepository,
  webhookLogRepository,
  WebhookLog,
} from '../repositories/WebhookLogRepository';
import {
  CustomerRepository,
  customerRepository,
} from '../repositories/CustomerRepository';
import {
  CheckoutSessionRepository,
  checkoutSessionRepository,
} from '../repositories/CheckoutSessionRepository';
import { productRepository } from '../repositories/ProductRepository';
import { EntitlementService, entitlementService } from './EntitlementService';
import { StripeClient, stripeClient } from './StripeClient';
import { EmailService, emailService } from './EmailService';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Webhook processing result
 */
export interface ProcessResult {
  success: boolean;
  eventId: string;
  eventType: string;
  processed: boolean;
  error?: string;
}

/**
 * Retry configuration
 */
const RETRY_INTERVALS = [
  60 * 1000,      // 1 minute
  5 * 60 * 1000,  // 5 minutes
  15 * 60 * 1000, // 15 minutes
  60 * 60 * 1000, // 1 hour
  6 * 60 * 60 * 1000, // 6 hours
];

const MAX_RETRY_ATTEMPTS = 5;

/**
 * WebhookProcessor handles Stripe webhook events
 * 
 * Responsibilities:
 * - Verify webhook signatures
 * - Process events idempotently
 * - Route events to appropriate handlers
 * - Manage retry logic and dead letter queue
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
export class WebhookProcessor {
  private webhookLogRepo: WebhookLogRepository;
  private customerRepo: CustomerRepository;
  private checkoutSessionRepo: CheckoutSessionRepository;
  private entitlementSvc: EntitlementService;
  private stripe: StripeClient;
  private emailSvc: EmailService;

  constructor(
    webhookLogRepo: WebhookLogRepository = webhookLogRepository,
    customerRepo: CustomerRepository = customerRepository,
    checkoutSessionRepo: CheckoutSessionRepository = checkoutSessionRepository,
    entitlementSvc: EntitlementService = entitlementService,
    stripe: StripeClient = stripeClient,
    emailSvc: EmailService = emailService
  ) {
    this.webhookLogRepo = webhookLogRepo;
    this.customerRepo = customerRepo;
    this.checkoutSessionRepo = checkoutSessionRepo;
    this.entitlementSvc = entitlementSvc;
    this.stripe = stripe;
    this.emailSvc = emailSvc;
  }

  /**
   * Process a webhook event
   * 
   * @param payload - Raw request body
   * @param signature - Stripe signature header
   * @returns Processing result
   */
  async processWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<ProcessResult> {
    let event: Stripe.Event;

    // Verify signature
    try {
      event = this.stripe.verifyWebhookSignature(payload, signature);
    } catch (error) {
      logger.warn('Webhook signature verification failed', { error });
      return {
        success: false,
        eventId: '',
        eventType: '',
        processed: false,
        error: 'Invalid signature',
      };
    }

    // Check idempotency
    const existingLog = await this.webhookLogRepo.findByStripeEventId(event.id);
    if (existingLog && existingLog.status === 'processed') {
      logger.info('Webhook event already processed', {
        stripeEventId: event.id,
        eventType: event.type,
      });
      return {
        success: true,
        eventId: event.id,
        eventType: event.type,
        processed: false, // Already processed
      };
    }

    // Create or update webhook log
    let webhookLog: WebhookLog;
    if (existingLog) {
      webhookLog = existingLog;
    } else {
      webhookLog = await this.webhookLogRepo.create({
        stripeEventId: event.id,
        eventType: event.type,
        payload: event as any,
        signature,
        status: 'pending',
      });
    }

    // Process event
    try {
      await this.handleEvent(event);

      // Mark as processed
      await this.webhookLogRepo.markProcessed(webhookLog.id);

      logger.info('Webhook event processed successfully', {
        stripeEventId: event.id,
        eventType: event.type,
      });

      return {
        success: true,
        eventId: event.id,
        eventType: event.type,
        processed: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if should retry or move to DLQ
      const attempts = webhookLog.attempts + 1;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        await this.webhookLogRepo.moveToDLQ(webhookLog.id, errorMessage);
        logger.error('Webhook moved to DLQ after max retries', {
          stripeEventId: event.id,
          eventType: event.type,
          attempts,
          error: errorMessage,
        });
      } else {
        await this.webhookLogRepo.markFailed(webhookLog.id, errorMessage);
        logger.error('Webhook processing failed, will retry', {
          stripeEventId: event.id,
          eventType: event.type,
          attempts,
          error: errorMessage,
        });
      }

      return {
        success: false,
        eventId: event.id,
        eventType: event.type,
        processed: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle a webhook event by routing to appropriate handler
   * 
   * @param event - Stripe event
   */
  private async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event);
        break;
      case 'charge.refunded':
        await this.handleChargeRefunded(event);
        break;
      case 'charge.dispute.created':
        await this.handleDisputeCreated(event);
        break;
      case 'charge.dispute.closed':
        await this.handleDisputeClosed(event);
        break;
      default:
        logger.debug('Unhandled webhook event type', {
          eventType: event.type,
        });
    }
  }

  /**
   * Handle checkout.session.completed event
   * Grant entitlement to customer
   */
  private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    const purchaseIntentId = session.client_reference_id ||
      session.metadata?.purchase_intent_id;

    if (!purchaseIntentId) {
      throw new Error('Missing purchase_intent_id in checkout session');
    }

    // Get our checkout session record
    const checkoutSession = await this.checkoutSessionRepo.findByStripeSessionId(
      session.id
    );

    if (!checkoutSession) {
      throw new Error(`Checkout session not found: ${session.id}`);
    }

    // Find or create customer
    const stripeCustomerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    if (!stripeCustomerId) {
      throw new Error('Missing customer in checkout session');
    }

    // Get customer email from session
    const customerEmail = session.customer_details?.email;
    if (!customerEmail) {
      throw new Error('Missing customer email in checkout session');
    }

    const { customer } = await this.customerRepo.findOrCreate({
      developerId: checkoutSession.developerId,
      stripeCustomerId,
      email: customerEmail,
      name: session.customer_details?.name || undefined,
    });

    // Mark checkout session as complete
    await this.checkoutSessionRepo.markComplete(checkoutSession.id, customer.id);

    // Get payment info
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || '';

    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id || undefined;

    // Calculate expiration for subscriptions
    let expiresAt: Date | null = null;
    if (subscriptionId) {
      const subscription = await this.stripe.getSubscription(subscriptionId);
      expiresAt = new Date(subscription.current_period_end * 1000);
    }

    // Grant entitlement
    await this.entitlementSvc.grantEntitlement({
      customerId: customer.id,
      productId: checkoutSession.productId,
      purchaseIntentId,
      paymentId: paymentIntentId,
      subscriptionId,
      expiresAt,
    });

    logger.info('Checkout completed, entitlement granted', {
      sessionId: session.id,
      purchaseIntentId,
      customerId: customer.id,
      productId: checkoutSession.productId,
    });
  }

  /**
   * Handle invoice.paid event
   * Renew subscription entitlement
   */
  private async handleInvoicePaid(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    // Only handle subscription invoices (not first payment)
    if (!invoice.subscription || invoice.billing_reason === 'subscription_create') {
      return;
    }

    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    // Find entitlement by subscription
    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscriptionId
    );

    if (!entitlement) {
      logger.warn('No entitlement found for subscription', { subscriptionId });
      return;
    }

    // Get subscription to get new period end
    const subscription = await this.stripe.getSubscription(subscriptionId);
    const newExpiresAt = new Date(subscription.current_period_end * 1000);

    // Renew entitlement
    await this.entitlementSvc.renewEntitlement(entitlement.id, newExpiresAt);

    logger.info('Subscription renewed, entitlement extended', {
      subscriptionId,
      entitlementId: entitlement.id,
      newExpiresAt,
    });
  }

  /**
   * Handle invoice.payment_failed event
   * May suspend entitlement after grace period
   */
  private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    if (!invoice.subscription) {
      return;
    }

    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    // Find entitlement
    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscriptionId
    );

    if (!entitlement) {
      logger.warn('No entitlement found for subscription', { subscriptionId });
      return;
    }

    // Get customer info
    const customer = await this.customerRepo.findById(entitlement.customerId);
    const product = await productRepository.findById(entitlement.productId);

    // Check if this is the final failure (subscription will cancel)
    logger.warn('Subscription payment failed', {
      subscriptionId,
      entitlementId: entitlement.id,
      attemptCount: invoice.attempt_count,
    });

    // Get subscription status for notification and entitlement handling
    const subscriptionData = await this.stripe.getSubscription(subscriptionId);

    // Send notification email to customer
    if (customer && product) {
      // Calculate next retry date (Stripe typically retries after 3-7 days)
      const retryDate = new Date();
      retryDate.setDate(retryDate.getDate() + 3);

      await this.emailSvc.sendPaymentFailureNotification({
        customerEmail: customer.email,
        customerName: customer.name || undefined,
        productName: product.name,
        amount: invoice.amount_due,
        currency: invoice.currency,
        failureReason: invoice.last_finalization_error?.message,
        retryDate,
        updatePaymentUrl: `${config.app.baseUrl}/update-payment?subscription=${subscriptionId}`,
      });
    }

    // If subscription is past due, suspend entitlement
    if (subscriptionData.status === 'past_due') {
      await this.entitlementSvc.suspendEntitlement(
        entitlement.id,
        'Payment failed, subscription past due'
      );
    }
  }

  /**
   * Handle customer.subscription.updated event
   */
  private async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    // Find entitlement
    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscription.id
    );

    if (!entitlement) {
      return;
    }

    // Handle cancellation at period end
    if (subscription.cancel_at_period_end) {
      logger.info('Subscription scheduled for cancellation', {
        subscriptionId: subscription.id,
        entitlementId: entitlement.id,
        cancelAt: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000)
          : null,
      });
    }

    // Handle status changes
    if (subscription.status === 'past_due') {
      await this.entitlementSvc.suspendEntitlement(
        entitlement.id,
        'Subscription past due'
      );
    } else if (subscription.status === 'active' && entitlement.status === 'suspended') {
      await this.entitlementSvc.reactivateEntitlement(entitlement.id);
    }
  }

  /**
   * Handle customer.subscription.deleted event
   * Revoke entitlement when subscription ends
   */
  private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    // Find entitlement
    const entitlement = await this.entitlementSvc.getEntitlementBySubscriptionId(
      subscription.id
    );

    if (!entitlement) {
      return;
    }

    // Revoke entitlement
    await this.entitlementSvc.revokeEntitlement(
      entitlement.id,
      'Subscription cancelled'
    );

    logger.info('Subscription deleted, entitlement revoked', {
      subscriptionId: subscription.id,
      entitlementId: entitlement.id,
    });
  }

  /**
   * Handle charge.refunded event
   * Revoke entitlement for full refunds
   */
  private async handleChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;

    // Determine if full or partial refund
    const isFullRefund = charge.amount_refunded >= charge.amount;

    // Get payment intent ID
    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

    if (!paymentIntentId) {
      return;
    }

    // Find entitlement by payment ID
    const entitlement = await this.entitlementSvc.getEntitlement(paymentIntentId);

    if (!entitlement) {
      logger.warn('No entitlement found for refunded payment', { paymentIntentId });
      return;
    }

    if (isFullRefund) {
      // Full refund - revoke entitlement
      await this.entitlementSvc.revokeEntitlement(
        entitlement.id,
        'Full refund processed'
      );

      logger.info('Full refund processed, entitlement revoked', {
        paymentIntentId,
        entitlementId: entitlement.id,
        amountRefunded: charge.amount_refunded,
      });
    } else {
      // Partial refund - log but maintain entitlement
      logger.info('Partial refund processed, entitlement maintained', {
        paymentIntentId,
        entitlementId: entitlement.id,
        amountRefunded: charge.amount_refunded,
        originalAmount: charge.amount,
      });
    }
  }

  /**
   * Handle charge.dispute.created event
   * Immediately revoke entitlement
   */
  private async handleDisputeCreated(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;

    // Get payment intent ID
    const paymentIntentId = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

    if (!paymentIntentId) {
      return;
    }

    // Find entitlement by payment ID
    const entitlement = await this.entitlementSvc.getEntitlement(paymentIntentId);

    if (!entitlement) {
      logger.warn('No entitlement found for disputed payment', { paymentIntentId });
      return;
    }

    // Immediately revoke entitlement
    await this.entitlementSvc.revokeEntitlement(
      entitlement.id,
      `Chargeback dispute created: ${dispute.reason}`
    );

    logger.warn('Chargeback dispute created, entitlement revoked', {
      disputeId: dispute.id,
      paymentIntentId,
      entitlementId: entitlement.id,
      reason: dispute.reason,
    });

    // Get customer and product info for notification
    const customer = await this.customerRepo.findById(entitlement.customerId);
    const product = await productRepository.findById(entitlement.productId);

    // Send notification email to developer
    // Note: In a real implementation, we'd look up the developer's email
    // For now, we'll use the customer email placeholder
    if (customer && product) {
      // Calculate respond by date (typically 7-21 days)
      const respondByDate = dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000)
        : undefined;

      await this.emailSvc.sendChargebackNotification({
        developerEmail: config.email?.fromEmail || 'developer@example.com', // TODO: Get from developer record
        customerEmail: customer.email,
        productName: product.name,
        amount: dispute.amount,
        currency: dispute.currency,
        chargebackReason: dispute.reason || undefined,
        chargebackId: dispute.id,
        respondByDate,
      });
    }
  }

  /**
   * Handle charge.dispute.closed event
   * Restore entitlement if dispute won
   */
  private async handleDisputeClosed(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;

    // Get payment intent ID
    const paymentIntentId = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

    if (!paymentIntentId) {
      return;
    }

    // Find entitlement by payment ID
    const entitlement = await this.entitlementSvc.getEntitlement(paymentIntentId);

    if (!entitlement) {
      return;
    }

    if (dispute.status === 'won') {
      // Dispute won - restore entitlement
      await this.entitlementSvc.reactivateEntitlement(entitlement.id);

      logger.info('Chargeback dispute won, entitlement restored', {
        disputeId: dispute.id,
        paymentIntentId,
        entitlementId: entitlement.id,
      });
    } else {
      logger.info('Chargeback dispute lost, entitlement remains revoked', {
        disputeId: dispute.id,
        paymentIntentId,
        entitlementId: entitlement.id,
        status: dispute.status,
      });
    }
  }

  /**
   * Retry a failed webhook from the database
   * 
   * @param webhookLogId - Webhook log ID
   * @returns Processing result
   */
  async retryFailedWebhook(webhookLogId: string): Promise<ProcessResult> {
    const webhookLog = await this.webhookLogRepo.findById(webhookLogId);

    if (!webhookLog) {
      return {
        success: false,
        eventId: '',
        eventType: '',
        processed: false,
        error: 'Webhook log not found',
      };
    }

    if (webhookLog.status === 'processed') {
      return {
        success: true,
        eventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        processed: false,
        error: 'Already processed',
      };
    }

    // Process the stored event
    const event = webhookLog.payload as unknown as Stripe.Event;

    try {
      await this.handleEvent(event);

      await this.webhookLogRepo.markProcessed(webhookLog.id);

      logger.info('Webhook retry successful', {
        webhookLogId,
        stripeEventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
      });

      return {
        success: true,
        eventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        processed: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error('Error processing webhook event', {
        error,
        stripeEventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        attempts: webhookLog.attempts + 1,
      });

      const attempts = webhookLog.attempts + 1;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        await this.webhookLogRepo.moveToDLQ(webhookLog.id, errorMessage);
      } else {
        await this.webhookLogRepo.markFailed(webhookLog.id, errorMessage);
      }

      return {
        success: false,
        eventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
        processed: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get the next retry interval based on attempt count
   * 
   * @param attempts - Number of attempts so far
   * @returns Retry interval in milliseconds
   */
  getRetryInterval(attempts: number): number {
    if (attempts >= RETRY_INTERVALS.length) {
      return RETRY_INTERVALS[RETRY_INTERVALS.length - 1];
    }
    return RETRY_INTERVALS[attempts];
  }

  /**
   * Check if more retries are allowed
   * 
   * @param attempts - Number of attempts so far
   * @returns True if more retries are allowed
   */
  canRetry(attempts: number): boolean {
    return attempts < MAX_RETRY_ATTEMPTS;
  }
}

// Export singleton instance
export const webhookProcessor = new WebhookProcessor();
