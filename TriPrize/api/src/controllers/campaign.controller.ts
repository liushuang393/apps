import { Response } from 'express';
import { AuthorizedRequest } from '../middleware/role.middleware';
import campaignService from '../services/campaign.service';
import { CampaignStatus, CreateCampaignDto, UpdateCampaignDto } from '../models/campaign.entity';
import { errors, asyncHandler } from '../middleware/error.middleware';
// import logger from '../utils/logger.util';

/**
 * Campaign controller
 */
export class CampaignController {
  /**
   * Create a new campaign
   * POST /api/campaigns
   */
  createCampaign = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const dto = req.body as CreateCampaignDto;
    const campaign = await campaignService.createCampaign(dto, req.dbUser.user_id);

    res.status(201).json({
      success: true,
      data: campaign,
    });
  });

  /**
   * Get campaign by ID
   * GET /api/campaigns/:campaignId
   */
  getCampaign = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const { campaignId } = req.params;

    const campaign = await campaignService.getCampaignDetail(campaignId);

    if (!campaign) {
      throw errors.notFound('Campaign');
    }

    res.json({
      success: true,
      data: campaign,
    });
  });

  /**
   * List campaigns
   * GET /api/campaigns
   */
  listCampaigns = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const { status, limit, offset } = req.query as { status?: string; limit?: string; offset?: string };

    const limitNum = limit ? Number.parseInt(limit, 10) : 50;
    const offsetNum = offset ? Number.parseInt(offset, 10) : 0;

    const campaigns = await campaignService.listCampaigns(
      status as CampaignStatus | undefined,
      limitNum,
      offsetNum
    );

    res.json({
      success: true,
      data: campaigns,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: campaigns.length,
      },
    });
  });

  /**
   * Update campaign
   * PATCH /api/campaigns/:campaignId
   */
  updateCampaign = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;
    const dto = req.body as UpdateCampaignDto;

    const campaign = await campaignService.updateCampaign(campaignId, dto);

    res.json({
      success: true,
      data: campaign,
    });
  });

  /**
   * Delete campaign
   * DELETE /api/campaigns/:campaignId
   */
  deleteCampaign = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;

    await campaignService.deleteCampaign(campaignId);

    res.json({
      success: true,
      message: 'Campaign deleted successfully',
    });
  });

  /**
   * Publish campaign
   * POST /api/campaigns/:campaignId/publish
   */
  publishCampaign = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;

    const campaign = await campaignService.publishCampaign(campaignId);

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign published successfully',
    });
  });

  /**
   * Close campaign
   * POST /api/campaigns/:campaignId/close
   */
  closeCampaign = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { campaignId } = req.params;

    const campaign = await campaignService.closeCampaign(campaignId);

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign closed successfully',
    });
  });

  /**
   * Get campaign statistics
   * GET /api/campaigns/:campaignId/stats
   */
  getCampaignStats = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const campaignId = String(req.params.campaignId);

    const stats = await campaignService.getCampaignStats(campaignId);

    res.json({
      success: true,
      data: stats,
    });
  });

  /**
   * Get campaign positions
   * GET /api/campaigns/:campaignId/positions
   * 目的: キャンペーンの位置情報を取得する
   * I/O: campaignId, status (query), limit (query) -> Position[]
   */
  getPositions = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const campaignId = String(req.params.campaignId);
    const { status, limit } = req.query as { status?: string; limit?: string };

    const limitNum = limit ? Number.parseInt(limit, 10) : 100;

    const positions = await campaignService.getPositions(campaignId, status, limitNum);

    res.json({
      success: true,
      data: positions,
      pagination: {
        limit: limitNum,
        total: positions.length,
      },
    });
  });
}

export default new CampaignController();
