import { Router, Request, Response } from 'express';
import { entitlementService } from '../services';
import { AuthenticatedRequest, apiKeyAuth, optionalApiKeyAuth } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/entitlements/verify
 * Verify entitlement by unlock token or purchase_intent_id
 * 
 * Requirements: 4.5, 10.2, 10.3
 */
router.get('/verify', optionalApiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { unlock_token, purchase_intent_id } = req.query;

    if (!unlock_token && !purchase_intent_id) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: 'Either unlock_token or purchase_intent_id is required',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    // Verify by unlock token
    if (unlock_token) {
      const result = await entitlementService.verifyUnlockToken(unlock_token as string);

      if (!result.valid) {
        res.status(401).json({
          error: {
            code: 'invalid_token',
            message: result.error || 'Invalid unlock token',
            type: 'authentication_error',
          },
        });
        return;
      }

      res.json({
        status: result.status!.status,
        has_access: result.status!.hasAccess,
        entitlement_id: result.status!.entitlementId,
        product_id: result.status!.productId,
        expires_at: result.status!.expiresAt?.toISOString() || null,
      });
      return;
    }

    // Verify by purchase_intent_id
    const status = await entitlementService.checkEntitlementStatus(
      purchase_intent_id as string
    );

    if (!status.entitlementId) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: 'No entitlement found for this purchase_intent_id',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    res.json({
      status: status.status,
      has_access: status.hasAccess,
      entitlement_id: status.entitlementId,
      product_id: status.productId,
      expires_at: status.expiresAt?.toISOString() || null,
    });
  } catch (error) {
    logger.error('Error verifying entitlement', { error });
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Failed to verify entitlement',
        type: 'api_error',
      },
    });
  }
});

/**
 * GET /api/v1/entitlements/:id
 * Get an entitlement by ID
 */
router.get('/:id', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entitlement = await entitlementService.getEntitlement(req.params.id);

    if (!entitlement) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: 'Entitlement not found',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    res.json({
      id: entitlement.id,
      customer_id: entitlement.customerId,
      product_id: entitlement.productId,
      purchase_intent_id: entitlement.purchaseIntentId,
      payment_id: entitlement.paymentId,
      subscription_id: entitlement.subscriptionId,
      status: entitlement.status,
      expires_at: entitlement.expiresAt?.toISOString() || null,
      revoked_reason: entitlement.revokedReason,
      created_at: entitlement.createdAt.toISOString(),
      updated_at: entitlement.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error retrieving entitlement', { error });
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Failed to retrieve entitlement',
        type: 'api_error',
      },
    });
  }
});

/**
 * GET /api/v1/entitlements/customer/:customerId
 * Get all entitlements for a customer
 */
router.get(
  '/customer/:customerId',
  apiKeyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { active_only } = req.query;

      let entitlements;
      if (active_only === 'true') {
        entitlements = await entitlementService.getActiveEntitlementsByCustomerId(
          req.params.customerId
        );
      } else {
        entitlements = await entitlementService.getEntitlementsByCustomerId(
          req.params.customerId
        );
      }

      res.json({
        data: entitlements.map((e) => ({
          id: e.id,
          customer_id: e.customerId,
          product_id: e.productId,
          purchase_intent_id: e.purchaseIntentId,
          status: e.status,
          expires_at: e.expiresAt?.toISOString() || null,
          created_at: e.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      logger.error('Error retrieving customer entitlements', { error });
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'Failed to retrieve entitlements',
          type: 'api_error',
        },
      });
    }
  }
);

export default router;
