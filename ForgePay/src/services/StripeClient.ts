import Stripe from 'stripe';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * サポートする決済方法の型定義
 */
export type PaymentMethodType =
  | 'card'
  | 'konbini'         // 日本のコンビニ決済
  | 'customer_balance' // 銀行振込
  | 'alipay'
  | 'wechat_pay'
  | 'link';           // Stripe Link（ワンクリック決済）

/**
 * サポートするロケールの型定義
 */
export type CheckoutLocale =
  | 'auto' | 'ja' | 'en' | 'zh' | 'ko' | 'fr' | 'de' | 'es'
  | 'it' | 'pt' | 'nl' | 'th' | 'vi' | 'id' | 'ms';

/**
 * Stripe Checkout Session parameters
 */
export interface CreateCheckoutSessionParams {
  productId: string;
  priceId: string;
  purchaseIntentId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  mode: 'payment' | 'subscription';
  metadata?: Record<string, string>;
  /** 決済方法の指定（未指定の場合は Stripe のデフォルト） */
  paymentMethodTypes?: PaymentMethodType[];
  /** Checkout 画面のロケール */
  locale?: CheckoutLocale;
}

/**
 * Stripe Checkout Session result
 */
export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
  expiresAt: Date;
}

/**
 * Create Product params
 */
export interface CreateProductParams {
  name: string;
  description?: string;
  type?: 'one_time' | 'subscription';
  metadata?: Record<string, string>;
}

/**
 * Update Product params
 */
export interface UpdateProductParams {
  name?: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, string>;
}

/**
 * Create Price params
 */
export interface CreatePriceParams {
  productId: string;
  unitAmount: number;
  currency: string;
  recurring?: {
    interval: 'month' | 'year';
  };
  metadata?: Record<string, string>;
}

/**
 * Refund params
 */
export interface CreateRefundParams {
  paymentIntentId: string;
  amount?: number; // Optional for partial refund
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

/**
 * StripeClient provides a wrapper around the Stripe SDK
 * 
 * Responsibilities:
 * - Initialize Stripe SDK with API key
 * - Create checkout sessions
 * - Create products and prices
 * - Process refunds
 * - Verify webhook signatures
 * 
 * Requirements: 1.1, 1.4, 8.3
 */
/**
 * PaymentIntent 作成パラメータ（方案2: Stripe Elements 用）
 */
export interface CreatePaymentIntentParams {
  amount: number;
  currency: string;
  customerId?: string;
  receiptEmail?: string;
  metadata?: Record<string, string>;
  /** 自動決済方法（Elements では true 推奨） */
  automaticPaymentMethods?: boolean;
}

/**
 * SetupIntent 作成パラメータ（方案3: カード登録のみ）
 */
export interface CreateSetupIntentParams {
  customerId: string;
  metadata?: Record<string, string>;
}

/**
 * Subscription 作成パラメータ（方案3: PaymentIntent API）
 */
export interface CreateSubscriptionParams {
  customerId: string;
  priceId: string;
  paymentMethodId?: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}

/**
 * Subscription 更新パラメータ（方案3: アップグレード/ダウングレード）
 */
export interface UpdateSubscriptionParams {
  newPriceId: string;
  /** 日割り計算方法 */
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export class StripeClient {
  private stripe: Stripe;

  constructor(apiKey: string = config.stripe.secretKey) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 80000,
    });
  }

  /**
   * 生の Stripe インスタンスを返す（高度な操作用）
   */
  get rawStripe(): Stripe {
    return this.stripe;
  }

  /**
   * Create a Stripe Checkout Session
   * 
   * @param params - Checkout session parameters
   * @returns Checkout session result with URL
   */
  async createCheckoutSession(
    params: CreateCheckoutSessionParams
  ): Promise<CheckoutSessionResult> {
    try {
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: params.mode,
        line_items: [
          {
            price: params.priceId,
            quantity: 1,
          },
        ],
        success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: params.cancelUrl,
        client_reference_id: params.purchaseIntentId,
        metadata: {
          purchase_intent_id: params.purchaseIntentId,
          product_id: params.productId,
          ...params.metadata,
        },
        automatic_tax: {
          enabled: true,
        },
        expires_at: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      };

      // 決済方法の指定
      if (params.paymentMethodTypes && params.paymentMethodTypes.length > 0) {
        sessionParams.payment_method_types = params.paymentMethodTypes as Stripe.Checkout.SessionCreateParams.PaymentMethodType[];
      }

      // ロケールの指定（Checkout 画面の表示言語）
      if (params.locale && params.locale !== 'auto') {
        sessionParams.locale = params.locale as Stripe.Checkout.SessionCreateParams.Locale;
      }

      // Add customer or customer_creation
      if (params.customerId) {
        sessionParams.customer = params.customerId;
      } else if (params.customerEmail) {
        sessionParams.customer_email = params.customerEmail;
        sessionParams.customer_creation = 'always';
      } else {
        sessionParams.customer_creation = 'always';
      }

      // Add subscription-specific metadata
      if (params.mode === 'subscription') {
        sessionParams.subscription_data = {
          metadata: {
            purchase_intent_id: params.purchaseIntentId,
          },
        };
      }

      const session = await this.stripe.checkout.sessions.create(sessionParams);

      logger.info('Stripe checkout session created', {
        sessionId: session.id,
        purchaseIntentId: params.purchaseIntentId,
        mode: params.mode,
      });

      return {
        sessionId: session.id,
        url: session.url!,
        expiresAt: new Date(session.expires_at * 1000),
      };
    } catch (error) {
      logger.error('Error creating Stripe checkout session', {
        error,
        params: { ...params, customerEmail: '***' },
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Retrieve a Stripe Checkout Session
   * 
   * @param sessionId - Stripe session ID
   * @returns Stripe checkout session
   */
  async getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['customer', 'payment_intent', 'subscription'],
      });

      return session;
    } catch (error) {
      logger.error('Error retrieving Stripe checkout session', {
        error,
        sessionId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Expire a Stripe Checkout Session
   * 
   * @param sessionId - Stripe session ID
   * @returns Expired session
   */
  async expireCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    try {
      const session = await this.stripe.checkout.sessions.expire(sessionId);

      logger.info('Stripe checkout session expired', {
        sessionId: session.id,
      });

      return session;
    } catch (error) {
      logger.error('Error expiring Stripe checkout session', {
        error,
        sessionId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a Stripe Product
   * 
   * @param params - Product parameters
   * @returns Created product
   */
  async createProduct(params: CreateProductParams): Promise<Stripe.Product> {
    try {
      const metadata: Record<string, string> = {
        ...params.metadata,
      };
      if (params.type) {
        metadata.type = params.type;
      }

      const product = await this.stripe.products.create({
        name: params.name,
        description: params.description,
        metadata,
      });

      logger.info('Stripe product created', {
        productId: product.id,
        name: product.name,
      });

      return product;
    } catch (error) {
      logger.error('Error creating Stripe product', {
        error,
        params,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Update a Stripe Product
   * 
   * @param productId - Stripe product ID
   * @param params - Update parameters
   * @returns Updated product
   */
  async updateProduct(
    productId: string,
    params: UpdateProductParams
  ): Promise<Stripe.Product> {
    try {
      const updateParams: Stripe.ProductUpdateParams = {};

      if (params.name !== undefined) updateParams.name = params.name;
      if (params.description !== undefined) updateParams.description = params.description;
      if (params.active !== undefined) updateParams.active = params.active;
      if (params.metadata !== undefined) updateParams.metadata = params.metadata;

      const product = await this.stripe.products.update(productId, updateParams);

      logger.info('Stripe product updated', {
        productId: product.id,
      });

      return product;
    } catch (error) {
      logger.error('Error updating Stripe product', {
        error,
        productId,
        params,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Archive a Stripe Product
   * 
   * @param productId - Stripe product ID
   * @returns Archived product
   */
  async archiveProduct(productId: string): Promise<Stripe.Product> {
    try {
      const product = await this.stripe.products.update(productId, {
        active: false,
      });

      logger.info('Stripe product archived', {
        productId: product.id,
      });

      return product;
    } catch (error) {
      logger.error('Error archiving Stripe product', {
        error,
        productId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a Stripe Price
   * 
   * @param params - Price parameters
   * @returns Created price
   */
  async createPrice(params: CreatePriceParams): Promise<Stripe.Price> {
    try {
      const priceParams: Stripe.PriceCreateParams = {
        product: params.productId,
        unit_amount: params.unitAmount,
        currency: params.currency.toLowerCase(),
        tax_behavior: 'exclusive',
      };

      if (params.recurring) {
        priceParams.recurring = {
          interval: params.recurring.interval,
        };
      }

      if (params.metadata) {
        priceParams.metadata = params.metadata;
      }

      const price = await this.stripe.prices.create(priceParams);

      logger.info('Stripe price created', {
        priceId: price.id,
        productId: params.productId,
        amount: params.unitAmount,
        currency: params.currency,
      });

      return price;
    } catch (error) {
      logger.error('Error creating Stripe price', {
        error,
        params,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Deactivate a Stripe Price
   * 
   * @param priceId - Stripe price ID
   * @returns Deactivated price
   */
  async deactivatePrice(priceId: string): Promise<Stripe.Price> {
    try {
      const price = await this.stripe.prices.update(priceId, {
        active: false,
      });

      logger.info('Stripe price deactivated', {
        priceId: price.id,
      });

      return price;
    } catch (error) {
      logger.error('Error deactivating Stripe price', {
        error,
        priceId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create or retrieve a Stripe Customer
   * 
   * @param email - Customer email
   * @param name - Customer name (optional)
   * @param metadata - Additional metadata
   * @returns Created or existing customer
   */
  async findOrCreateCustomer(
    email: string,
    name?: string,
    metadata?: Record<string, string>
  ): Promise<Stripe.Customer> {
    try {
      // Search for existing customer
      const customers = await this.stripe.customers.list({
        email,
        limit: 1,
      });

      if (customers.data.length > 0) {
        return customers.data[0];
      }

      // Create new customer
      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata,
      });

      logger.info('Stripe customer created', {
        customerId: customer.id,
      });

      return customer;
    } catch (error) {
      logger.error('Error finding or creating Stripe customer', {
        error,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a refund
   * 
   * @param params - Refund parameters
   * @returns Created refund
   */
  async createRefund(params: CreateRefundParams): Promise<Stripe.Refund> {
    try {
      const refundParams: Stripe.RefundCreateParams = {
        payment_intent: params.paymentIntentId,
        reason: params.reason,
      };

      if (params.amount) {
        refundParams.amount = params.amount;
      }

      const refund = await this.stripe.refunds.create(refundParams);

      logger.info('Stripe refund created', {
        refundId: refund.id,
        paymentIntentId: params.paymentIntentId,
        amount: refund.amount,
      });

      return refund;
    } catch (error) {
      logger.error('Error creating Stripe refund', {
        error,
        params,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Cancel a subscription
   * 
   * @param subscriptionId - Stripe subscription ID
   * @param immediately - Whether to cancel immediately or at period end
   * @returns Updated subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    immediately: boolean = false
  ): Promise<Stripe.Subscription> {
    try {
      let subscription: Stripe.Subscription;

      if (immediately) {
        subscription = await this.stripe.subscriptions.cancel(subscriptionId);
      } else {
        subscription = await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      }

      logger.info('Stripe subscription canceled', {
        subscriptionId: subscription.id,
        immediately,
      });

      return subscription;
    } catch (error) {
      logger.error('Error canceling Stripe subscription', {
        error,
        subscriptionId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Verify webhook signature
   * 
   * @param payload - Raw request body
   * @param signature - Stripe signature header
   * @returns Parsed Stripe event
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        config.stripe.webhookSecret
      );

      return event;
    } catch (error) {
      logger.error('Webhook signature verification failed', {
        error,
      });
      throw error;
    }
  }

  /**
   * Create a billing portal session for customer self-service
   * 
   * @param customerId - Stripe customer ID
   * @param returnUrl - URL to return to after portal session
   * @returns Billing portal session
   */
  async createBillingPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      logger.info('Stripe billing portal session created', {
        customerId,
      });

      return session;
    } catch (error) {
      logger.error('Error creating Stripe billing portal session', {
        error,
        customerId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Get subscription details
   * 
   * @param subscriptionId - Stripe subscription ID
   * @returns Subscription details
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      return subscription;
    } catch (error) {
      logger.error('Error retrieving Stripe subscription', {
        error,
        subscriptionId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Get payment intent details
   * 
   * @param paymentIntentId - Stripe payment intent ID
   * @returns Payment intent details
   */
  async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      logger.error('Error retrieving Stripe payment intent', {
        error,
        paymentIntentId,
      });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a PaymentIntent（方案2: Stripe Elements 用）
   *
   * @param params - PaymentIntent parameters
   * @returns Created PaymentIntent
   */
  async createPaymentIntent(
    params: CreatePaymentIntentParams
  ): Promise<Stripe.PaymentIntent> {
    try {
      const intentParams: Stripe.PaymentIntentCreateParams = {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        metadata: params.metadata,
        ...(params.customerId ? { customer: params.customerId } : {}),
        ...(params.receiptEmail ? { receipt_email: params.receiptEmail } : {}),
      };

      if (params.automaticPaymentMethods !== false) {
        intentParams.automatic_payment_methods = { enabled: true };
      }

      const paymentIntent = await this.stripe.paymentIntents.create(intentParams);

      logger.info('PaymentIntent 作成', {
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      });

      return paymentIntent;
    } catch (error) {
      logger.error('PaymentIntent 作成エラー', { error, params });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a SetupIntent（方案3: カード登録のみ、課金なし）
   *
   * @param params - SetupIntent parameters
   * @returns Created SetupIntent
   */
  async createSetupIntent(
    params: CreateSetupIntentParams
  ): Promise<Stripe.SetupIntent> {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: params.customerId,
        automatic_payment_methods: { enabled: true },
        metadata: params.metadata,
      });

      logger.info('SetupIntent 作成', {
        setupIntentId: setupIntent.id,
        customerId: params.customerId,
      });

      return setupIntent;
    } catch (error) {
      logger.error('SetupIntent 作成エラー', { error, params });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a Subscription（方案3: サブスクリプション作成）
   *
   * @param params - Subscription parameters
   * @returns Created Subscription
   */
  async createSubscription(
    params: CreateSubscriptionParams
  ): Promise<Stripe.Subscription> {
    try {
      const subParams: Stripe.SubscriptionCreateParams = {
        customer: params.customerId,
        items: [{ price: params.priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: params.metadata,
      };

      if (params.paymentMethodId) {
        subParams.default_payment_method = params.paymentMethodId;
      }

      if (params.trialPeriodDays) {
        subParams.trial_period_days = params.trialPeriodDays;
      }

      const subscription = await this.stripe.subscriptions.create(subParams);

      logger.info('Subscription 作成', {
        subscriptionId: subscription.id,
        customerId: params.customerId,
        priceId: params.priceId,
      });

      return subscription;
    } catch (error) {
      logger.error('Subscription 作成エラー', { error, params });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Update a Subscription（方案3: アップグレード/ダウングレード）
   *
   * @param subscriptionId - Stripe subscription ID
   * @param params - Update parameters
   * @returns Updated Subscription
   */
  async updateSubscription(
    subscriptionId: string,
    params: UpdateSubscriptionParams
  ): Promise<Stripe.Subscription> {
    try {
      // 現在のサブスクリプションを取得してアイテムIDを確認
      const current = await this.stripe.subscriptions.retrieve(subscriptionId);
      const itemId = current.items.data[0]?.id;

      if (!itemId) {
        throw new Error('Subscription has no items');
      }

      const subscription = await this.stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: params.newPriceId }],
        proration_behavior: params.prorationBehavior || 'create_prorations',
      });

      logger.info('Subscription 更新', {
        subscriptionId: subscription.id,
        newPriceId: params.newPriceId,
        prorationBehavior: params.prorationBehavior,
      });

      return subscription;
    } catch (error) {
      logger.error('Subscription 更新エラー', { error, subscriptionId, params });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Handle Stripe API errors
   * 
   * @param error - Error object
   * @returns Formatted error
   */

  private handleStripeError(error: unknown): Error {
    if (error instanceof Stripe.errors.StripeCardError) {
      return new Error(`Card error: ${error.message}`);
    } else if (error instanceof Stripe.errors.StripeRateLimitError) {
      return new Error('Rate limit exceeded. Please try again later.');
    } else if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      return new Error(`Invalid request: ${error.message}`);
    } else if (error instanceof Stripe.errors.StripeAPIError) {
      return new Error(`Stripe API error: ${error.message}`);
    } else if (error instanceof Stripe.errors.StripeConnectionError) {
      return new Error('Connection to Stripe failed. Please try again.');
    } else if (error instanceof Stripe.errors.StripeAuthenticationError) {
      return new Error('Stripe authentication failed. Check API keys.');
    }

    return error instanceof Error ? error : new Error('Unknown Stripe error');
  }
}

// Export singleton instance
export const stripeClient = new StripeClient();
