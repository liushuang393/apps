import { Router, Response } from 'express';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { stripeClientFactory } from '../services/StripeClientFactory';
import { productRepository } from '../repositories/ProductRepository';
import { priceRepository } from '../repositories/PriceRepository';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @openapi
 * /quickpay:
 *   post:
 *     tags:
 *       - QuickPay
 *     summary: 簡易決済セッション作成（3モード対応）
 *     description: |
 *       1 回の API 呼び出しで Stripe Checkout URL を生成する簡易決済エンドポイント。
 *
 *       **3 つのモード:**
 *       - `product_id` — ForgePay ダッシュボードで作成した商品 ID（DB から価格を自動解決）
 *       - `price_id`   — 既存の Stripe Price ID を直接指定
 *       - `name` + `amount` + `currency` — 商品登録不要のアドホック決済
 *
 *       `success_url` / `cancel_url` は省略可。省略時はダッシュボードの設定値を使用。
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - purchase_intent_id
 *             properties:
 *               purchase_intent_id:
 *                 type: string
 *                 description: 購入意図を一意に識別する ID（ユーザー ID 等）
 *               product_id:
 *                 type: string
 *                 description: ForgePay の商品 ID（ダッシュボードで作成した UUID）
 *               price_id:
 *                 type: string
 *                 description: 既存の Stripe Price ID（指定時は name/amount/currency 不要）
 *               name:
 *                 type: string
 *                 description: 商品名（アドホックモード時に必須）
 *               amount:
 *                 type: integer
 *                 description: "金額（最小通貨単位: 円なら円、ドルならセント）"
 *               currency:
 *                 type: string
 *                 description: "通貨コード（ISO 4217: jpy, usd 等）"
 *               customer_email:
 *                 type: string
 *                 format: email
 *               success_url:
 *                 type: string
 *                 format: uri
 *                 description: 省略時はダッシュボードのデフォルト設定を使用
 *               cancel_url:
 *                 type: string
 *                 format: uri
 *                 description: 省略時はダッシュボードのデフォルト設定を使用
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: 決済 URL 作成成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session_id:
 *                   type: string
 *                 checkout_url:
 *                   type: string
 *                   format: uri
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 */
router.post(
  '/',
  apiKeyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const {
      purchase_intent_id,
      product_id,
      price_id,
      name,
      amount,
      currency,
      customer_email,
      success_url,
      cancel_url,
      metadata,
      locale,
      payment_methods,
    } = req.body;

    if (!purchase_intent_id || typeof purchase_intent_id !== 'string') {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: 'purchase_intent_id は必須の文字列です',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    // success_url / cancel_url: 省略時は開発者デフォルト設定にフォールバック
    const resolvedSuccessUrl = success_url || req.developer!.defaultSuccessUrl;
    const resolvedCancelUrl = cancel_url || req.developer!.defaultCancelUrl;

    if (!resolvedSuccessUrl || !resolvedCancelUrl) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message:
            'success_url / cancel_url が未指定で、ダッシュボードにもデフォルト設定がありません。' +
            'リクエストで指定するか、ダッシュボードの「設定」で遷移先 URL を登録してください。',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    try {
      const stripe = stripeClientFactory.getClient(
        req.developer!.stripeSecretKeyEnc,
        req.developer!.id,
      );

      const devLocale = locale ?? req.developer!.defaultLocale ?? 'auto';
      const devCurrency = currency ?? req.developer!.defaultCurrency ?? 'usd';
      const devPaymentMethods = payment_methods ?? req.developer!.defaultPaymentMethods;

      // ─── モード 1: ForgePay product_id ─────────────────────────
      // ダッシュボードで作成した商品 ID → DB から Stripe Price を自動解決
      if (product_id) {
        const product = await productRepository.findById(product_id);
        if (!product || !product.active) {
          res.status(404).json({
            error: {
              code: 'product_not_found',
              message: '指定された商品が見つからないか、無効です',
              type: 'invalid_request_error',
            },
          });
          return;
        }
        if (product.developerId !== req.developer!.id) {
          res.status(404).json({
            error: {
              code: 'product_not_found',
              message: '指定された商品が見つかりません',
              type: 'invalid_request_error',
            },
          });
          return;
        }

        const prices = await priceRepository.findActiveByProductId(product_id);
        if (prices.length === 0) {
          res.status(400).json({
            error: {
              code: 'no_active_price',
              message: 'この商品にはアクティブな価格が設定されていません。ダッシュボードで価格を追加してください。',
              type: 'invalid_request_error',
            },
          });
          return;
        }

        // 最初のアクティブ価格を使用（通常は1つ）
        const price = prices[0];

        const session = await stripe.createCheckoutSession({
          productId: product_id,
          priceId: price.stripePriceId,
          purchaseIntentId: purchase_intent_id,
          customerEmail: customer_email,
          successUrl: resolvedSuccessUrl,
          cancelUrl: resolvedCancelUrl,
          mode: product.type === 'subscription' ? 'subscription' : 'payment',
          metadata,
          locale: devLocale as import('../services/StripeClient').CheckoutLocale,
          paymentMethodTypes: devPaymentMethods as import('../services/StripeClient').PaymentMethodType[] | undefined,
        });

        logger.info('QuickPay (product_id) セッション作成', {
          developerId: req.developer!.id,
          purchaseIntentId: purchase_intent_id,
          productId: product_id,
          priceId: price.id,
        });

        res.status(201).json({
          session_id: session.sessionId,
          checkout_url: session.url,
          expires_at: session.expiresAt.toISOString(),
        });
        return;
      }

      // ─── モード 2: Stripe price_id ─────────────────────────────
      if (price_id) {
        const session = await stripe.createCheckoutSession({
          productId: '',
          priceId: price_id,
          purchaseIntentId: purchase_intent_id,
          customerEmail: customer_email,
          successUrl: resolvedSuccessUrl,
          cancelUrl: resolvedCancelUrl,
          mode: 'payment',
          metadata,
          locale: devLocale as import('../services/StripeClient').CheckoutLocale,
          paymentMethodTypes: devPaymentMethods as import('../services/StripeClient').PaymentMethodType[] | undefined,
        });

        logger.info('QuickPay (price_id) セッション作成', {
          developerId: req.developer!.id,
          purchaseIntentId: purchase_intent_id,
          priceId: price_id,
        });

        res.status(201).json({
          session_id: session.sessionId,
          checkout_url: session.url,
          expires_at: session.expiresAt.toISOString(),
        });
        return;
      }

      // ─── モード 3: アドホック (name + amount + currency) ────────
      if (!name || amount === undefined || !currency) {
        res.status(400).json({
          error: {
            code: 'invalid_request',
            message:
              'product_id / price_id が未指定の場合は name, amount, currency が必須です。' +
              'またはダッシュボードで商品を作成して product_id を指定してください。',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      if (typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({
          error: {
            code: 'invalid_request',
            message: 'amount は正の整数（最小通貨単位）で指定してください',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      const session = await stripe.createAdHocCheckoutSession({
        name,
        amount,
        currency: String(devCurrency).toLowerCase(),
        purchaseIntentId: purchase_intent_id,
        customerEmail: customer_email,
        successUrl: resolvedSuccessUrl,
        cancelUrl: resolvedCancelUrl,
        metadata,
      });

      logger.info('QuickPay (ad-hoc) セッション作成', {
        developerId: req.developer!.id,
        purchaseIntentId: purchase_intent_id,
        amount,
        currency,
      });

      res.status(201).json({
        session_id: session.sessionId,
        checkout_url: session.url,
        expires_at: session.expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error('QuickPay セッション作成エラー', {
        developerId: req.developer?.id,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        error: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'QuickPay 処理に失敗しました',
          type: 'api_error',
        },
      });
    }
  }
);

export default router;
