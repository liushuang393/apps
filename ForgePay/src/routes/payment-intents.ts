import { Router, Response } from 'express';
import { paymentIntentService } from '../services/PaymentIntentService';
import { AuthenticatedRequest, apiKeyAuth, validate } from '../middleware';
import {
    createPaymentIntentSchema,
    paymentIntentIdParams,
} from '../schemas';
import { logger } from '../utils/logger';
import { notFound, badRequest, internalError } from '../utils/errors';

const router = Router();

/**
 * @openapi
 * /payment-intents:
 *   post:
 *     tags:
 *       - PaymentIntents (方案2: Stripe Elements)
 *     summary: PaymentIntent 作成
 *     description: |
 *       Stripe Elements 用の PaymentIntent を作成し client_secret を返す。
 *       フロントエンドはこの client_secret を使って stripe.confirmPayment() を呼び出す。
 *       カード情報はサーバーを経由しない（PCI SAQ A 準拠）。
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
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: PaymentIntent 作成成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment_intent_id:
 *                   type: string
 *                 client_secret:
 *                   type: string
 *                 amount:
 *                   type: integer
 *                 currency:
 *                   type: string
 *                 publishable_key:
 *                   type: string
 */
router.post(
    '/',
    apiKeyAuth,
    validate(createPaymentIntentSchema),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const result = await paymentIntentService.createPaymentIntent({
                developerId: req.developer!.id,
                productId: req.body.product_id,
                priceId: req.body.price_id,
                purchaseIntentId: req.body.purchase_intent_id,
                customerEmail: req.body.customer_email,
                metadata: req.body.metadata,
            });

            logger.info('PaymentIntent 作成（API経由）', {
                paymentIntentId: result.paymentIntentId,
                developerId: req.developer!.id,
            });

            res.status(201).json({
                payment_intent_id: result.paymentIntentId,
                client_secret: result.clientSecret,
                amount: result.amount,
                currency: result.currency,
                publishable_key: result.publishableKey,
            });
        } catch (error) {
            logger.error('PaymentIntent 作成エラー', { error });
            if (error instanceof Error) {
                if (error.message === 'Product not found') return notFound(res, 'Product not found');
                if (error.message === 'Price not found') return notFound(res, 'Price not found');
                if (
                    error.message.includes('not active') ||
                    error.message.includes('not belong') ||
                    error.message.includes('Subscription products')
                ) {
                    return badRequest(res, error.message);
                }
            }
            internalError(res, 'Failed to create payment intent');
        }
    }
);

/**
 * @openapi
 * /payment-intents/{id}:
 *   get:
 *     tags:
 *       - PaymentIntents (方案2: Stripe Elements)
 *     summary: PaymentIntent ステータス取得
 *     security:
 *       - ApiKeyAuth: []
 */
router.get(
    '/:id',
    apiKeyAuth,
    validate(paymentIntentIdParams, 'params'),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const status = await paymentIntentService.getPaymentIntentStatus(
                req.developer!.id,
                req.params.id
            );

            res.json({
                id: status.id,
                status: status.status,
                amount: status.amount,
                currency: status.currency,
            });
        } catch (error) {
            logger.error('PaymentIntent 取得エラー', { error });
            if (error instanceof Error && error.message.includes('No such payment_intent')) {
                return notFound(res, 'Payment intent not found');
            }
            internalError(res, 'Failed to retrieve payment intent');
        }
    }
);

export default router;
