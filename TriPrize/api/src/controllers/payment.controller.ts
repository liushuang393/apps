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

    if (!signature) {
      throw errors.badRequest('Missing stripe-signature header');
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(
        req.body as string | Buffer,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
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
}

export default new PaymentController();
