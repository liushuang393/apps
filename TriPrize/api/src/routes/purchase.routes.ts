import { Router } from 'express';
import { z } from 'zod';
import purchaseController from '../controllers/purchase.controller';
import { authenticate } from '../middleware/auth.middleware';
import { loadUser } from '../middleware/role.middleware';
import { validateBody, validateParams, validateQuery, commonSchemas } from '../middleware/validation.middleware';
import { rateLimits } from '../middleware/rate-limit.middleware';
import { idempotencyMiddleware } from '../services/idempotency.service';

const router = Router();

/**
 * Validation schemas
 */

// Create purchase schema
// 目的: 購入作成時のバリデーション
// 注意点:
//   - quantity: 購入数量（1-10、デフォルト1）
//   - payment_method: 支払い方法（card/konbini）
//   - position_ids: 後方互換性のため残すが、非推奨
const createPurchaseSchema = z.object({
  campaign_id: commonSchemas.uuid,
  quantity: z.number().int().min(1).max(10).optional().default(1),
  position_ids: z.array(commonSchemas.uuid).min(1).max(10).optional(),
  payment_method: z.enum(['card', 'konbini']).optional(),
  idempotency_key: z.string().optional(),
});

// Purchase ID param schema
const purchaseIdSchema = z.object({
  purchaseId: commonSchemas.uuid,
});

// List purchases query schema
const listPurchasesSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

/**
 * Routes
 */

// All routes require authentication
router.use(authenticate);
router.use(loadUser);

// Get current user's purchases
router.get(
  '/me',
  validateQuery(listPurchasesSchema),
  purchaseController.getMyPurchases
);

// Get purchase by ID
router.get(
  '/:purchaseId',
  validateParams(purchaseIdSchema),
  purchaseController.getPurchase
);

// Create purchase (with rate limiting and idempotency)
router.post(
  '/',
  rateLimits.purchase,
  idempotencyMiddleware(24 * 60 * 60), // 24 hour idempotency window
  validateBody(createPurchaseSchema),
  purchaseController.createPurchase
);

// Cancel purchase
router.post(
  '/:purchaseId/cancel',
  validateParams(purchaseIdSchema),
  purchaseController.cancelPurchase
);

export default router;
