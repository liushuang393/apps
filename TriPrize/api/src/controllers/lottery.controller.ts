import { Response } from 'express';
import { AuthorizedRequest } from '../middleware/role.middleware';
import lotteryService from '../services/lottery.service';
import { errors, asyncHandler } from '../middleware/error.middleware';
import { UserRole } from '../models/user.entity';
// import logger from '../utils/logger.util';

/**
 * Lottery controller
 * 目的: 抽選関連のAPIを処理
 * 注意点: 管理者は全員の結果を見れる、顧客は自分の結果のみ見れる
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

    res.status(201).json({
      success: true,
      data: result,
      message: 'Lottery drawn successfully',
    });
  });

  /**
   * Get campaign lottery results
   * GET /api/lottery/results/:campaignId
   * 目的: キャンペーンの抽選結果を取得
   * 注意点: 管理者は全当選者の詳細情報、顧客は自分の当選情報のみ
   */
  getCampaignResults = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;
    const isAdmin = req.dbUser.role === UserRole.ADMIN;

    if (isAdmin) {
      // 管理者: 全当選者の詳細情報を返す
      const results = await lotteryService.getCampaignResults(campaignId);
      res.json({
        success: true,
        data: results,
        isAdmin: true,
      });
    } else {
      // 顧客: 自分の当選情報のみ返す
      const myResult = await lotteryService.checkUserWin(req.dbUser.user_id, campaignId);
      // 当選者数のみ返す（他人の個人情報は返さない）
      const allResults = await lotteryService.getCampaignResults(campaignId);
      const winnersCount = allResults.length;

      res.json({
        success: true,
        data: myResult ? [myResult] : [],
        winnersCount,
        isAdmin: false,
        myWin: myResult,
      });
    }
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
