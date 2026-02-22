import { Router, Response } from 'express';
import { checkoutService } from '../services';
import { AuthenticatedRequest, apiKeyAuth, validate } from '../middleware';
import { createCheckoutSessionSchema, getCheckoutSessionParams } from '../schemas';
import { logger } from '../utils/logger';
import { notFound, badRequest, internalError } from '../utils/errors';

const router = Router();

/**
 * @openapi
 * /checkout/sessions:
 *   post:
 *     tags:
 *       - Checkout
 *     summary: チェックアウトセッション作成
 *     description: purchase_intent_id と紐付けた Stripe Checkout Session を作成
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product_id
 *               - price_id
 *               - purchase_intent_id
 *               - success_url
 *               - cancel_url
 *             properties:
 *               product_id:
 *                 type: string
 *                 format: uuid
 *               price_id:
 *                 type: string
 *                 format: uuid
 *               purchase_intent_id:
 *                 type: string
 *               customer_email:
 *                 type: string
 *                 format: email
 *               success_url:
 *                 type: string
 *                 format: uri
 *               cancel_url:
 *                 type: string
 *                 format: uri
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: チェックアウトセッション作成成功
 */
router.post(
  '/sessions',
  apiKeyAuth,
  validate(createCheckoutSessionSchema),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      product_id,
      price_id,
      purchase_intent_id,
      customer_email,
      success_url,
      cancel_url,
      metadata,
      // i18n オプション（省略時は開発者デフォルト設定を使用）
      locale,
      currency,
      payment_methods,
    } = req.body;

    const result = await checkoutService.createSession({
      developerId: req.developer!.id,
      productId: product_id,
      priceId: price_id,
      purchaseIntentId: purchase_intent_id,
      customerEmail: customer_email,
      successUrl: success_url,
      cancelUrl: cancel_url,
      metadata,
      locale,
      currency,
      paymentMethods: payment_methods,
    });

    logger.info('チェックアウトセッション作成（API経由）', {
      sessionId: result.sessionId,
      purchaseIntentId: purchase_intent_id,
      developerId: req.developer!.id,
    });

    res.status(201).json({
      checkout_url: result.checkoutUrl,
      session_id: result.sessionId,
      expires_at: result.expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('チェックアウトセッション作成エラー', { error });
    if (error instanceof Error) {
      if (error.message === 'Product not found') return notFound(res, 'Product not found');
      if (error.message === 'Price not found') return notFound(res, 'Price not found');
      if (error.message.includes('not active')) return badRequest(res, error.message);
    }
    internalError(res, 'Failed to create checkout session');
  }
});

/**
 * @openapi
 * /checkout/sessions/{id}:
 *   get:
 *     tags:
 *       - Checkout
 *     summary: チェックアウトセッション取得
 *     security:
 *       - ApiKeyAuth: []
 */
router.get(
  '/sessions/:id',
  apiKeyAuth,
  validate(getCheckoutSessionParams, 'params'),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const session = await checkoutService.getSession(req.params.id);

    if (!session) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: 'Checkout session not found',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    res.json({
      id: session.id,
      stripe_session_id: session.stripeSessionId,
      purchase_intent_id: session.purchaseIntentId,
      product_id: session.productId,
      price_id: session.priceId,
      customer_id: session.customerId,
      status: session.status,
      success_url: session.successUrl,
      cancel_url: session.cancelUrl,
      expires_at: session.expiresAt.toISOString(),
      created_at: session.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('チェックアウトセッション取得エラー', { error });
    internalError(res, 'Failed to retrieve checkout session');
  }
});

export default router;
