import { Response } from 'express';
import { AuthorizedRequest } from '../middleware/role.middleware';
import purchaseService from '../services/purchase.service';
import { CreatePurchaseDto } from '../models/purchase.entity';
import { errors, asyncHandler } from '../middleware/error.middleware';
import { UserRole } from '../models/user.entity';

/**
 * Purchase controller
 */
export class PurchaseController {
  /**
   * Create a new purchase
   * POST /api/purchases
   */
  createPurchase = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    // Get idempotency key from header if provided
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const dto = req.body as CreatePurchaseDto;
    const purchase = await purchaseService.createPurchase(
      dto,
      req.dbUser.user_id,
      idempotencyKey
    );

    res.status(201).json({
      success: true,
      data: purchase,
      message: 'Purchase created successfully',
    });
  });

  /**
   * Get purchase by ID
   * GET /api/purchases/:purchaseId
   */
  getPurchase = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { purchaseId } = req.params;

    const purchase = await purchaseService.getPurchaseById(purchaseId);

    if (!purchase) {
      throw errors.notFound('Purchase');
    }

    // Verify ownership (or admin)
    if (purchase.user_id !== req.dbUser.user_id && req.dbUser.role !== UserRole.ADMIN) {
      throw errors.forbidden('You can only view your own purchases');
    }

    res.json({
      success: true,
      data: purchase,
    });
  });

  /**
   * Get current user's purchases
   * GET /api/purchases/me
   */
  getMyPurchases = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { limit, offset } = req.query as { limit?: string; offset?: string };
    const limitNum = limit ? Number.parseInt(limit, 10) : 50;
    const offsetNum = offset ? Number.parseInt(offset, 10) : 0;

    const purchases = await purchaseService.getUserPurchases(
      req.dbUser.user_id,
      limitNum,
      offsetNum
    );

    res.json({
      success: true,
      data: purchases,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: purchases.length,
      },
    });
  });

  /**
   * Cancel a purchase
   * POST /api/purchases/:purchaseId/cancel
   */
  cancelPurchase = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { purchaseId } = req.params;

    await purchaseService.cancelPurchase(purchaseId, req.dbUser.user_id);

    res.json({
      success: true,
      message: 'Purchase cancelled successfully',
    });
  });
}

export default new PurchaseController();
