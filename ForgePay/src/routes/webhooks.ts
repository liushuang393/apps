import { Router, Request, Response } from 'express';
import { webhookProcessor } from '../services';
import { webhookRateLimiter } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/v1/webhooks/stripe
 * Receive and process Stripe webhook events
 * 
 * Requirements: 3.1, 3.2
 */
router.post(
  '/stripe',
  webhookRateLimiter,
  async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      logger.warn('Webhook received without signature', {
        ip: req.ip,
      });

      res.status(401).json({
        error: {
          code: 'missing_signature',
          message: 'Missing Stripe signature header',
          type: 'authentication_error',
        },
      });
      return;
    }

    try {
      // Note: Express should be configured to pass raw body for this endpoint
      // The body should be raw (string or Buffer), not parsed JSON
      const payload = req.body;

      const result = await webhookProcessor.processWebhook(payload, signature);

      if (!result.success && result.error === 'Invalid signature') {
        res.status(401).json({
          error: {
            code: 'invalid_signature',
            message: 'Invalid webhook signature',
            type: 'authentication_error',
          },
        });
        return;
      }

      // Always return 200 to Stripe to acknowledge receipt
      // (Failed events will be retried internally)
      res.status(200).json({
        received: true,
        event_id: result.eventId,
        event_type: result.eventType,
        processed: result.processed,
      });
    } catch (error) {
      logger.error('Webhook processing error', { error });

      // Still return 200 to prevent Stripe from retrying
      // (We'll handle retries internally)
      res.status(200).json({
        received: true,
        error: 'Processing error',
      });
    }
  }
);

export default router;
