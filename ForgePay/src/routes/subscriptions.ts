import { Router, Response } from 'express';
import { subscriptionService } from '../services/SubscriptionService';
import { AuthenticatedRequest, apiKeyAuth, validate } from '../middleware';
import {
    createSetupIntentSchema,
    createSubscriptionSchema,
    updateSubscriptionSchema,
    cancelSubscriptionSchema,
    subscriptionIdParams,
} from '../schemas';
import { logger } from '../utils/logger';
import { notFound, badRequest, internalError } from '../utils/errors';

const router = Router();

/**
 * @openapi
 * /subscriptions/setup-intent:
 *   post:
 *     tags:
 *       - Subscriptions (方案3: PaymentIntent API)
 *     summary: SetupIntent 作成（カード登録のみ、課金なし）
 *     description: |
 *       カード情報を登録するための SetupIntent を作成する。
 *       フロントエンドは client_secret を使って stripe.confirmSetupIntent() を呼び出す。
 *       登録後の paymentMethodId を使って POST /subscriptions でサブスクリプションを作成する。
 *     security:
 *       - ApiKeyAuth: []
 */
router.post(
    '/setup-intent',
    apiKeyAuth,
    validate(createSetupIntentSchema),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const result = await subscriptionService.createSetupIntent(
                req.developer!.id,
                req.body.customer_email,
                req.body.customer_name
            );

            res.status(201).json({
                setup_intent_id: result.setupIntentId,
                client_secret: result.clientSecret,
                customer_id: result.customerId,
                publishable_key: result.publishableKey,
            });
        } catch (error) {
            logger.error('SetupIntent 作成エラー', { error });
            internalError(res, 'Failed to create setup intent');
        }
    }
);

/**
 * @openapi
 * /subscriptions:
 *   post:
 *     tags:
 *       - Subscriptions (方案3: PaymentIntent API)
 *     summary: サブスクリプション作成
 *     security:
 *       - ApiKeyAuth: []
 */
router.post(
    '/',
    apiKeyAuth,
    validate(createSubscriptionSchema),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const result = await subscriptionService.createSubscription({
                developerId: req.developer!.id,
                productId: req.body.product_id,
                priceId: req.body.price_id,
                customerEmail: req.body.customer_email,
                customerName: req.body.customer_name,
                purchaseIntentId: req.body.purchase_intent_id,
                paymentMethodId: req.body.payment_method_id,
                trialPeriodDays: req.body.trial_period_days,
                metadata: req.body.metadata,
            });

            logger.info('サブスクリプション作成（API経由）', {
                subscriptionId: result.subscriptionId,
                developerId: req.developer!.id,
            });

            res.status(201).json({
                subscription_id: result.subscriptionId,
                status: result.status,
                client_secret: result.clientSecret,
                current_period_end: result.currentPeriodEnd.toISOString(),
                cancel_at_period_end: result.cancelAtPeriodEnd,
                publishable_key: result.publishableKey,
            });
        } catch (error) {
            logger.error('サブスクリプション作成エラー', { error });
            if (error instanceof Error) {
                if (error.message === 'Product not found') return notFound(res, 'Product not found');
                if (error.message === 'Price not found') return notFound(res, 'Price not found');
                if (
                    error.message.includes('not active') ||
                    error.message.includes('not belong') ||
                    error.message.includes('One-time payment')
                ) {
                    return badRequest(res, error.message);
                }
            }
            internalError(res, 'Failed to create subscription');
        }
    }
);

/**
 * @openapi
 * /subscriptions/{id}:
 *   get:
 *     tags:
 *       - Subscriptions (方案3: PaymentIntent API)
 *     summary: サブスクリプション取得
 *     security:
 *       - ApiKeyAuth: []
 */
router.get(
    '/:id',
    apiKeyAuth,
    validate(subscriptionIdParams, 'params'),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const sub = await subscriptionService.getSubscription(
                req.developer!.id,
                req.params.id
            );

            res.json({
                id: sub.id,
                status: sub.status,
                current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
                current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
                cancel_at_period_end: sub.cancel_at_period_end,
                canceled_at: sub.canceled_at
                    ? new Date(sub.canceled_at * 1000).toISOString()
                    : null,
                trial_end: sub.trial_end
                    ? new Date(sub.trial_end * 1000).toISOString()
                    : null,
            });
        } catch (error) {
            logger.error('サブスクリプション取得エラー', { error });
            if (error instanceof Error && error.message.includes('No such subscription')) {
                return notFound(res, 'Subscription not found');
            }
            internalError(res, 'Failed to retrieve subscription');
        }
    }
);

/**
 * @openapi
 * /subscriptions/{id}:
 *   put:
 *     tags:
 *       - Subscriptions (方案3: PaymentIntent API)
 *     summary: サブスクリプション更新（アップグレード/ダウングレード）
 *     security:
 *       - ApiKeyAuth: []
 */
router.put(
    '/:id',
    apiKeyAuth,
    validate(updateSubscriptionSchema),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const sub = await subscriptionService.updateSubscription(
                req.developer!.id,
                req.params.id,
                {
                    newPriceId: req.body.new_price_id,
                    prorationBehavior: req.body.proration_behavior,
                }
            );

            logger.info('サブスクリプション更新（API経由）', {
                subscriptionId: sub.id,
                developerId: req.developer!.id,
            });

            res.json({
                id: sub.id,
                status: sub.status,
                current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
                cancel_at_period_end: sub.cancel_at_period_end,
            });
        } catch (error) {
            logger.error('サブスクリプション更新エラー', { error });
            if (error instanceof Error) {
                if (error.message === 'New price not found') return notFound(res, 'New price not found');
                if (error.message.includes('No such subscription')) {
                    return notFound(res, 'Subscription not found');
                }
            }
            internalError(res, 'Failed to update subscription');
        }
    }
);

/**
 * @openapi
 * /subscriptions/{id}:
 *   delete:
 *     tags:
 *       - Subscriptions (方案3: PaymentIntent API)
 *     summary: サブスクリプションキャンセル
 *     description: |
 *       immediately=false（デフォルト）: 現在の請求期間終了時にキャンセル
 *       immediately=true: 即座にキャンセル
 *     security:
 *       - ApiKeyAuth: []
 */
router.delete(
    '/:id',
    apiKeyAuth,
    validate(cancelSubscriptionSchema),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const sub = await subscriptionService.cancelSubscription(
                req.developer!.id,
                req.params.id,
                req.body.immediately ?? false
            );

            logger.info('サブスクリプションキャンセル（API経由）', {
                subscriptionId: sub.id,
                immediately: req.body.immediately,
                developerId: req.developer!.id,
            });

            res.json({
                id: sub.id,
                status: sub.status,
                cancel_at_period_end: sub.cancel_at_period_end,
                canceled_at: sub.canceled_at
                    ? new Date(sub.canceled_at * 1000).toISOString()
                    : null,
            });
        } catch (error) {
            logger.error('サブスクリプションキャンセルエラー', { error });
            if (error instanceof Error && error.message.includes('No such subscription')) {
                return notFound(res, 'Subscription not found');
            }
            internalError(res, 'Failed to cancel subscription');
        }
    }
);

export default router;
