import { Router, Response } from 'express';
import {
  productRepository,
  priceRepository,
  customerRepository,
  entitlementRepository,
  webhookLogRepository,
  auditLogRepository,
} from '../repositories';
import { entitlementService } from '../services';
import { stripeClientFactory } from '../services/StripeClientFactory';
import { AuthenticatedRequest, apiKeyAuth, adminRateLimiter, validate } from '../middleware';
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuery,
  productIdParams,
  createPriceSchema,
  listPricesQuery,
  customerIdParams,
  createRefundSchema,
  listAuditLogsQuery,
  webhookIdParams,
  listFailedWebhooksQuery,
  listEntitlementsQuery,
  revokeEntitlementSchema,
  entitlementIdParams,
} from '../schemas';
import { logger } from '../utils/logger';
import { ProductType } from '../types';
import { notFound, internalError } from '../utils/errors';

const router = Router();

// Apply authentication and rate limiting to all admin routes
router.use(apiKeyAuth);
router.use(adminRateLimiter);

// ============================================================
// PRODUCTS ENDPOINTS
// ============================================================

/**
 * POST /api/v1/admin/products
 * Create a new product
 *
 * Requirements: 5.2
 */
router.post('/products', validate(createProductSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, type, metadata } = req.body;

    // 開発者ごとの Stripe クライアントを取得（マルチテナント対応）
    const devStripeClient = stripeClientFactory.getClient(
      req.developer!.stripeSecretKeyEnc,
      req.developer!.id
    );

    // Create product in Stripe
    const stripeProduct = await devStripeClient.createProduct({
      name,
      description,
      type: type as 'one_time' | 'subscription',
      metadata: {
        ...metadata,
        developer_id: req.developer!.id,
      },
    });

    // Create product in database
    const product = await productRepository.create({
      developerId: req.developer!.id,
      stripeProductId: stripeProduct.id,
      name,
      description,
      type: type as ProductType,
      metadata,
    });

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'product.created',
      resourceType: 'product',
      resourceId: product.id,
      changes: { name, type },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Product created via admin API', {
      productId: product.id,
      developerId: req.developer!.id,
    });

    res.status(201).json({
      id: product.id,
      stripe_product_id: product.stripeProductId,
      name: product.name,
      description: product.description,
      type: product.type,
      active: product.active,
      metadata: product.metadata,
      created_at: product.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error creating product', { error });
    internalError(res, 'Failed to create product');
  }
});

/**
 * GET /api/v1/admin/products
 * List all products for the developer
 *
 * Requirements: 5.2
 */
router.get('/products', validate(listProductsQuery, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { active_only } = req.query as { active_only?: boolean };

    const products = await productRepository.findByDeveloperId(
      req.developer!.id,
      active_only === true
    );

    res.json({
      data: products.map((p) => ({
        id: p.id,
        stripe_product_id: p.stripeProductId,
        name: p.name,
        description: p.description,
        type: p.type,
        active: p.active,
        metadata: p.metadata,
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error listing products', { error });
    internalError(res, 'Failed to list products');
  }
});

/**
 * GET /api/v1/admin/products/:id
 * Get a specific product
 *
 * Requirements: 5.2
 */
router.get('/products/:id', validate(productIdParams, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const product = await productRepository.findById(req.params.id);

    if (!product) {
      notFound(res, 'Product not found');
      return;
    }

    // Verify ownership
    if (product.developerId !== req.developer!.id) {
      notFound(res, 'Product not found');
      return;
    }

    // Get associated prices
    const prices = await priceRepository.findByProductId(product.id);

    res.json({
      id: product.id,
      stripe_product_id: product.stripeProductId,
      name: product.name,
      description: product.description,
      type: product.type,
      active: product.active,
      metadata: product.metadata,
      created_at: product.createdAt.toISOString(),
      updated_at: product.updatedAt.toISOString(),
      prices: prices.map((p) => ({
        id: p.id,
        stripe_price_id: p.stripePriceId,
        amount: p.amount,
        currency: p.currency,
        interval: p.interval,
        active: p.active,
      })),
    });
  } catch (error) {
    logger.error('Error retrieving product', { error });
    internalError(res, 'Failed to retrieve product');
  }
});

/**
 * PUT /api/v1/admin/products/:id
 * Update a product
 *
 * Requirements: 5.2
 */
router.put('/products/:id', validate(productIdParams, 'params'), validate(updateProductSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, active, metadata } = req.body;

    const product = await productRepository.findById(req.params.id);

    if (!product) {
      notFound(res, 'Product not found');
      return;
    }

    // Verify ownership
    if (product.developerId !== req.developer!.id) {
      notFound(res, 'Product not found');
      return;
    }

    // 開発者ごとの Stripe クライアントを取得
    const devStripeClient = stripeClientFactory.getClient(
      req.developer!.stripeSecretKeyEnc,
      req.developer!.id
    );

    // Update product in Stripe
    await devStripeClient.updateProduct(product.stripeProductId, {
      name: name !== undefined ? name : undefined,
      description: description !== undefined ? description : undefined,
      active: active !== undefined ? active : undefined,
      metadata: metadata !== undefined ? metadata : undefined,
    });

    // Update product in database
    const updated = await productRepository.update(req.params.id, {
      name,
      description,
      active,
      metadata,
    });

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'product.updated',
      resourceType: 'product',
      resourceId: product.id,
      changes: { name, description, active, metadata },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Product updated via admin API', {
      productId: product.id,
      developerId: req.developer!.id,
    });

    res.json({
      id: updated!.id,
      stripe_product_id: updated!.stripeProductId,
      name: updated!.name,
      description: updated!.description,
      type: updated!.type,
      active: updated!.active,
      metadata: updated!.metadata,
      created_at: updated!.createdAt.toISOString(),
      updated_at: updated!.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error updating product', { error });
    internalError(res, 'Failed to update product');
  }
});

/**
 * DELETE /api/v1/admin/products/:id
 * Archive a product (soft delete)
 *
 * Requirements: 5.2
 */
router.delete('/products/:id', validate(productIdParams, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const product = await productRepository.findById(req.params.id);

    if (!product) {
      notFound(res, 'Product not found');
      return;
    }

    // Verify ownership
    if (product.developerId !== req.developer!.id) {
      notFound(res, 'Product not found');
      return;
    }

    // 開発者ごとの Stripe クライアントを取得
    const devStripeClient = stripeClientFactory.getClient(
      req.developer!.stripeSecretKeyEnc,
      req.developer!.id
    );

    // Archive product in Stripe
    await devStripeClient.archiveProduct(product.stripeProductId);

    // Archive product in database
    await productRepository.archive(req.params.id);

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'product.archived',
      resourceType: 'product',
      resourceId: product.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Product archived via admin API', {
      productId: product.id,
      developerId: req.developer!.id,
    });

    res.status(204).send();
  } catch (error) {
    logger.error('Error archiving product', { error });
    internalError(res, 'Failed to archive product');
  }
});

// ============================================================
// PRICES ENDPOINTS
// ============================================================

/**
 * POST /api/v1/admin/prices
 * Create a new price for a product
 *
 * Requirements: 5.3, 6.1
 */
router.post('/prices', validate(createPriceSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { product_id, amount, currency, interval, metadata } = req.body;

    // Verify product exists and belongs to developer
    const product = await productRepository.findById(product_id);
    if (!product || product.developerId !== req.developer!.id) {
      notFound(res, 'Product not found');
      return;
    }

    // Validate interval for subscription products
    if (product.type === 'subscription' && !interval) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: 'The interval parameter is required for subscription products',
          param: 'interval',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    // 開発者ごとの Stripe クライアントを取得
    const devStripeClient = stripeClientFactory.getClient(
      req.developer!.stripeSecretKeyEnc,
      req.developer!.id
    );

    // Create price in Stripe
    const stripePrice = await devStripeClient.createPrice({
      productId: product.stripeProductId,
      unitAmount: amount,
      currency: currency.toLowerCase(),
      recurring: interval ? { interval: interval as 'month' | 'year' } : undefined,
      metadata,
    });

    // Create price in database
    const price = await priceRepository.create({
      productId: product.id,
      stripePriceId: stripePrice.id,
      amount,
      currency: currency.toLowerCase(),
      interval: interval || null,
    });

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'price.created',
      resourceType: 'price',
      resourceId: price.id,
      changes: { product_id, amount, currency, interval },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Price created via admin API', {
      priceId: price.id,
      productId: product.id,
      developerId: req.developer!.id,
    });

    res.status(201).json({
      id: price.id,
      stripe_price_id: price.stripePriceId,
      product_id: price.productId,
      amount: price.amount,
      currency: price.currency,
      interval: price.interval,
      active: price.active,
      created_at: price.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error creating price', { error });
    internalError(res, 'Failed to create price');
  }
});

/**
 * GET /api/v1/admin/prices
 * List all prices for the developer
 */
router.get('/prices', validate(listPricesQuery, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { product_id, currency, active_only } = req.query as {
      product_id?: string;
      currency?: string;
      active_only?: boolean;
    };

    let prices;

    if (product_id) {
      // Verify product ownership
      const product = await productRepository.findById(product_id as string);
      if (!product || product.developerId !== req.developer!.id) {
        notFound(res, 'Product not found');
        return;
      }

      if (currency) {
        prices = await priceRepository.findByProductIdAndCurrency(
          product_id as string,
          currency as string
        );
      } else {
        prices = await priceRepository.findByProductId(product_id as string);
      }
    } else {
      // Get all products for developer, then get all prices
      const products = await productRepository.findByDeveloperId(req.developer!.id);
      const productIds = products.map((p) => p.id);

      const allPrices = await Promise.all(
        productIds.map((id) => priceRepository.findByProductId(id))
      );
      prices = allPrices.flat();
    }

    // Filter by active if requested
    if (active_only === true) {
      prices = prices.filter((p) => p.active);
    }

    res.json({
      data: prices.map((p) => ({
        id: p.id,
        stripe_price_id: p.stripePriceId,
        product_id: p.productId,
        amount: p.amount,
        currency: p.currency,
        interval: p.interval,
        active: p.active,
        created_at: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error listing prices', { error });
    internalError(res, 'Failed to list prices');
  }
});

// ============================================================
// CUSTOMERS ENDPOINTS
// ============================================================

/**
 * GET /api/v1/admin/customers
 * List all customers for the developer
 *
 * Requirements: 5.5
 */
router.get('/customers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customers = await customerRepository.findByDeveloperId(req.developer!.id);

    res.json({
      data: customers.map((c) => ({
        id: c.id,
        stripe_customer_id: c.stripeCustomerId,
        email: c.email,
        name: c.name,
        metadata: c.metadata,
        created_at: c.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error listing customers', { error });
    internalError(res, 'Failed to list customers');
  }
});

/**
 * GET /api/v1/admin/customers/:id
 * Get a specific customer with payment history and entitlements
 *
 * Requirements: 5.5
 */
router.get('/customers/:id', validate(customerIdParams, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await customerRepository.findById(req.params.id);

    if (!customer) {
      notFound(res, 'Customer not found');
      return;
    }

    // Verify ownership
    if (customer.developerId !== req.developer!.id) {
      notFound(res, 'Customer not found');
      return;
    }

    // Get entitlements
    const entitlements = await entitlementRepository.findByCustomerId(customer.id);

    res.json({
      id: customer.id,
      stripe_customer_id: customer.stripeCustomerId,
      email: customer.email,
      name: customer.name,
      metadata: customer.metadata,
      created_at: customer.createdAt.toISOString(),
      entitlements: entitlements.map((e) => ({
        id: e.id,
        product_id: e.productId,
        status: e.status,
        expires_at: e.expiresAt?.toISOString() || null,
        created_at: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error retrieving customer', { error });
    internalError(res, 'Failed to retrieve customer');
  }
});

// ============================================================
// REFUNDS ENDPOINTS
// ============================================================

/**
 * POST /api/v1/admin/refunds
 * Process a refund
 *
 * Requirements: 5.6, 5.7
 */
router.post('/refunds', validate(createRefundSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { payment_intent_id, amount, reason } = req.body;

    // 開発者ごとの Stripe クライアントを取得
    const devStripeClient = stripeClientFactory.getClient(
      req.developer!.stripeSecretKeyEnc,
      req.developer!.id
    );

    // Get payment intent to verify ownership and get amount
    const paymentIntent = await devStripeClient.getPaymentIntent(payment_intent_id);
    if (!paymentIntent) {
      notFound(res, 'Payment not found');
      return;
    }

    // Process refund via Stripe
    const refund = await devStripeClient.createRefund({
      paymentIntentId: payment_intent_id,
      amount: amount, // If undefined, full refund
      reason: reason || 'requested_by_customer',
    });

    // Find and revoke entitlement if full refund
    const entitlement = await entitlementRepository.findByPaymentId(payment_intent_id);
    if (entitlement) {
      const isFullRefund = !amount || amount >= paymentIntent.amount;
      if (isFullRefund) {
        await entitlementService.revokeEntitlement(
          entitlement.id,
          `Full refund processed: ${reason || 'requested_by_customer'}`
        );
      }
    }

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'refund.created',
      resourceType: 'refund',
      resourceId: refund.id,
      changes: { payment_intent_id, amount, reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Refund processed via admin API', {
      refundId: refund.id,
      paymentIntentId: payment_intent_id,
      amount: refund.amount,
      developerId: req.developer!.id,
    });

    res.status(201).json({
      id: refund.id,
      payment_intent_id: payment_intent_id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      created_at: new Date(refund.created * 1000).toISOString(),
    });
  } catch (error) {
    logger.error('Error processing refund', { error });

    if (error instanceof Error && error.message.includes('charge')) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: error.message,
          type: 'invalid_request_error',
        },
      });
      return;
    }

    internalError(res, 'Failed to process refund');
  }
});

// ============================================================
// AUDIT LOGS ENDPOINTS
// ============================================================

/**
 * GET /api/v1/admin/audit-logs
 * List audit logs with filtering
 *
 * Requirements: 14.5
 */
router.get('/audit-logs', validate(listAuditLogsQuery, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Query params are validated and transformed by Zod
    const queryParams = req.query as unknown as {
      start_date?: Date;
      end_date?: Date;
      action?: string;
      resource_type?: string;
      resource_id?: string;
      limit: number;
      offset: number;
    };
    const { start_date, end_date, action, resource_type, resource_id, limit, offset } = queryParams;

    const filter: any = {
      developerId: req.developer!.id,
    };

    if (start_date) {
      filter.startDate = start_date;
    }

    if (end_date) {
      filter.endDate = end_date;
    }

    if (action) {
      filter.action = action;
    }

    if (resource_type) {
      filter.resourceType = resource_type;
    }

    if (resource_id) {
      filter.resourceId = resource_id;
    }

    const [logs, total] = await Promise.all([
      auditLogRepository.find(filter, limit, offset),
      auditLogRepository.count(filter),
    ]);

    res.json({
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        resource_type: log.resourceType,
        resource_id: log.resourceId,
        changes: log.changes,
        ip_address: log.ipAddress,
        user_agent: log.userAgent,
        created_at: log.createdAt.toISOString(),
      })),
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error listing audit logs', { error });
    internalError(res, 'Failed to list audit logs');
  }
});

// ============================================================
// WEBHOOKS ENDPOINTS
// ============================================================

/**
 * GET /api/v1/admin/webhooks/failed
 * List failed webhooks (DLQ)
 *
 * Requirements: 5.8
 */
router.get('/webhooks/failed', validate(listFailedWebhooksQuery, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit } = req.query as unknown as { limit: number };

    const webhooks = await webhookLogRepository.findInDLQ(limit);

    res.json({
      data: webhooks.map((w) => ({
        id: w.id,
        stripe_event_id: w.stripeEventId,
        event_type: w.eventType,
        status: w.status,
        attempts: w.attempts,
        last_attempt_at: w.lastAttemptAt?.toISOString() || null,
        error_message: w.errorMessage,
        created_at: w.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error listing failed webhooks', { error });
    internalError(res, 'Failed to list webhooks');
  }
});

/**
 * POST /api/v1/admin/webhooks/:id/retry
 * Manually retry a failed webhook
 *
 * Requirements: 5.8
 */
router.post('/webhooks/:id/retry', validate(webhookIdParams, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhook = await webhookLogRepository.findById(req.params.id);

    if (!webhook) {
      notFound(res, 'Webhook not found');
      return;
    }

    // Import webhook processor and retry
    const { webhookProcessor } = await import('../services');
    const result = await webhookProcessor.retryFailedWebhook(webhook.id);

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'webhook.retried',
      resourceType: 'webhook',
      resourceId: webhook.id,
      changes: { result: result.success ? 'success' : 'failed' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Webhook retry requested via admin API', {
      webhookId: webhook.id,
      success: result.success,
      developerId: req.developer!.id,
    });

    res.json({
      id: webhook.id,
      success: result.success,
      error: result.error,
    });
  } catch (error) {
    logger.error('Error retrying webhook', { error });
    internalError(res, 'Failed to retry webhook');
  }
});

/**
 * GET /api/v1/admin/webhooks/:id
 * Get a specific webhook log
 */
router.get('/webhooks/:id', validate(webhookIdParams, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhook = await webhookLogRepository.findById(req.params.id);

    if (!webhook) {
      notFound(res, 'Webhook not found');
      return;
    }

    res.json({
      id: webhook.id,
      stripe_event_id: webhook.stripeEventId,
      event_type: webhook.eventType,
      payload: webhook.payload,
      status: webhook.status,
      attempts: webhook.attempts,
      last_attempt_at: webhook.lastAttemptAt?.toISOString() || null,
      error_message: webhook.errorMessage,
      created_at: webhook.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error retrieving webhook', { error });
    internalError(res, 'Failed to retrieve webhook');
  }
});

// ============================================================
// ENTITLEMENTS ENDPOINTS (Admin)
// ============================================================

/**
 * GET /api/v1/admin/entitlements
 * List all entitlements for the developer
 */
router.get('/entitlements', validate(listEntitlementsQuery, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, customer_id } = req.query as {
      status?: 'active' | 'expired' | 'revoked';
      customer_id?: string;
    };

    let entitlements;

    if (customer_id) {
      // Verify customer ownership
      const customer = await customerRepository.findById(customer_id as string);
      if (!customer || customer.developerId !== req.developer!.id) {
        notFound(res, 'Customer not found');
        return;
      }

      if (status) {
        entitlements = await entitlementRepository.findByCustomerId(customer_id as string);
        entitlements = entitlements.filter((e) => e.status === status);
      } else {
        entitlements = await entitlementRepository.findByCustomerId(customer_id as string);
      }
    } else if (status) {
      entitlements = await entitlementRepository.findByStatus(status as any);
    } else {
      // Get all customers for developer, then get all entitlements
      const customers = await customerRepository.findByDeveloperId(req.developer!.id);
      const customerIds = customers.map((c) => c.id);

      const allEntitlements = await Promise.all(
        customerIds.map((id) => entitlementRepository.findByCustomerId(id))
      );
      entitlements = allEntitlements.flat();
    }

    res.json({
      data: entitlements.map((e) => ({
        id: e.id,
        customer_id: e.customerId,
        product_id: e.productId,
        purchase_intent_id: e.purchaseIntentId,
        payment_id: e.paymentId,
        subscription_id: e.subscriptionId,
        status: e.status,
        expires_at: e.expiresAt?.toISOString() || null,
        revoked_reason: e.revokedReason,
        created_at: e.createdAt.toISOString(),
        updated_at: e.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Error listing entitlements', { error });
    internalError(res, 'Failed to list entitlements');
  }
});

/**
 * POST /api/v1/admin/entitlements/:id/revoke
 * Manually revoke an entitlement
 */
router.post(
  '/entitlements/:id/revoke',
  validate(entitlementIdParams, 'params'),
  validate(revokeEntitlementSchema),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason } = req.body;

    const entitlement = await entitlementRepository.findById(req.params.id);

    if (!entitlement) {
      notFound(res, 'Entitlement not found');
      return;
    }

    // Verify ownership via customer
    const customer = await customerRepository.findById(entitlement.customerId);
    if (!customer || customer.developerId !== req.developer!.id) {
      notFound(res, 'Entitlement not found');
      return;
    }

    const updated = await entitlementService.revokeEntitlement(
      entitlement.id,
      reason || 'Manually revoked by admin'
    );

    // Log audit entry
    await auditLogRepository.create({
      developerId: req.developer!.id,
      action: 'entitlement.revoked',
      resourceType: 'entitlement',
      resourceId: entitlement.id,
      changes: { reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Entitlement revoked via admin API', {
      entitlementId: entitlement.id,
      developerId: req.developer!.id,
    });

    res.json({
      id: updated!.id,
      status: updated!.status,
      revoked_reason: updated!.revokedReason,
      updated_at: updated!.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error revoking entitlement', { error });
    internalError(res, 'Failed to revoke entitlement');
  }
});

export default router;
