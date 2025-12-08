import { Request, Response } from 'express';
import Stripe from 'stripe';
import { AuthorizedRequest } from '../middleware/role.middleware';
import paymentService from '../services/payment.service';
import { CreatePaymentIntentDto } from '../models/payment.entity';
import { stripe, STRIPE_WEBHOOK_SECRET } from '../config/stripe.config';
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

    res.status(201).json({
      success: true,
      data: {
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        transaction_id: transaction.transaction_id,
        amount: transaction.amount,
        currency: transaction.currency,
        status: paymentIntent.status,
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
}

export default new PaymentController();
