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
const createPurchaseSchema = z.object({
  campaign_id: commonSchemas.uuid,
  position_ids: z.array(commonSchemas.uuid).min(1).max(10),
  payment_method: z.enum(['card', 'konbini']),
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
