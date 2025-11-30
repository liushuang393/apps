import { Response } from 'express';
import { AuthorizedRequest } from '../middleware/role.middleware';
import lotteryService from '../services/lottery.service';
import { errors, asyncHandler } from '../middleware/error.middleware';
// import logger from '../utils/logger.util';

/**
 * Lottery controller
 */
export class LotteryController {
  /**
   * Draw lottery for a campaign (admin only)
   * POST /api/lottery/draw/:campaignId
   */
  drawLottery = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;

    const result = await lotteryService.drawLottery(campaignId);

    res.json({
      success: true,
      data: result,
      message: 'Lottery drawn successfully',
    });
  });

  /**
   * Get campaign lottery results
   * GET /api/lottery/results/:campaignId
   */
  getCampaignResults = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const { campaignId } = req.params;

    const results = await lotteryService.getCampaignResults(campaignId);

    res.json({
      success: true,
      data: results,
    });
  });

  /**
   * Get user's lottery results
   * GET /api/lottery/results/me
   */
  getMyResults = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const results = await lotteryService.getUserResults(req.dbUser.user_id);

    res.json({
      success: true,
      data: results,
    });
  });

  /**
   * Check if user won in a campaign
   * GET /api/lottery/check/:campaignId
   */
  checkMyWin = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;

    const result = await lotteryService.checkUserWin(req.dbUser.user_id, campaignId);

    res.json({
      success: true,
      data: result,
      won: result !== null,
    });
  });
}

export default new LotteryController();
