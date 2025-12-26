import { Router } from 'express';
import { z } from 'zod';
import lotteryController from '../controllers/lottery.controller';
import { authenticate } from '../middleware/auth.middleware';
import { loadUser, requireAdmin } from '../middleware/role.middleware';
import { validateParams, commonSchemas } from '../middleware/validation.middleware';

const router = Router();

/**
 * Validation schemas
 */

// Campaign ID param schema
const campaignIdSchema = z.object({
  campaignId: commonSchemas.uuid,
});

/**
 * Routes
 * 目的: 抽選結果APIのルーティング
 * 注意点: 管理者は全員の結果を見れる、顧客は自分の結果のみ見れる
 */

// All routes require authentication
router.use(authenticate);
router.use(loadUser);

// Get campaign lottery results
// 管理者: 全当選者の詳細情報を返す
// 顧客: 自分の当選情報のみ返す（他人の個人情報は隠す）
router.get(
  '/results/:campaignId',
  validateParams(campaignIdSchema),
  lotteryController.getCampaignResults
);

// Get user's lottery results
router.get(
  '/results/me',
  lotteryController.getMyResults
);

// Check if user won in a campaign
router.get(
  '/check/:campaignId',
  validateParams(campaignIdSchema),
  lotteryController.checkMyWin
);

// Draw lottery (admin only)
router.post(
  '/draw/:campaignId',
  requireAdmin,
  validateParams(campaignIdSchema),
  lotteryController.drawLottery
);

export default router;
