import { z } from 'zod';

// ============================================================
// 共通スキーマ
// ============================================================

export const uuidSchema = z.string().uuid('Invalid UUID format');
export const emailSchema = z.string().email('Invalid email format').toLowerCase();
export const urlSchema = z.string().url('Invalid URL format');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** 通貨コード（ISO 4217） */
export const currencySchema = z
  .enum(['usd', 'cny', 'jpy', 'eur', 'gbp', 'aud', 'cad', 'krw'])
  .transform((val) => val.toLowerCase());

export const productTypeSchema = z.enum(['one_time', 'subscription']);
export const intervalSchema = z.enum(['month', 'year']);
export const metadataSchema = z.record(z.string(), z.unknown()).optional();

// ============================================================
// Checkout
// ============================================================

export const createCheckoutSessionSchema = z.object({
  product_id: uuidSchema,
  price_id: uuidSchema,
  purchase_intent_id: z.string().min(1).max(255),
  customer_email: emailSchema.optional(),
  success_url: urlSchema,
  cancel_url: urlSchema,
  currency: currencySchema.optional().default('usd'),
  metadata: metadataSchema,
  coupon_code: z.string().max(50).optional(),
});

export const getCheckoutSessionParams = z.object({
  id: uuidSchema,
});

// ============================================================
// 商品・価格
// ============================================================

export const createProductSchema = z.object({
  name: z.string().min(1).max(255),
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
  active_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export const productIdParams = z.object({ id: uuidSchema });

export const createPriceSchema = z.object({
  product_id: uuidSchema,
  amount: z.number().int().min(0),
  currency: currencySchema,
  interval: intervalSchema.optional(),
  metadata: metadataSchema,
});

export const listPricesQuery = z.object({
  product_id: uuidSchema.optional(),
  currency: currencySchema.optional(),
  active_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

// ============================================================
// 顧客
// ============================================================

export const customerIdParams = z.object({ id: uuidSchema });

// ============================================================
// 返金
// ============================================================

export const createRefundSchema = z.object({
  payment_intent_id: z.string().min(1),
  amount: z.number().int().positive().optional(),
  reason: z
    .enum(['duplicate', 'fraudulent', 'requested_by_customer'])
    .optional()
    .default('requested_by_customer'),
});

// ============================================================
// 監査ログ
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
// Webhook
// ============================================================

export const webhookIdParams = z.object({ id: uuidSchema });

export const listFailedWebhooksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

// ============================================================
// Entitlement
// ============================================================

export const listEntitlementsQuery = z.object({
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  customer_id: uuidSchema.optional(),
});

export const revokeEntitlementSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const entitlementIdParams = z.object({ id: uuidSchema });

export const verifyEntitlementSchema = z.object({
  purchase_intent_id: z.string().min(1),
  product_id: uuidSchema,
});

export const unlockContentSchema = z.object({
  unlock_token: z.string().min(1),
});

// ============================================================
// オンボーディング
// ============================================================

export const registerDeveloperSchema = z.object({
  email: emailSchema,
  test_mode: z.boolean().optional().default(true),
});

export const switchModeSchema = z.object({
  test_mode: z.boolean(),
});

export const setWebhookSecretSchema = z.object({
  webhook_secret: z.string().min(1),
});

export const connectStripeSchema = z.object({
  stripe_account_id: z
    .string()
    .min(1)
    .regex(/^acct_/, 'Invalid Stripe account ID format'),
});

// ============================================================
// 型エクスポート
// ============================================================

export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreatePriceInput = z.infer<typeof createPriceSchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
export type VerifyEntitlementInput = z.infer<typeof verifyEntitlementSchema>;
export type RegisterDeveloperInput = z.infer<typeof registerDeveloperSchema>;
