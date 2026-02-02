/**
 * Coupon Routes
 * 
 * API endpoints for coupon management and validation
 * Requirements: 5.4 - Discount/Coupon System
 */

import { Router, Response } from 'express';
import { couponService } from '../services/CouponService';
import { auditLogRepository } from '../repositories';
import { AuthenticatedRequest, apiKeyAuth, adminRateLimiter, validate } from '../middleware';
import {
  createCouponSchema,
  updateCouponSchema,
  couponIdParams,
  couponCodeParams,
  validateCouponSchema,
  listCouponsQuery,
} from '../schemas';
import { logger } from '../utils/logger';

const router = Router();

// Apply authentication to all coupon routes
router.use(apiKeyAuth);

// ============================================================
// ADMIN COUPON MANAGEMENT
// ============================================================

/**
 * POST /api/v1/coupons
 * Create a new coupon
 */
router.post(
  '/',
  adminRateLimiter,
  validate(createCouponSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        code,
        name,
        discount_type,
        discount_value,
        currency,
        max_redemptions,
        expires_at,
        min_purchase_amount,
        applies_to_products,
        metadata,
      } = req.body;

      const coupon = await couponService.createCoupon({
        developerId: req.developer!.id,
        code,
        name,
        discountType: discount_type,
        discountValue: discount_value,
        currency,
        maxRedemptions: max_redemptions,
        expiresAt: expires_at,
        minPurchaseAmount: min_purchase_amount,
        appliesToProducts: applies_to_products,
        metadata,
      });

      // Log audit entry
      await auditLogRepository.create({
        developerId: req.developer!.id,
        action: 'coupon.created',
        resourceType: 'coupon',
        resourceId: coupon.id,
        changes: { code, discount_type, discount_value },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      logger.info('Coupon created via API', {
        couponId: coupon.id,
        code: coupon.code,
        developerId: req.developer!.id,
      });

      res.status(201).json({
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discount_type: coupon.discountType,
        discount_value: coupon.discountValue,
        currency: coupon.currency,
        min_purchase_amount: coupon.minPurchaseAmount,
        max_redemptions: coupon.maxRedemptions,
        redemption_count: coupon.redemptionCount,
        applies_to_products: coupon.appliesToProducts,
        active: coupon.active,
        expires_at: coupon.expiresAt?.toISOString() || null,
        stripe_coupon_id: coupon.stripeCouponId,
        metadata: coupon.metadata,
        created_at: coupon.createdAt.toISOString(),
      });
    } catch (error) {
      logger.error('Error creating coupon', { error });

      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          res.status(409).json({
            error: {
              code: 'coupon_exists',
              message: error.message,
              type: 'invalid_request_error',
            },
          });
          return;
        }

        if (error.message.includes('Invalid product')) {
          res.status(400).json({
            error: {
              code: 'invalid_product',
              message: error.message,
              type: 'invalid_request_error',
            },
          });
          return;
        }
      }

      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to create coupon',
          type: 'api_error',
        },
      });
    }
  }
);

/**
 * GET /api/v1/coupons
 * List all coupons for the developer
 */
router.get(
  '/',
  validate(listCouponsQuery, 'query'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
    const { active_only, limit, offset } = req.query as unknown as {
      active_only?: boolean;
      limit: number;
      offset: number;
    };

      const { coupons, total } = await couponService.listCoupons(req.developer!.id, {
        activeOnly: active_only,
        limit,
        offset,
      });

      res.json({
        data: coupons.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          discount_type: c.discountType,
          discount_value: c.discountValue,
          currency: c.currency,
          min_purchase_amount: c.minPurchaseAmount,
          max_redemptions: c.maxRedemptions,
          redemption_count: c.redemptionCount,
          applies_to_products: c.appliesToProducts,
          active: c.active,
          expires_at: c.expiresAt?.toISOString() || null,
          created_at: c.createdAt.toISOString(),
        })),
        pagination: {
          total,
          limit,
          offset,
        },
      });
    } catch (error) {
      logger.error('Error listing coupons', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to list coupons',
          type: 'api_error',
        },
      });
    }
  }
);

/**
 * GET /api/v1/coupons/:id
 * Get a specific coupon
 */
router.get(
  '/:id',
  validate(couponIdParams, 'params'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const coupon = await couponService.getCoupon(req.params.id);

      if (!coupon) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Verify ownership
      if (coupon.developerId !== req.developer!.id) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Get stats
      const stats = await couponService.getCouponStats(coupon.id);

      res.json({
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discount_type: coupon.discountType,
        discount_value: coupon.discountValue,
        currency: coupon.currency,
        min_purchase_amount: coupon.minPurchaseAmount,
        max_redemptions: coupon.maxRedemptions,
        redemption_count: coupon.redemptionCount,
        applies_to_products: coupon.appliesToProducts,
        active: coupon.active,
        expires_at: coupon.expiresAt?.toISOString() || null,
        stripe_coupon_id: coupon.stripeCouponId,
        metadata: coupon.metadata,
        created_at: coupon.createdAt.toISOString(),
        updated_at: coupon.updatedAt.toISOString(),
        stats: stats,
      });
    } catch (error) {
      logger.error('Error retrieving coupon', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to retrieve coupon',
          type: 'api_error',
        },
      });
    }
  }
);

/**
 * PUT /api/v1/coupons/:id
 * Update a coupon
 */
router.put(
  '/:id',
  adminRateLimiter,
  validate(couponIdParams, 'params'),
  validate(updateCouponSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, active, max_redemptions, expires_at, metadata } = req.body;

      const coupon = await couponService.getCoupon(req.params.id);

      if (!coupon) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Verify ownership
      if (coupon.developerId !== req.developer!.id) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      const updated = await couponService.updateCoupon(req.params.id, {
        name,
        active,
        maxRedemptions: max_redemptions,
        expiresAt: expires_at,
        metadata,
      });

      // Log audit entry
      await auditLogRepository.create({
        developerId: req.developer!.id,
        action: 'coupon.updated',
        resourceType: 'coupon',
        resourceId: coupon.id,
        changes: { name, active, max_redemptions, expires_at },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        id: updated!.id,
        code: updated!.code,
        name: updated!.name,
        discount_type: updated!.discountType,
        discount_value: updated!.discountValue,
        currency: updated!.currency,
        min_purchase_amount: updated!.minPurchaseAmount,
        max_redemptions: updated!.maxRedemptions,
        redemption_count: updated!.redemptionCount,
        active: updated!.active,
        expires_at: updated!.expiresAt?.toISOString() || null,
        updated_at: updated!.updatedAt.toISOString(),
      });
    } catch (error) {
      logger.error('Error updating coupon', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to update coupon',
          type: 'api_error',
        },
      });
    }
  }
);

/**
 * POST /api/v1/coupons/:id/deactivate
 * Deactivate a coupon
 */
router.post(
  '/:id/deactivate',
  adminRateLimiter,
  validate(couponIdParams, 'params'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const coupon = await couponService.getCoupon(req.params.id);

      if (!coupon) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Verify ownership
      if (coupon.developerId !== req.developer!.id) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      const deactivated = await couponService.deactivateCoupon(req.params.id);

      // Log audit entry
      await auditLogRepository.create({
        developerId: req.developer!.id,
        action: 'coupon.deactivated',
        resourceType: 'coupon',
        resourceId: coupon.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        id: deactivated!.id,
        code: deactivated!.code,
        active: deactivated!.active,
        message: 'Coupon deactivated successfully',
      });
    } catch (error) {
      logger.error('Error deactivating coupon', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to deactivate coupon',
          type: 'api_error',
        },
      });
    }
  }
);

/**
 * DELETE /api/v1/coupons/:id
 * Delete a coupon (only if no redemptions)
 */
router.delete(
  '/:id',
  adminRateLimiter,
  validate(couponIdParams, 'params'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const coupon = await couponService.getCoupon(req.params.id);

      if (!coupon) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Verify ownership
      if (coupon.developerId !== req.developer!.id) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      await couponService.deleteCoupon(req.params.id);

      // Log audit entry
      await auditLogRepository.create({
        developerId: req.developer!.id,
        action: 'coupon.deleted',
        resourceType: 'coupon',
        resourceId: coupon.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting coupon', { error });

      if (error instanceof Error && error.message.includes('existing redemptions')) {
        res.status(409).json({
          error: {
            code: 'coupon_has_redemptions',
            message: 'Cannot delete coupon with existing redemptions. Deactivate it instead.',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to delete coupon',
          type: 'api_error',
        },
      });
    }
  }
);

// ============================================================
// COUPON VALIDATION (Public-ish - requires API key but customer can use)
// ============================================================

/**
 * POST /api/v1/coupons/validate
 * Validate a coupon code
 */
router.post(
  '/validate',
  validate(validateCouponSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { code, product_id, amount } = req.body;

      const result = await couponService.validateCoupon({
        code,
        developerId: req.developer!.id,
        productId: product_id,
        amount: amount || 0,
        currency: 'usd', // Default, could be passed in
      });

      if (!result.valid) {
        res.status(400).json({
          valid: false,
          error: {
            code: result.errorCode,
            message: result.errorMessage,
          },
        });
        return;
      }

      res.json({
        valid: true,
        coupon: {
          code: result.coupon!.code,
          name: result.coupon!.name,
          discount_type: result.coupon!.discountType,
          discount_value: result.coupon!.discountValue,
          currency: result.coupon!.currency,
        },
        discount_amount: result.discountAmount,
      });
    } catch (error) {
      logger.error('Error validating coupon', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to validate coupon',
          type: 'api_error',
        },
      });
    }
  }
);

/**
 * GET /api/v1/coupons/code/:code
 * Get coupon by code (limited info for public use)
 */
router.get(
  '/code/:code',
  validate(couponCodeParams, 'params'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const coupon = await couponService.getCouponByCode(
        req.developer!.id,
        req.params.code
      );

      if (!coupon || !coupon.active) {
        res.status(404).json({
          error: {
            code: 'coupon_not_found',
            message: 'Coupon not found or inactive',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Check expiration
      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        res.status(400).json({
          error: {
            code: 'coupon_expired',
            message: 'This coupon has expired',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      // Return limited public info
      res.json({
        code: coupon.code,
        name: coupon.name,
        discount_type: coupon.discountType,
        discount_value: coupon.discountValue,
        currency: coupon.currency,
        min_purchase_amount: coupon.minPurchaseAmount,
        expires_at: coupon.expiresAt?.toISOString() || null,
      });
    } catch (error) {
      logger.error('Error retrieving coupon by code', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to retrieve coupon',
          type: 'api_error',
        },
      });
    }
  }
);

export default router;
