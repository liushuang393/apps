import { pool } from '../config/database';
import {
  CheckoutSessionRepository,
  checkoutSessionRepository,
  CheckoutSession,
  CreateCheckoutSessionParams,
} from '../repositories/CheckoutSessionRepository';
import {
  ProductRepository,
  productRepository,
} from '../repositories/ProductRepository';
import {
  PriceRepository,
  priceRepository,
} from '../repositories/PriceRepository';
import {
  CustomerRepository,
  customerRepository,
} from '../repositories/CustomerRepository';
import {
  StripeClient,
  stripeClient,
  CreateCheckoutSessionParams as StripeCheckoutParams,
} from './StripeClient';
import { logger } from '../utils/logger';

import { SupportedCurrency } from './CurrencyService';

/**
 * Create session parameters
 */
export interface CreateSessionParams {
  developerId: string;
  productId: string;
  priceId: string;
  purchaseIntentId: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  currency?: SupportedCurrency;
  metadata?: Record<string, string>;
  couponCode?: string;
}

/**
 * Create session result
 */
export interface CreateSessionResult {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

/**
 * CheckoutService orchestrates checkout operations
 * 
 * Responsibilities:
 * - Create Stripe checkout sessions
 * - Store session metadata with purchase_intent_id
 * - Manage session lifecycle
 * 
 * Requirements: 1.1, 1.2, 4.2
 */
export class CheckoutService {
  private checkoutSessionRepo: CheckoutSessionRepository;
  private productRepo: ProductRepository;
  private priceRepo: PriceRepository;
  private stripe: StripeClient;

  constructor(
    checkoutSessionRepo: CheckoutSessionRepository = checkoutSessionRepository,
    productRepo: ProductRepository = productRepository,
    priceRepo: PriceRepository = priceRepository,
    _customerRepo: CustomerRepository = customerRepository, // Reserved for future use
    stripe: StripeClient = stripeClient
  ) {
    this.checkoutSessionRepo = checkoutSessionRepo;
    this.productRepo = productRepo;
    this.priceRepo = priceRepo;
    this.stripe = stripe;
  }

  /**
   * Create a checkout session
   * 
   * @param params - Session parameters
   * @returns Created session with checkout URL
   */
  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Validate product exists and is active
      const product = await this.productRepo.findById(params.productId, client);
      if (!product) {
        throw new Error('Product not found');
      }
      if (!product.active) {
        throw new Error('Product is not active');
      }

      // Validate price exists and is active
      const price = await this.priceRepo.findById(params.priceId, client);
      if (!price) {
        throw new Error('Price not found');
      }
      if (!price.active) {
        throw new Error('Price is not active');
      }
      if (price.productId !== params.productId) {
        throw new Error('Price does not belong to the specified product');
      }

      // Check if session already exists for this purchase intent
      const existingSession = await this.checkoutSessionRepo.findByPurchaseIntentId(
        params.purchaseIntentId,
        client
      );

      if (existingSession && existingSession.status === 'open') {
        // Return existing session if still open
        await client.query('COMMIT');
        return {
          sessionId: existingSession.id,
          checkoutUrl: `https://checkout.stripe.com/c/pay/${existingSession.stripeSessionId}`,
          expiresAt: existingSession.expiresAt,
        };
      }

      // Handle currency selection
      const requestedCurrency = params.currency || 'usd';
      let selectedPrice = price;
      
      // Check if the selected price matches the requested currency
      if (price.currency.toLowerCase() !== requestedCurrency) {
        // Try to find a price in the requested currency for this product
        const pricesInCurrency = await this.priceRepo.findByProductIdAndCurrency(
          params.productId,
          requestedCurrency,
          true, // activeOnly
          client
        );
        
        if (pricesInCurrency.length > 0) {
          // Use the first active price in the requested currency
          const activePriceInCurrency = pricesInCurrency.find(p => p.active);
          if (activePriceInCurrency) {
            selectedPrice = activePriceInCurrency;
            logger.info('Using alternative price for currency', {
              requestedCurrency,
              originalPriceId: params.priceId,
              selectedPriceId: selectedPrice.id,
            });
          }
        } else {
          // Log that we're using the original price even though currency doesn't match
          logger.info('No price found for requested currency, using original', {
            requestedCurrency,
            priceCurrency: price.currency,
            priceId: params.priceId,
          });
        }
      }

      // Determine checkout mode based on product type
      const mode = product.type === 'subscription' ? 'subscription' : 'payment';

      // Create Stripe checkout session
      const stripeParams: StripeCheckoutParams = {
        productId: params.productId,
        priceId: selectedPrice.stripePriceId,
        purchaseIntentId: params.purchaseIntentId,
        customerEmail: params.customerEmail,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        mode,
        metadata: {
          ...params.metadata,
          requested_currency: requestedCurrency,
          original_price_id: params.priceId,
        },
      };

      const stripeSession = await this.stripe.createCheckoutSession(stripeParams);

      // Store session in database
      const createParams: CreateCheckoutSessionParams = {
        developerId: params.developerId,
        stripeSessionId: stripeSession.sessionId,
        purchaseIntentId: params.purchaseIntentId,
        productId: params.productId,
        priceId: params.priceId,
        status: 'open',
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        expiresAt: stripeSession.expiresAt,
      };

      const session = await this.checkoutSessionRepo.create(createParams, client);

      await client.query('COMMIT');

      logger.info('Checkout session created', {
        sessionId: session.id,
        stripeSessionId: stripeSession.sessionId,
        purchaseIntentId: params.purchaseIntentId,
        productId: params.productId,
      });

      return {
        sessionId: session.id,
        checkoutUrl: stripeSession.url,
        expiresAt: stripeSession.expiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating checkout session', {
        error,
        params: { ...params, customerEmail: '***' },
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a checkout session by ID
   * 
   * @param sessionId - Session ID
   * @returns Checkout session or null
   */
  async getSession(sessionId: string): Promise<CheckoutSession | null> {
    return this.checkoutSessionRepo.findById(sessionId);
  }

  /**
   * Get a checkout session by Stripe session ID
   * 
   * @param stripeSessionId - Stripe session ID
   * @returns Checkout session or null
   */
  async getSessionByStripeId(
    stripeSessionId: string
  ): Promise<CheckoutSession | null> {
    return this.checkoutSessionRepo.findByStripeSessionId(stripeSessionId);
  }

  /**
   * Get a checkout session by purchase intent ID
   * 
   * @param purchaseIntentId - Purchase intent ID
   * @returns Checkout session or null
   */
  async getSessionByPurchaseIntentId(
    purchaseIntentId: string
  ): Promise<CheckoutSession | null> {
    return this.checkoutSessionRepo.findByPurchaseIntentId(purchaseIntentId);
  }

  /**
   * Mark a session as complete
   * 
   * @param sessionId - Session ID
   * @param customerId - Customer ID
   * @returns Updated session
   */
  async markSessionComplete(
    sessionId: string,
    customerId?: string
  ): Promise<CheckoutSession | null> {
    const session = await this.checkoutSessionRepo.markComplete(
      sessionId,
      customerId
    );

    if (session) {
      logger.info('Checkout session marked complete', {
        sessionId: session.id,
        customerId,
      });
    }

    return session;
  }

  /**
   * Mark a session as expired
   * 
   * @param sessionId - Session ID
   * @returns Updated session
   */
  async markSessionExpired(sessionId: string): Promise<CheckoutSession | null> {
    const session = await this.checkoutSessionRepo.markExpired(sessionId);

    if (session) {
      logger.info('Checkout session marked expired', {
        sessionId: session.id,
      });
    }

    return session;
  }

  /**
   * Expire a session (also expires in Stripe)
   * 
   * @param sessionId - Session ID
   * @returns Updated session
   */
  async expireSession(sessionId: string): Promise<CheckoutSession | null> {
    const session = await this.checkoutSessionRepo.findById(sessionId);

    if (!session) {
      return null;
    }

    // Expire in Stripe
    try {
      await this.stripe.expireCheckoutSession(session.stripeSessionId);
    } catch (error) {
      logger.warn('Failed to expire Stripe session', {
        error,
        stripeSessionId: session.stripeSessionId,
      });
      // Continue - session might already be expired in Stripe
    }

    // Mark as expired in database
    return this.markSessionExpired(sessionId);
  }

  /**
   * Process expired sessions (cleanup job)
   * 
   * @returns Number of sessions expired
   */
  async processExpiredSessions(): Promise<number> {
    const expiredSessions = await this.checkoutSessionRepo.findExpiredSessions();

    let count = 0;
    for (const session of expiredSessions) {
      try {
        await this.markSessionExpired(session.id);
        count++;
      } catch (error) {
        logger.error('Error marking session as expired', {
          error,
          sessionId: session.id,
        });
      }
    }

    if (count > 0) {
      logger.info('Processed expired checkout sessions', { count });
    }

    return count;
  }

  /**
   * Get checkout sessions by developer
   * 
   * @param developerId - Developer ID
   * @param status - Optional status filter
   * @param limit - Maximum number of results
   * @returns Array of checkout sessions
   */
  async getSessionsByDeveloper(
    developerId: string,
    status?: 'open' | 'complete' | 'expired',
    limit: number = 100
  ): Promise<CheckoutSession[]> {
    return this.checkoutSessionRepo.findByDeveloperId(developerId, status, limit);
  }
}

// Export singleton instance
export const checkoutService = new CheckoutService();
