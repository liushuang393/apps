import { Router } from 'express';
import { z } from 'zod';
import campaignController from '../controllers/campaign.controller';
import lotteryController from '../controllers/lottery.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';
import { loadUser, optionalLoadUser, requireAdmin } from '../middleware/role.middleware';
import { validateBody, validateParams, validateQuery, commonSchemas } from '../middleware/validation.middleware';
import { rateLimits } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * Validation schemas
 */

// Create campaign schema
// null値も許容するために .nullable().optional() を使用
// 目的: キャンペーン作成時の入力バリデーション
// 注意点: manual_ticket_price が設定されている場合、自動計算値より優先される
const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  base_length: z.number().int().min(3).max(50),
  layer_prices: z.record(z.string(), z.number().int().min(100)),
  layer_names: z.record(z.string(), z.string().min(1).max(100)).optional(), // 各層の賞品名
  profit_margin_percent: z.number().min(0).max(100),
  purchase_limit: z.number().int().positive().nullable().optional(),
  start_date: z.string().datetime().nullable().optional(),
  end_date: z.string().datetime().nullable().optional(),
  manual_ticket_price: z.number().int().min(100).nullable().optional(), // 手動設定の抽選価格（円）
  // 賞品は任意（後から追加可能）
  prizes: z.array(
    z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(500).nullable().optional(),
      rank: z.number().int().positive(),
      quantity: z.number().int().positive(),
      value: z.number().int().min(0), // Prize value in yen (required)
      image_url: z.string().url().nullable().optional(),
    })
  ).optional().default([]),
});

// Update campaign schema
// 目的: キャンペーン更新時の入力バリデーション
// 注意点: manual_ticket_price を null に設定すると自動計算に戻る
const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  layer_prices: z.record(z.string(), z.number().int().min(100)).optional(),
  profit_margin_percent: z.number().min(0).max(100).optional(),
  purchase_limit: z.number().int().positive().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  status: z.enum(['draft', 'published', 'closed', 'drawn']).optional(),
  manual_ticket_price: z.number().int().min(100).nullable().optional(), // 手動設定の抽選価格（円）- null は自動計算に戻す
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

// List campaigns (public, but filters draft for non-admin)
// 目的: キャンペーン一覧を取得（公開API）
// 注意点: 管理者はすべてのキャンペーン、一般ユーザーはdraft以外を取得
router.get(
  '/',
  optionalAuthenticate,
  optionalLoadUser,
  validateQuery(listCampaignsSchema),
  campaignController.listCampaigns
);

// Get campaign by ID (public, but draft only for admin)
// 目的: キャンペーン詳細を取得（公開API）
// 注意点: draftステータスは管理者のみ閲覧可能
router.get(
  '/:campaignId',
  optionalAuthenticate,
  optionalLoadUser,
  validateParams(campaignIdSchema),
  campaignController.getCampaign
);

// Get campaign statistics (public, but draft only for admin)
router.get(
  '/:campaignId/stats',
  optionalAuthenticate,
  optionalLoadUser,
  validateParams(campaignIdSchema),
  campaignController.getCampaignStats
);

// Get campaign positions (public, but draft only for admin)
// 目的: キャンペーンの位置情報を取得する
router.get(
  '/:campaignId/positions',
  optionalAuthenticate,
  optionalLoadUser,
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

// Draw lottery for campaign (admin only)
router.post(
  '/:campaignId/lottery',
  authenticate,
  loadUser,
  requireAdmin,
  validateParams(campaignIdSchema),
  lotteryController.drawLottery
);

export default router;
