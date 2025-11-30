import Stripe from 'stripe';
import { pool } from '../config/database.config';
import { stripe } from '../config/stripe.config';
import {
  PaymentTransaction,
  PaymentMethod,
  PaymentStatus,
  CreatePaymentIntentDto,
  KonbiniPaymentInfo,
  mapRowToPaymentTransaction,
} from '../models/payment.entity';
import { PurchaseStatus } from '../models/purchase.entity';
import purchaseService from './purchase.service';
import notificationService, { NotificationType } from './notification.service';
import { generateUUID } from '../utils/crypto.util';
import logger from '../utils/logger.util';

/**
 * Payment service for handling Stripe payments
 */
export class PaymentService {
  /**
   * Create a payment intent for a purchase
   */
  async createPaymentIntent(
    dto: CreatePaymentIntentDto,
    userId: string
  ): Promise<{ paymentIntent: Stripe.PaymentIntent; transaction: PaymentTransaction }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get purchase
      const purchase = await purchaseService.getPurchaseById(dto.purchase_id);

      if (!purchase) {
        throw new Error('PURCHASE_NOT_FOUND');
      }

      // Verify ownership
      if (purchase.user_id !== userId) {
        throw new Error('FORBIDDEN');
      }

      // Check if purchase already has a payment
      if (purchase.status === PurchaseStatus.COMPLETED) {
        throw new Error('Purchase already paid');
      }

      // Create Stripe Payment Intent
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: purchase.total_amount,
        currency: 'jpy',
        payment_method_types: dto.payment_method === PaymentMethod.CARD ? ['card'] : ['konbini'],
        metadata: {
          purchase_id: purchase.purchase_id,
          user_id: userId,
          campaign_id: purchase.campaign_id,
        },
      };

      // Add return URL for 3D Secure if provided
      if (dto.return_url && dto.payment_method === PaymentMethod.CARD) {
        paymentIntentParams.return_url = dto.return_url;
      }

      // For konbini, set expiration time (4 days)
      if (dto.payment_method === PaymentMethod.KONBINI) {
        paymentIntentParams.payment_method_options = {
          konbini: {
            expires_after_days: 4,
          },
        };
      }

      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

      // Create payment transaction record
      const transactionId = generateUUID();

      const { rows: transactionRows } = await client.query<PaymentTransaction>(
        `INSERT INTO payment_transactions (
          transaction_id, purchase_id, user_id, amount, currency,
          payment_method, payment_status, stripe_payment_intent_id,
          metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING *`,
        [
          transactionId,
          purchase.purchase_id,
          userId,
          purchase.total_amount,
          'jpy',
          dto.payment_method,
          'pending',
          paymentIntent.id,
          JSON.stringify(paymentIntent.metadata),
        ]
      );

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Update purchase with payment intent ID
      await purchaseService.updatePurchaseStatus(
        purchase.purchase_id,
        PurchaseStatus.PROCESSING,
        paymentIntent.id
      );

      await client.query('COMMIT');

      logger.info('Payment intent created', {
        transactionId,
        purchaseId: purchase.purchase_id,
        amount: purchase.total_amount,
        paymentMethod: dto.payment_method,
        paymentIntentId: paymentIntent.id,
      });

      return { paymentIntent, transaction };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create payment intent', {
        error: errorMessage,
        dto,
        userId,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Confirm a payment (for card payments)
   */
  async confirmPayment(paymentIntentId: string, paymentMethodId: string): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      logger.info('Payment confirmed', { paymentIntentId });

      return paymentIntent;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to confirm payment', {
        error: errorMessage,
        paymentIntentId,
      });
      throw error;
    }
  }

  /**
   * Get konbini payment details
   */
  async getKonbiniPaymentInfo(paymentIntentId: string): Promise<KonbiniPaymentInfo | null> {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.payment_method) {
        const paymentMethod = await stripe.paymentMethods.retrieve(
          paymentIntent.payment_method as string
        );

        if (paymentMethod.type === 'konbini' && paymentMethod.konbini) {
          const konbini = paymentMethod.konbini as { store?: string; confirmation_number?: string } | undefined;
          const expiresAt = paymentIntent.created + (4 * 24 * 60 * 60); // 4 days

          return {
            store_type: konbini?.store || 'unknown',
            confirmation_number: konbini?.confirmation_number || '',
            payment_code: konbini?.confirmation_number || '',
            expires_at: new Date(expiresAt * 1000),
            instructions_url: paymentIntent.next_action?.konbini_display_details?.hosted_voucher_url || '',
          };
        }
      }

      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get konbini payment info', {
        error: errorMessage,
        paymentIntentId,
      });
      throw error;
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(event: Stripe.Event): Promise<void> {
    logger.info('Processing Stripe webhook', { type: event.type, id: event.id });

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSucceeded(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentCanceled(event.data.object);
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(event.data.object);
          break;

        default:
          logger.debug('Unhandled webhook event type', { type: event.type });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to handle webhook', {
        error: errorMessage,
        eventType: event.type,
        eventId: event.id,
      });
      throw error;
    }
  }

  /**
   * Handle successful payment
   */
  private async handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get transaction
      const { rows: transactionRows } = await client.query<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE stripe_payment_intent_id = $1',
        [paymentIntent.id]
      );

      if (transactionRows.length === 0) {
        logger.warn('Payment transaction not found for payment intent', {
          paymentIntentId: paymentIntent.id,
        });
        await client.query('ROLLBACK');
        return;
      }

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Idempotency check: Skip if already processed
      if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
        logger.info('Payment already processed, skipping', {
          transactionId: transaction.transaction_id,
          paymentIntentId: paymentIntent.id,
        });
        await client.query('ROLLBACK');
        return;
      }

      // Update transaction status
      await client.query(
        `UPDATE payment_transactions
         SET payment_status = 'succeeded',
             stripe_charge_id = $1,
             paid_at = NOW(),
             updated_at = NOW()
         WHERE transaction_id = $2`,
        [paymentIntent.latest_charge, transaction.transaction_id]
      );

      // Update purchase status
      await purchaseService.updatePurchaseStatus(
        transaction.purchase_id,
        PurchaseStatus.COMPLETED
      );

      // Update position status to 'sold'
      await client.query(
        `UPDATE positions
         SET status = 'sold', updated_at = NOW()
         WHERE position_id = (
           SELECT position_id FROM purchases WHERE purchase_id = $1
         )`,
        [transaction.purchase_id]
      );

      // Update campaign statistics
      await client.query(
        `UPDATE campaigns
         SET positions_sold = positions_sold + 1,
             total_revenue = total_revenue + $1,
             updated_at = NOW()
         WHERE campaign_id = (
           SELECT campaign_id FROM purchases WHERE purchase_id = $2
         )`,
        [transaction.amount, transaction.purchase_id]
      );

      await client.query('COMMIT');

      logger.info('Payment succeeded', {
        transactionId: transaction.transaction_id,
        purchaseId: transaction.purchase_id,
        amount: transaction.amount,
      });

      // Send notification to user
      try {
        const purchase = await purchaseService.getPurchaseById(transaction.purchase_id);
        if (purchase) {
          await notificationService.sendToUser(
            purchase.user_id,
            NotificationType.PAYMENT_COMPLETED,
            {
              title: '決済が完了しました',
              body: `購入が正常に完了しました。ポジション番号: ${purchase.position_id}`,
              data: {
                purchase_id: purchase.purchase_id,
                campaign_id: purchase.campaign_id,
                position_id: purchase.position_id,
              },
            }
          );
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Failed to send payment success notification', {
          error: errorMessage,
          purchaseId: transaction.purchase_id,
        });
        // Don't throw - notification failure shouldn't fail the payment
      }
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to handle payment succeeded', {
        error: errorMessage,
        paymentIntentId: paymentIntent.id,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Handle failed payment
   */
  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get transaction
      const { rows: transactionRows } = await client.query<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE stripe_payment_intent_id = $1',
        [paymentIntent.id]
      );

      if (transactionRows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Idempotency check: Skip if already processed
      if (transaction.payment_status === PaymentStatus.FAILED) {
        logger.info('Payment failure already processed, skipping', {
          transactionId: transaction.transaction_id,
          paymentIntentId: paymentIntent.id,
        });
        await client.query('ROLLBACK');
        return;
      }

      // Update transaction status
      await client.query(
        `UPDATE payment_transactions
         SET payment_status = 'failed',
             error_message = $1,
             updated_at = NOW()
         WHERE transaction_id = $2`,
        [paymentIntent.last_payment_error?.message || 'Payment failed', transaction.transaction_id]
      );

      // Update purchase status
      await purchaseService.updatePurchaseStatus(
        transaction.purchase_id,
        PurchaseStatus.FAILED
      );

      // Release position back to available
      await client.query(
        `UPDATE positions
         SET status = 'available', updated_at = NOW()
         WHERE position_id = (
           SELECT position_id FROM purchases WHERE purchase_id = $1
         ) AND status = 'reserved'`,
        [transaction.purchase_id]
      );

      await client.query('COMMIT');

      logger.info('Payment failed', {
        transactionId: transaction.transaction_id,
        purchaseId: transaction.purchase_id,
        error: paymentIntent.last_payment_error?.message,
      });

      // Send notification to user
      try {
        const purchase = await purchaseService.getPurchaseById(transaction.purchase_id);
        if (purchase) {
          await notificationService.sendToUser(
            purchase.user_id,
            NotificationType.PAYMENT_FAILED,
            {
              title: '決済に失敗しました',
              body: `決済処理中にエラーが発生しました。${paymentIntent.last_payment_error?.message || 'もう一度お試しください。'}`,
              data: {
                purchase_id: purchase.purchase_id,
                campaign_id: purchase.campaign_id,
              },
            }
          );
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Failed to send payment failure notification', {
          error: errorMessage,
          purchaseId: transaction.purchase_id,
        });
        // Don't throw - notification failure shouldn't fail the error handling
      }
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to handle payment failed', {
        error: errorMessage,
        paymentIntentId: paymentIntent.id,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Handle canceled payment
   */
  private async handlePaymentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get transaction
      const { rows: transactionRows } = await client.query<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE stripe_payment_intent_id = $1',
        [paymentIntent.id]
      );

      if (transactionRows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Idempotency check: Skip if already processed
      if (transaction.payment_status === PaymentStatus.CANCELLED) {
        logger.info('Payment cancellation already processed, skipping', {
          transactionId: transaction.transaction_id,
          paymentIntentId: paymentIntent.id,
        });
        await client.query('ROLLBACK');
        return;
      }

      // Update transaction status
      await client.query(
        `UPDATE payment_transactions
         SET payment_status = 'cancelled',
             updated_at = NOW()
         WHERE transaction_id = $1`,
        [transaction.transaction_id]
      );

      // Update purchase status
      await purchaseService.updatePurchaseStatus(
        transaction.purchase_id,
        PurchaseStatus.CANCELLED
      );

      // Release position back to available
      await client.query(
        `UPDATE positions
         SET status = 'available', updated_at = NOW()
         WHERE position_id = (
           SELECT position_id FROM purchases WHERE purchase_id = $1
         ) AND status = 'reserved'`,
        [transaction.purchase_id]
      );

      await client.query('COMMIT');

      logger.info('Payment canceled', {
        transactionId: transaction.transaction_id,
        purchaseId: transaction.purchase_id,
      });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to handle payment canceled', {
        error: errorMessage,
        paymentIntentId: paymentIntent.id,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Handle charge refund
   */
  private async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get transaction
      const { rows: transactionRows } = await client.query<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE stripe_charge_id = $1',
        [charge.id]
      );

      if (transactionRows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Idempotency check: Skip if already processed
      if (transaction.payment_status === PaymentStatus.REFUNDED) {
        logger.info('Refund already processed, skipping', {
          transactionId: transaction.transaction_id,
          chargeId: charge.id,
        });
        await client.query('ROLLBACK');
        return;
      }

      // Update transaction status
      await client.query(
        `UPDATE payment_transactions
         SET payment_status = 'refunded',
             updated_at = NOW()
         WHERE transaction_id = $1`,
        [transaction.transaction_id]
      );

      // Update purchase status
      await purchaseService.updatePurchaseStatus(
        transaction.purchase_id,
        PurchaseStatus.REFUNDED
      );

      // Release position back to available
      await client.query(
        `UPDATE positions
         SET status = 'available', updated_at = NOW()
         WHERE position_id = (
           SELECT position_id FROM purchases WHERE purchase_id = $1
         ) AND status = 'sold'`,
        [transaction.purchase_id]
      );

      // Rollback campaign statistics
      await client.query(
        `UPDATE campaigns
         SET positions_sold = GREATEST(positions_sold - 1, 0),
             total_revenue = GREATEST(total_revenue - $1, 0),
             updated_at = NOW()
         WHERE campaign_id = (
           SELECT campaign_id FROM purchases WHERE purchase_id = $2
         )`,
        [transaction.amount, transaction.purchase_id]
      );

      await client.query('COMMIT');

      logger.info('Payment refunded', {
        transactionId: transaction.transaction_id,
        purchaseId: transaction.purchase_id,
        amount: charge.amount_refunded,
      });

      // Send notification to user
      try {
        const purchase = await purchaseService.getPurchaseById(transaction.purchase_id);
        if (purchase) {
          await notificationService.sendToUser(
            purchase.user_id,
            NotificationType.PAYMENT_COMPLETED,
            {
              title: '返金が完了しました',
              body: `返金処理が完了しました。返金額: ¥${charge.amount_refunded?.toLocaleString() || '0'}`,
              data: {
                purchase_id: purchase.purchase_id,
                transaction_id: transaction.transaction_id,
                refund_amount: charge.amount_refunded?.toString() || '0',
                type: 'refund',
              },
            }
          );
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Failed to send refund notification', {
          error: errorMessage,
          purchaseId: transaction.purchase_id,
        });
        // Don't throw - notification failure shouldn't fail the refund
      }
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to handle charge refunded', {
        error: errorMessage,
        chargeId: charge.id,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get payment transaction by ID
   */
  async getTransactionById(transactionId: string): Promise<PaymentTransaction | null> {
    try {
      const { rows } = await pool.query<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE transaction_id = $1',
        [transactionId]
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToPaymentTransaction(rows[0]);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get transaction', {
        error: errorMessage,
        transactionId,
      });
      throw error;
    }
  }

  /**
   * Get user payment transactions
   */
  async getUserTransactions(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<PaymentTransaction[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM payment_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      return rows.map(mapRowToPaymentTransaction);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user transactions', {
        error: errorMessage,
        userId,
      });
      throw error;
    }
  }
}

export default new PaymentService();
