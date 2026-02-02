import { Request, Response } from 'express';
import Stripe from 'stripe';
import { AuthorizedRequest } from '../middleware/role.middleware';
import paymentService from '../services/payment.service';
import { CreatePaymentIntentDto } from '../models/payment.entity';
import { stripe, STRIPE_WEBHOOK_SECRET, PAYMENT_CONFIG } from '../config/stripe.config';
import { errors, asyncHandler } from '../middleware/error.middleware';
import { UserRole } from '../models/user.entity';
import logger from '../utils/logger.util';

/**
 * Payment controller
 */
export class PaymentController {
  /**
   * Create payment intent
   * POST /api/payments/create-intent
   */
  createPaymentIntent = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const dto = req.body as CreatePaymentIntentDto;
    const { paymentIntent, transaction } = await paymentService.createPaymentIntent(
      dto,
      req.dbUser.user_id
    );

    // コンビニ決済の場合、支払い番号と期限を取得
    // 目的: フロントエンドで支払い番号を表示するため
    // 注意点: konbini の場合は next_action.konbini_display_details.stores から取得
    let konbiniReference: string | null = null;
    let konbiniExpiresAt: string | null = null;

    if (dto.payment_method === 'konbini' && paymentIntent.next_action) {
      logger.debug('Konbini next_action found', {
        nextActionType: paymentIntent.next_action.type,
        nextAction: JSON.stringify(paymentIntent.next_action),
      });

      const konbiniDetails = paymentIntent.next_action.konbini_display_details;
      if (konbiniDetails) {
        // Stripe の konbini_display_details.stores から支払い番号を取得
        // 注意点: 各コンビニ店舗 (familymart, lawson, ministop, seicomart) から取得
        // 型アサーション: Mock と本番 Stripe の両方の構造に対応
        const stores = konbiniDetails.stores as {
          familymart?: { payment_code?: string };
          lawson?: { payment_code?: string };
          ministop?: { payment_code?: string };
          seicomart?: { payment_code?: string };
        } | undefined;

        logger.debug('Konbini stores data', {
          stores: JSON.stringify(stores),
          hasStores: !!stores,
        });

        if (stores) {
          const paymentCode = stores.familymart?.payment_code
            || stores.lawson?.payment_code
            || stores.ministop?.payment_code
            || stores.seicomart?.payment_code
            || null;
          konbiniReference = paymentCode;

          logger.info('Konbini payment code extracted', {
            paymentCode,
            paymentIntentId: paymentIntent.id,
          });
        }

        // 期限は konbiniDetails.expires_at から取得
        if (konbiniDetails.expires_at) {
          konbiniExpiresAt = new Date(konbiniDetails.expires_at * 1000).toISOString();
        }
      }
    }

    res.status(201).json({
      success: true,
      data: {
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        transaction_id: transaction.transaction_id,
        amount: transaction.amount,
        currency: transaction.currency,
        status: paymentIntent.status,
        konbini_reference: konbiniReference,
        konbini_expires_at: konbiniExpiresAt,
      },
    });
  });

  /**
   * Confirm payment
   * POST /api/payments/confirm
   */
  confirmPayment = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const body = req.body as { payment_intent_id: string; payment_method_id: string };
    const paymentIntentId = String(body.payment_intent_id);
    const paymentMethodId = String(body.payment_method_id);

    const paymentIntent = await paymentService.confirmPayment(
      paymentIntentId,
      paymentMethodId
    );

    res.json({
      success: true,
      data: {
        payment_intent_id: paymentIntent.id,
        status: paymentIntent.status,
        client_secret: paymentIntent.client_secret,
      },
    });
  });

  /**
   * Confirm payment with card details (for Web platform)
   * POST /api/payments/confirm-with-card
   * 目的: Web プラットフォーム用に直接カード情報を受け取って支払いを確認
   * I/O: payment_intent_id + card{number, exp_month, exp_year, cvc} → PaymentIntent
   * 注意点:
   *   - flutter_stripe は Web で動作しないため、このエンドポイントを使用
   *   - カード情報は Stripe API に直接送信される
   */
  confirmPaymentWithCard = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const body = req.body as {
      payment_intent_id: string;
      card: {
        number: string;
        exp_month: number;
        exp_year: number;
        cvc: string;
      };
    };

    // バリデーション
    if (!body.payment_intent_id) {
      throw errors.badRequest('payment_intent_id is required');
    }

    if (!body.card || !body.card.number || !body.card.exp_month || !body.card.exp_year || !body.card.cvc) {
      throw errors.badRequest('Card details are required (number, exp_month, exp_year, cvc)');
    }

    const paymentIntentId = String(body.payment_intent_id);

    logger.info('Confirming payment with card (Web)', {
      paymentIntentId,
      userId: req.dbUser.user_id,
      cardLastFour: body.card.number.slice(-4),
    });

    const paymentIntent = await paymentService.confirmPaymentWithCard(
      paymentIntentId,
      {
        number: body.card.number,
        exp_month: body.card.exp_month,
        exp_year: body.card.exp_year,
        cvc: body.card.cvc,
      }
    );

    res.json({
      success: true,
      data: {
        payment_intent_id: paymentIntent.id,
        status: paymentIntent.status,
        client_secret: paymentIntent.client_secret,
      },
    });
  });

  /**
   * Get konbini payment details
   * GET /api/payments/konbini/:paymentIntentId
   */
  getKonbiniDetails = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { paymentIntentId } = req.params;

    const konbiniInfo = await paymentService.getKonbiniPaymentInfo(paymentIntentId);

    if (!konbiniInfo) {
      throw errors.notFound('Konbini payment information');
    }

    res.json({
      success: true,
      data: konbiniInfo,
    });
  });

  /**
   * Get payment transaction
   * GET /api/payments/transactions/:transactionId
   */
  getTransaction = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { transactionId } = req.params;

    const transaction = await paymentService.getTransactionById(transactionId);

    if (!transaction) {
      throw errors.notFound('Transaction');
    }

    // Verify ownership
    if (transaction.user_id !== req.dbUser.user_id && req.dbUser.role !== UserRole.ADMIN) {
      throw errors.forbidden('You can only view your own transactions');
    }

    res.json({
      success: true,
      data: transaction,
    });
  });

  /**
   * Get user transactions
   * GET /api/payments/transactions/me
   */
  getMyTransactions = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const { limit, offset } = req.query as { limit?: string; offset?: string };
    const limitNum = limit ? Number.parseInt(limit, 10) : 50;
    const offsetNum = offset ? Number.parseInt(offset, 10) : 0;

    const transactions = await paymentService.getUserTransactions(
      req.dbUser.user_id,
      limitNum,
      offsetNum
    );

    res.json({
      success: true,
      data: transactions,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: transactions.length,
      },
    });
  });

  /**
   * Handle Stripe webhook
   * POST /api/payments/webhook
   */
  handleWebhook = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'] as string;
    const useMockPayment = process.env.USE_MOCK_PAYMENT === 'true';

    if (!signature) {
      throw errors.badRequest('Missing stripe-signature header');
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      // 目的: Stripe Webhook の署名を検証
      // 注意点: stripe が null の場合は Mock Payment モードで署名検証をスキップ
      if (!stripe) {
        if (useMockPayment) {
          // Mock Payment モード: 署名検証をスキップして JSON をパース
          logger.info('Mock payment mode: skipping webhook signature verification');
          // req.body は Buffer, string, または既にパースされたオブジェクトの可能性がある
          let bodyStr: string;
          if (Buffer.isBuffer(req.body)) {
            bodyStr = req.body.toString('utf8');
          } else if (typeof req.body === 'string') {
            bodyStr = req.body;
          } else {
            bodyStr = JSON.stringify(req.body);
          }
          event = JSON.parse(bodyStr) as Stripe.Event;
        } else {
          throw errors.serviceUnavailable('Stripe is not initialized. Webhook verification is not available.');
        }
      } else {
        event = stripe.webhooks.constructEvent(
          req.body as string | Buffer,
          signature,
          STRIPE_WEBHOOK_SECRET
        );
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Webhook signature verification failed', {
        error: errorMessage,
      });
      throw errors.badRequest(`Webhook signature verification failed: ${errorMessage}`);
    }

    // Handle the event
    await paymentService.handleWebhook(event);

    res.json({ received: true });
  });

  /**
   * Initiate refund (Admin only)
   * POST /api/payments/refund
   * 目的: 管理员主动发起退款
   * I/O: transaction_id, amount(可选), reason(可选) → refund 信息
   * 注意点: 只有 ADMIN 角色可以调用
   */
  initiateRefund = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    // Check admin role
    if (req.dbUser.role !== UserRole.ADMIN) {
      throw errors.forbidden('Only administrators can initiate refunds');
    }

    const body = req.body as {
      transaction_id: string;
      amount?: number;
      reason?: string;
    };

    const refund = await paymentService.initiateRefund(
      body.transaction_id,
      body.amount,
      body.reason
    );

    logger.info('Admin initiated refund', {
      adminUserId: req.dbUser.user_id,
      transactionId: body.transaction_id,
      refundId: refund.id,
      amount: body.amount,
      reason: body.reason,
    });

    res.json({
      success: true,
      data: {
        refund_id: refund.id,
        transaction_id: body.transaction_id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        created: refund.created,
      },
    });
  });

  /**
   * Mock: Complete konbini payment (DEVELOPMENT ONLY)
   * POST /api/payments/mock/complete-konbini
   * 目的: 开发环境下模拟便利店支付完成（无 Webhook）
   * I/O: payment_intent_id → 更新数据库状态
   * 注意点: 仅在 USE_MOCK_PAYMENT=true 时可用，生产环境禁止
   */
  mockCompleteKonbini = asyncHandler(async (req: AuthorizedRequest, res: Response): Promise<void> => {
    // 安全检查: 仅在 Mock 模式下可用
    if (!PAYMENT_CONFIG.useMockPayment) {
      throw errors.forbidden('This endpoint is only available in mock payment mode (development only)');
    }

    if (!req.dbUser) {
      throw errors.unauthorized();
    }

    const body = req.body as { payment_intent_id: string };
    const paymentIntentId = String(body.payment_intent_id);

    logger.info('Mock: Completing konbini payment', {
      paymentIntentId,
      userId: req.dbUser.user_id,
    });

    // 调用 mock 支付完成逻辑
    await paymentService.mockCompleteKonbiniPayment(paymentIntentId, req.dbUser.user_id);

    res.json({
      success: true,
      message: 'Mock konbini payment completed successfully',
      data: {
        payment_intent_id: paymentIntentId,
        status: 'succeeded',
      },
    });
  });

  /**
   * Dev: Force complete all pending payments for a campaign (DEVELOPMENT ONLY)
   * GET /api/payments/dev/force-complete
   * 目的: 開発環境で Webhook なしに支払いを強制完了させる
   * I/O: campaign_name + password → 全ての pending/processing 支払いを完了
   * 注意点:
   *   - USE_MOCK_PAYMENT=true の場合のみ使用可能（設定ファイルで制御）
   *   - パスワード認証で簡易的なセキュリティ
   *   - 全ての購入を completed に、position を sold に更新
   *   - キャンペーンが全て売り切れたら抽選も実行
   */
  devForceCompletePayments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // セキュリティチェック: Mock モードでのみ使用可能
    // 注意: このチェックは PAYMENT_CONFIG から取得（URL パラメータではない）
    // エラーメッセージは意図的に曖昧にする（セキュリティ対策）
    if (!PAYMENT_CONFIG.useMockPayment) {
      throw errors.notFound('Resource');
    }

    const { campaign_name, password } = req.query as { campaign_name?: string; password?: string };

    // パスワード認証（エラーメッセージは曖昧に）
    const DEV_PASSWORD = 'admin4321';
    if (password !== DEV_PASSWORD) {
      throw errors.notFound('Resource');
    }

    if (!campaign_name) {
      throw errors.badRequest('campaign_name is required');
    }

    logger.warn('DEV: Force completing payments for campaign', { campaign_name });

    // 強制完了ロジックを実行
    const result = await paymentService.devForceCompletePayments(campaign_name);

    res.json({
      success: true,
      message: `Payments force completed for campaign: ${campaign_name}`,
      data: result,
    });
  });
}

export default new PaymentController();
