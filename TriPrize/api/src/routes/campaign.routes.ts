import { Router } from 'express';
import { z } from 'zod';
import campaignController from '../controllers/campaign.controller';
import { authenticate } from '../middleware/auth.middleware';
import { loadUser, requireAdmin } from '../middleware/role.middleware';
import { validateBody, validateParams, validateQuery, commonSchemas } from '../middleware/validation.middleware';
import { rateLimits } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * Validation schemas
 */

// Create campaign schema
const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  base_length: z.number().int().min(3).max(50),
  layer_prices: z.record(z.string(), z.number().int().min(100)),
  profit_margin_percent: z.number().min(0).max(100),
  purchase_limit: z.number().int().positive().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  prizes: z.array(
    z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(500).optional(),
      rank: z.number().int().positive(),
      quantity: z.number().int().positive(),
      value: z.number().int().min(0), // Prize value in yen (required)
      image_url: z.string().url().optional(),
    })
  ).min(1),
});

// Update campaign schema
const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  layer_prices: z.record(z.string(), z.number().int().min(100)).optional(),
  profit_margin_percent: z.number().min(0).max(100).optional(),
  purchase_limit: z.number().int().positive().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  status: z.enum(['draft', 'published', 'closed', 'drawn']).optional(),
});

// Campaign ID param schema
const campaignIdSchema = z.object({
  campaignId: commonSchemas.uuid,
});

// List campaigns query schema
const listCampaignsSchema = z.object({
  status: z.enum(['draft', 'published', 'closed', 'drawn']).optional(),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

// Positions query schema
// 目的: 位置情報取得のクエリパラメータを検証
const positionsQuerySchema = z.object({
  status: z.enum(['available', 'reserved', 'sold']).optional(),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 100)),
});

/**
 * Routes
 */

// List campaigns (public)
router.get(
  '/',
  validateQuery(listCampaignsSchema),
  campaignController.listCampaigns
);

// Get campaign by ID (public)
router.get(
  '/:campaignId',
  validateParams(campaignIdSchema),
  campaignController.getCampaign
);

// Get campaign statistics (public)
router.get(
  '/:campaignId/stats',
  validateParams(campaignIdSchema),
  campaignController.getCampaignStats
);

// Get campaign positions (public)
// 目的: キャンペーンの位置情報を取得する
router.get(
  '/:campaignId/positions',
  validateParams(campaignIdSchema),
  validateQuery(positionsQuerySchema),
  campaignController.getPositions
);

// Create campaign (admin only)
router.post(
  '/',
  authenticate,
  loadUser,
  requireAdmin,
  rateLimits.campaignCreate,
  validateBody(createCampaignSchema),
  campaignController.createCampaign
);

// Update campaign (admin only)
router.patch(
  '/:campaignId',
  authenticate,
  loadUser,
  requireAdmin,
  validateParams(campaignIdSchema),
  validateBody(updateCampaignSchema),
  campaignController.updateCampaign
);

// Delete campaign (admin only)
router.delete(
  '/:campaignId',
  authenticate,
  loadUser,
  requireAdmin,
  validateParams(campaignIdSchema),
  campaignController.deleteCampaign
);

// Publish campaign (admin only)
router.post(
  '/:campaignId/publish',
  authenticate,
  loadUser,
  requireAdmin,
  validateParams(campaignIdSchema),
  campaignController.publishCampaign
);

// Close campaign (admin only)
router.post(
  '/:campaignId/close',
  authenticate,
  loadUser,
  requireAdmin,
  validateParams(campaignIdSchema),
  campaignController.closeCampaign
);

export default router;
