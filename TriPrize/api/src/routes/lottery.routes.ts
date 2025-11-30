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
 */

// Get campaign lottery results (public)
router.get(
  '/results/:campaignId',
  validateParams(campaignIdSchema),
  lotteryController.getCampaignResults
);

// All other routes require authentication
router.use(authenticate);
router.use(loadUser);

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
