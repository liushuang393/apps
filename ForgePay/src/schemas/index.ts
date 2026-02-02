/**
 * Zod Validation Schemas
 * Centralized input validation for all API endpoints
 * 
 * Requirements: Input Validation Best Practice
 */

// @ts-ignore - zod will be installed via npm install
import { z } from 'zod';

// ============================================================
// COMMON SCHEMAS
// ============================================================

/**
 * UUID validation
 */
export const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * Email validation
 */
export const emailSchema = z.string().email('Invalid email format').toLowerCase();

/**
 * URL validation
 */
export const urlSchema = z.string().url('Invalid URL format');

/**
 * Pagination parameters
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Date range filter
 */
export const dateRangeSchema = z.object({
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
});

/**
 * Metadata schema (flexible key-value pairs)
 */
export const metadataSchema = z.record(z.string(), z.unknown()).optional();

/**
 * Currency codes (ISO 4217)
 */
export const currencySchema = z.enum(['usd', 'cny', 'jpy', 'eur']).transform((val: string) => val.toLowerCase());

/**
 * Product type
 */
export const productTypeSchema = z.enum(['one_time', 'subscription']);

/**
 * Subscription interval
 */
export const intervalSchema = z.enum(['month', 'year']);

// ============================================================
// CHECKOUT SCHEMAS
// ============================================================

export const createCheckoutSessionSchema = z.object({
  product_id: uuidSchema.describe('Product ID'),
  price_id: uuidSchema.describe('Price ID'),
  purchase_intent_id: z.string().min(1, 'Purchase intent ID is required').max(255),
  customer_email: emailSchema.optional(),
  success_url: urlSchema.describe('URL to redirect on success'),
  cancel_url: urlSchema.describe('URL to redirect on cancel'),
  currency: currencySchema.optional().default('usd'),
  metadata: metadataSchema,
  coupon_code: z.string().max(50).optional(),
});

export const getCheckoutSessionParams = z.object({
  id: uuidSchema,
});

// ============================================================
// ADMIN - PRODUCTS SCHEMAS
// ============================================================

export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(255),
  description: z.string().max(5000).optional(),
  type: productTypeSchema,
  metadata: metadataSchema,
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  active: z.boolean().optional(),
  metadata: metadataSchema,
});

export const listProductsQuery = z.object({
  active_only: z.enum(['true', 'false']).optional().transform((val: string | undefined) => val === 'true'),
});

export const productIdParams = z.object({
  id: uuidSchema,
});

// ============================================================
// ADMIN - PRICES SCHEMAS
// ============================================================

export const createPriceSchema = z.object({
  product_id: uuidSchema,
  amount: z.number().int().min(0, 'Amount must be non-negative'),
  currency: currencySchema,
  interval: intervalSchema.optional(),
  metadata: metadataSchema,
});

export const listPricesQuery = z.object({
  product_id: uuidSchema.optional(),
  currency: currencySchema.optional(),
  active_only: z.enum(['true', 'false']).optional().transform((val: string | undefined) => val === 'true'),
});

// ============================================================
// ADMIN - CUSTOMERS SCHEMAS
// ============================================================

export const customerIdParams = z.object({
  id: uuidSchema,
});

// ============================================================
// ADMIN - REFUNDS SCHEMAS
// ============================================================

export const createRefundSchema = z.object({
  payment_intent_id: z.string().min(1, 'Payment intent ID is required'),
  amount: z.number().int().positive().optional(),
  reason: z.enum([
    'duplicate',
    'fraudulent',
    'requested_by_customer',
  ]).optional().default('requested_by_customer'),
});

// ============================================================
// ADMIN - AUDIT LOGS SCHEMAS
// ============================================================

export const listAuditLogsQuery = z.object({
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  action: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================
// ADMIN - WEBHOOKS SCHEMAS
// ============================================================

export const webhookIdParams = z.object({
  id: uuidSchema,
});

export const listFailedWebhooksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

// ============================================================
// ADMIN - ENTITLEMENTS SCHEMAS
// ============================================================

export const listEntitlementsQuery = z.object({
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  customer_id: uuidSchema.optional(),
});

export const revokeEntitlementSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const entitlementIdParams = z.object({
  id: uuidSchema,
});

// ============================================================
// ENTITLEMENTS (PUBLIC) SCHEMAS
// ============================================================

export const verifyEntitlementSchema = z.object({
  purchase_intent_id: z.string().min(1, 'Purchase intent ID is required'),
  product_id: uuidSchema,
});

export const unlockContentSchema = z.object({
  unlock_token: z.string().min(1, 'Unlock token is required'),
});

// ============================================================
// PORTAL SCHEMAS
// ============================================================

export const requestMagicLinkSchema = z.object({
  email: emailSchema,
});

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// ============================================================
// CURRENCY SCHEMAS
// ============================================================

export const convertCurrencySchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  from: currencySchema,
  to: currencySchema,
});

export const formatAmountQuery = z.object({
  amount: z.coerce.number().int(),
  currency: currencySchema,
});

// ============================================================
// LEGAL TEMPLATES SCHEMAS
// ============================================================

export const legalTemplateTypeSchema = z.enum([
  'terms_of_service',
  'privacy_policy',
  'refund_policy',
]);

export const createLegalTemplateSchema = z.object({
  type: legalTemplateTypeSchema,
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(100000),
  content_html: z.string().max(200000).optional(),
  language: z.string().length(2).default('en'),
  effective_date: z.coerce.date().optional(),
  metadata: metadataSchema,
});

export const updateLegalTemplateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().min(1).max(100000).optional(),
  content_html: z.string().max(200000).optional(),
  effective_date: z.coerce.date().optional(),
  create_new_version: z.boolean().optional().default(false),
  metadata: metadataSchema,
});

export const activateLegalTemplateSchema = z.object({
  notify_customers: z.boolean().optional().default(false),
});

export const legalTemplateIdParams = z.object({
  id: uuidSchema,
});

export const legalTemplateTypeParams = z.object({
  type: legalTemplateTypeSchema,
});

export const legalTemplateDeveloperParams = z.object({
  developerId: uuidSchema,
  type: legalTemplateTypeSchema,
});

// ============================================================
// ONBOARDING SCHEMAS
// ============================================================

export const registerDeveloperSchema = z.object({
  email: emailSchema,
  test_mode: z.boolean().optional().default(true),
});

export const switchModeSchema = z.object({
  test_mode: z.boolean(),
});

export const setWebhookSecretSchema = z.object({
  webhook_secret: z.string().min(1, 'Webhook secret is required'),
});

export const connectStripeSchema = z.object({
  stripe_account_id: z.string().min(1).regex(/^acct_/, 'Invalid Stripe account ID format'),
});

// ============================================================
// INVOICES SCHEMAS
// ============================================================

export const listInvoicesQuery = z.object({
  status: z.enum(['draft', 'issued', 'paid', 'void', 'refunded']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const invoiceIdParams = z.object({
  id: uuidSchema,
});

export const customerInvoicesParams = z.object({
  customerId: uuidSchema,
});

// ============================================================
// GDPR SCHEMAS
// ============================================================

export const gdprRequestTypeSchema = z.enum([
  'data_export',
  'data_deletion',
  'data_rectification',
]);

export const gdprRequestStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

export const createGdprRequestSchema = z.object({
  customer_email: emailSchema,
  request_type: gdprRequestTypeSchema,
  reason: z.string().max(1000).optional(),
  data_categories: z.array(z.string()).optional(),
});

export const listGdprRequestsQuery = z.object({
  status: gdprRequestStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const gdprRequestIdParams = z.object({
  id: uuidSchema,
});

export const exportCustomerDataSchema = z.object({
  customer_email: emailSchema,
});

export const deleteCustomerDataSchema = z.object({
  customer_email: emailSchema,
  keep_transaction_records: z.boolean().optional().default(true),
});

// ============================================================
// MONITORING SCHEMAS
// ============================================================

export const recordMetricSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.number(),
  type: z.enum(['counter', 'gauge', 'histogram']).optional().default('gauge'),
  labels: z.record(z.string(), z.string()).optional(),
});

export const createAlertSchema = z.object({
  alert_name: z.string().min(1).max(100),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  message: z.string().min(1).max(1000),
  metric_name: z.string().max(100).optional(),
  threshold_value: z.number().optional(),
  actual_value: z.number().optional(),
  metadata: metadataSchema,
});

export const alertIdParams = z.object({
  id: uuidSchema,
});

export const acknowledgeAlertSchema = z.object({
  acknowledged_by: z.string().min(1).max(100),
});

export const getMetricQuery = z.object({
  start_time: z.coerce.date().optional(),
  end_time: z.coerce.date().optional(),
  interval: z.enum(['1m', '5m', '1h', '1d']).optional().default('1h'),
});

export const businessMetricsQuery = z.object({
  period: z.enum(['24h', '7d', '30d']).optional().default('24h'),
});

export const metricNameParams = z.object({
  name: z.string().min(1),
});

// ============================================================
// COUPON SCHEMAS
// ============================================================

export const createCouponSchema = z.object({
  code: z.string().min(3).max(50).toUpperCase(),
  name: z.string().min(1).max(255),
  discount_type: z.enum(['percentage', 'fixed_amount']),
  discount_value: z.number().positive(),
  currency: currencySchema.optional(),
  max_redemptions: z.number().int().positive().optional(),
  expires_at: z.coerce.date().optional(),
  min_purchase_amount: z.number().int().min(0).optional(),
  applies_to_products: z.array(uuidSchema).optional(),
  metadata: metadataSchema,
}).refine(
  (data: { discount_type: string; currency?: string; discount_value: number }) => {
    // For fixed_amount, currency is required
    if (data.discount_type === 'fixed_amount' && !data.currency) {
      return false;
    }
    // For percentage, value must be between 0 and 100
    if (data.discount_type === 'percentage' && (data.discount_value <= 0 || data.discount_value > 100)) {
      return false;
    }
    return true;
  },
  {
    message: 'Currency is required for fixed_amount discounts, and percentage must be between 0-100',
  }
);

export const updateCouponSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  active: z.boolean().optional(),
  max_redemptions: z.number().int().positive().optional(),
  expires_at: z.coerce.date().optional(),
  metadata: metadataSchema,
});

export const couponIdParams = z.object({
  id: uuidSchema,
});

export const couponCodeParams = z.object({
  code: z.string().min(3).max(50),
});

export const validateCouponSchema = z.object({
  code: z.string().min(3).max(50),
  product_id: uuidSchema.optional(),
  amount: z.number().int().positive().optional(),
});

export const listCouponsQuery = z.object({
  active_only: z.enum(['true', 'false']).optional().transform((val: string | undefined) => val === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================
// TYPE EXPORTS
// ============================================================

export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreatePriceInput = z.infer<typeof createPriceSchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
export type VerifyEntitlementInput = z.infer<typeof verifyEntitlementSchema>;
export type CreateLegalTemplateInput = z.infer<typeof createLegalTemplateSchema>;
export type UpdateLegalTemplateInput = z.infer<typeof updateLegalTemplateSchema>;
export type RegisterDeveloperInput = z.infer<typeof registerDeveloperSchema>;
export type CreateGdprRequestInput = z.infer<typeof createGdprRequestSchema>;
export type RecordMetricInput = z.infer<typeof recordMetricSchema>;
export type CreateAlertInput = z.infer<typeof createAlertSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
