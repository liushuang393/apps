import Stripe from 'stripe';
import { pool } from '../config/database.config';
import { stripe, PAYMENT_CONFIG } from '../config/stripe.config';
import mockPaymentService from './mock-payment.service';
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
import { errors } from '../middleware/error.middleware';

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
        throw errors.notFound('Purchase');
      }

      // Verify ownership
      if (purchase.user_id !== userId) {
        throw errors.forbidden('You do not have permission to pay for this purchase');
      }

      // Check if purchase already has a payment or is being processed
      // 目的: 防止为同一购买创建重复的 PaymentIntent
      // 注意点: 检查 COMPLETED, PROCESSING 状态和已存在的 PaymentIntent
      if (purchase.status === PurchaseStatus.COMPLETED) {
        throw errors.badRequest('Purchase already paid');
      }

      // Check for existing active payment transactions
      // 目的: 防止重复支付 - 如果已有 pending/processing 状态的支付交易，则拒绝创建新的
      const { rows: existingTransactions } = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM payment_transactions
         WHERE purchase_id = $1
           AND payment_status IN ('pending', 'processing', 'requires_action')`,
        [dto.purchase_id]
      );

      if (Number.parseInt(existingTransactions[0].count, 10) > 0) {
        throw errors.badRequest('A payment is already in progress for this purchase');
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

      // Generate Stripe idempotency key
      // 目的: 确保 Stripe API 调用的幂等性，防止因网络重试导致重复创建 PaymentIntent
      // 注意点: 使用 purchase_id + user_id + timestamp 生成唯一的幂等性 key
      const stripeIdempotencyKey = `pi_${purchase.purchase_id}_${userId}_${Date.now()}`;

      // 根据环境选择使用真实 Stripe 或假支付
      // 目的: 开发环境可以使用假支付（用于单元测试），生产环境强制使用真实支付
      // 注意点: PAYMENT_CONFIG.useMockPayment 在生产环境已被强制设为 false
      let paymentIntent: Stripe.PaymentIntent;
      
      if (PAYMENT_CONFIG.useMockPayment) {
        logger.info('Using mock payment service', {
          purchaseId: purchase.purchase_id,
          paymentMethod: dto.payment_method,
        });
        paymentIntent = await mockPaymentService.createPaymentIntent(paymentIntentParams);
      } else {
        if (!stripe) {
          throw new Error('Stripe client is not initialized');
        }
        paymentIntent = await stripe.paymentIntents.create(
          paymentIntentParams,
          { idempotencyKey: stripeIdempotencyKey }
        );
      }

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
   * 目的: 确认支付（用于卡支付）
   * I/O: 调用 Stripe API 或假支付服务确认支付
   * 注意点: 根据环境自动切换使用真实或假支付。Mock モードでは DB も更新する。
   */
  async confirmPayment(paymentIntentId: string, paymentMethodId: string): Promise<Stripe.PaymentIntent> {
    try {
      let paymentIntent: Stripe.PaymentIntent;

      // 根据环境选择使用真实 Stripe 或假支付
      if (PAYMENT_CONFIG.useMockPayment) {
        paymentIntent = await mockPaymentService.confirmPaymentIntent(paymentIntentId, {
          payment_method: paymentMethodId,
        });
        logger.info('Payment confirmed (mock)', { paymentIntentId });

        // Mock モードでは Webhook が来ないため、直接 DB を更新する
        // 注意点: 本番環境では Webhook 経由で更新されるため、この処理は不要
        // 重要: 真实环境 Webhook 会更新 payment_transactions, purchases, positions, campaigns 四个表
        if (paymentIntent.status === 'succeeded') {
          await this.handleMockPaymentSucceeded(paymentIntentId);
        }
      } else {
        if (!stripe) {
          throw new Error('Stripe client is not initialized');
        }
        paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
          payment_method: paymentMethodId,
        });
        logger.info('Payment confirmed', { paymentIntentId });
      }

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
   * Confirm a payment with card details (for Web platform)
   * 目的: Web プラットフォーム用に直接カード情報を受け取って支払いを確認
   * I/O: paymentIntentId + カード情報 → PaymentIntent
   * 注意点:
   *   - flutter_stripe は Web で動作しないため、後端で処理
   *   - テスト環境: Stripe テストトークン（tok_visa 等）を使用
   *   - 本番環境: 直接カード処理は PCI DSS 制限あり、Stripe Elements 推奨
   */
  async confirmPaymentWithCard(
    paymentIntentId: string,
    cardDetails: {
      number: string;
      exp_month: number;
      exp_year: number;
      cvc: string;
    }
  ): Promise<Stripe.PaymentIntent> {
    try {
      // Mock モードの場合は既存のロジックを使用
      if (PAYMENT_CONFIG.useMockPayment) {
        logger.info('Confirming payment with card (mock)', { paymentIntentId });
        return this.confirmPayment(paymentIntentId, 'pm_mock_card');
      }

      if (!stripe) {
        throw new Error('Stripe client is not initialized');
      }

      // テスト環境かどうかを判定（sk_test_ キーを使用しているか）
      const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');

      let paymentMethodId: string;

      if (isTestMode) {
        // テスト環境: Stripe のテストトークンを使用
        // 注意: Stripe は PCI DSS 準拠のため、直接カード番号を API に送信することを禁止
        // テスト環境ではテストトークンを使用して回避
        // https://stripe.com/docs/testing#cards
        const testToken = this.getTestTokenFromCardNumber(cardDetails.number);
        
        logger.info('Using test token for web payment', {
          paymentIntentId,
          testToken,
          cardLastFour: cardDetails.number.slice(-4),
        });

        // テストトークンから PaymentMethod を作成
        const paymentMethod = await stripe.paymentMethods.create({
          type: 'card',
          card: {
            token: testToken,
          },
        });
        paymentMethodId = paymentMethod.id;
      } else {
        // 本番環境: 直接カード処理は PCI DSS 制限があるため、エラーを返す
        // 本番では Stripe.js を使用してクライアント側で PaymentMethod を作成すべき
        logger.error('Direct card processing is not allowed in production mode');
        throw new Error(
          'Direct card processing is not available in production. ' +
          'Please use Stripe.js on the client side to create a PaymentMethod.'
        );
      }

      // PaymentIntent を確認
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      logger.info('Payment confirmed with card (web)', {
        paymentIntentId,
        status: paymentIntent.status,
      });

      return paymentIntent;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to confirm payment with card', {
        error: errorMessage,
        paymentIntentId,
      });
      throw error;
    }
  }

  /**
   * カード番号からテストトークンを取得
   * 目的: Stripe テスト環境用のトークンマッピング
   * 注意点: テスト環境でのみ使用、本番では使用不可
   * https://stripe.com/docs/testing#cards
   */
  private getTestTokenFromCardNumber(cardNumber: string): string {
    // カード番号の空白を除去
    const cleanNumber = cardNumber.replace(/\s/g, '');

    // Stripe テストカード番号 → テストトークン マッピング
    const testCardTokens: Record<string, string> = {
      '4242424242424242': 'tok_visa',                    // Visa
      '4000056655665556': 'tok_visa_debit',              // Visa (debit)
      '5555555555554444': 'tok_mastercard',              // Mastercard
      '5200828282828210': 'tok_mastercard_debit',        // Mastercard (debit)
      '378282246310005': 'tok_amex',                     // American Express
      '6011111111111117': 'tok_discover',                // Discover
      '3056930009020004': 'tok_diners',                  // Diners Club
      '3566002020360505': 'tok_jcb',                     // JCB
      '6200000000000005': 'tok_unionpay',                // UnionPay
      // 3D Secure テストカード
      '4000000000003220': 'tok_visa',                    // 3DS2 認証必須
      '4000000000003063': 'tok_visa',                    // 3DS2 認証必須
      // 失敗テストカード
      '4000000000000002': 'tok_chargeDeclined',          // 拒否
      '4000000000009995': 'tok_chargeDeclinedInsufficientFunds', // 残高不足
    };

    // マッチするトークンを返す、なければデフォルトで tok_visa
    return testCardTokens[cleanNumber] || 'tok_visa';
  }

  /**
   * Handle mock payment succeeded
   * 目的: Mock 模式下直接更新数据库（无 Webhook）
   * I/O: paymentIntentId → 更新 payment_transactions, purchases, positions, campaigns
   * 注意点: 这个逻辑必须与 handlePaymentSucceeded 保持一致
   */
  private async handleMockPaymentSucceeded(paymentIntentId: string): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Mock 用の charge_id を生成（refund テストで必要）
      const mockChargeId = `ch_mock_${paymentIntentId.replace('pi_', '')}`;

      // Get transaction
      const { rows: transactionRows } = await client.query<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE stripe_payment_intent_id = $1',
        [paymentIntentId]
      );

      if (transactionRows.length === 0) {
        logger.warn('Mock: Payment transaction not found', { paymentIntentId });
        await client.query('ROLLBACK');
        return;
      }

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Skip if already processed (idempotency)
      if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
        logger.info('Mock: Payment already processed, skipping', { paymentIntentId });
        await client.query('ROLLBACK');
        return;
      }

      // 1. Update payment_transactions
      await client.query(
        `UPDATE payment_transactions
         SET payment_status = 'succeeded',
             stripe_charge_id = $1,
             paid_at = NOW(),
             updated_at = NOW()
         WHERE transaction_id = $2`,
        [mockChargeId, transaction.transaction_id]
      );

      // 2. Update purchases status to COMPLETED
      await purchaseService.updatePurchaseStatus(
        transaction.purchase_id,
        PurchaseStatus.COMPLETED
      );

      // 3. Update positions status to 'sold'
      // 注意: sold_timestamp_consistency 約束により、status='sold' の場合は sold_at も設定する必要がある
      await client.query(
        `UPDATE positions
         SET status = 'sold', user_id = $1, sold_at = NOW(), updated_at = NOW()
         WHERE position_id = (
           SELECT position_id FROM purchases WHERE purchase_id = $2
         )`,
        [transaction.user_id, transaction.purchase_id]
      );

      // 4. Update campaign statistics
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

      logger.info('Mock: Payment succeeded and all tables updated', {
        paymentIntentId,
        transactionId: transaction.transaction_id,
        purchaseId: transaction.purchase_id,
        mockChargeId,
      });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Mock: Failed to handle payment succeeded', {
        error: errorMessage,
        paymentIntentId,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get konbini payment details
   * 目的: 获取 Konbini 支付详情（支付编号、过期时间等）
   * I/O: 从 Stripe 或假支付服务获取支付信息
   * 注意点: 根据环境自动切换使用真实或假支付
   */
  async getKonbiniPaymentInfo(paymentIntentId: string): Promise<KonbiniPaymentInfo | null> {
    try {
      let paymentIntent: Stripe.PaymentIntent;
      let paymentMethod: Stripe.PaymentMethod | null = null;

      // 根据环境选择使用真实 Stripe 或假支付
      if (PAYMENT_CONFIG.useMockPayment) {
        paymentIntent = await mockPaymentService.retrievePaymentIntent(paymentIntentId);
        if (paymentIntent.payment_method) {
          try {
            paymentMethod = await mockPaymentService.retrievePaymentMethod(
              paymentIntent.payment_method as string
            );
          } catch {
            // Payment method might not exist in mock service
          }
        }
      } else {
        if (!stripe) {
          throw new Error('Stripe client is not initialized');
        }
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.payment_method) {
          paymentMethod = await stripe.paymentMethods.retrieve(
            paymentIntent.payment_method as string
          );
        }
      }

      if (paymentMethod && paymentMethod.type === 'konbini' && paymentMethod.konbini) {
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

      // Validate payment amount matches transaction amount
      // 目的: 确保 Webhook 返回的金额与数据库记录一致（安全验证）
      // 注意点: 如果金额不一致，记录警告但继续处理（可能是汇率或手续费差异）
      if (paymentIntent.amount !== transaction.amount) {
        logger.warn('Payment amount mismatch detected', {
          transactionId: transaction.transaction_id,
          paymentIntentId: paymentIntent.id,
          paymentIntentAmount: paymentIntent.amount,
          transactionAmount: transaction.amount,
          difference: paymentIntent.amount - transaction.amount,
        });
        // Continue processing but log the discrepancy for investigation
        // In production, you might want to alert or take additional action
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
      // 注意: sold_timestamp_consistency 約束により、status='sold' の場合は sold_at も設定する必要がある
      // 注意: position_user_consistency 約束により、status='sold' の場合は user_id も設定する必要がある
      await client.query(
        `UPDATE positions
         SET status = 'sold', user_id = $1, sold_at = NOW(), updated_at = NOW()
         WHERE position_id = (
           SELECT position_id FROM purchases WHERE purchase_id = $2
         )`,
        [transaction.user_id, transaction.purchase_id]
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
   * Handle charge refund (supports both full and partial refunds)
   * 目的: 处理 Stripe 退款 Webhook 事件
   * I/O: Stripe Charge 对象 → 更新数据库状态
   * 注意点: 区分全额退款和部分退款，只有全额退款才释放位置
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
        logger.warn('Transaction not found for refund', { chargeId: charge.id });
        await client.query('ROLLBACK');
        return;
      }

      const transaction = mapRowToPaymentTransaction(transactionRows[0]);

      // Idempotency check: Skip if already fully processed
      if (transaction.payment_status === PaymentStatus.REFUNDED) {
        logger.info('Refund already processed, skipping', {
          transactionId: transaction.transaction_id,
          chargeId: charge.id,
        });
        await client.query('ROLLBACK');
        return;
      }

      // Get refund amount and validate
      // 目的: 验证退款金额的有效性
      const refundedAmount = charge.amount_refunded || 0;
      const originalAmount = charge.amount;
      const isFullRefund = refundedAmount >= originalAmount;

      // Validate refund amount does not exceed original payment
      // 目的: 防止退款金额超过原支付金额（安全验证）
      if (refundedAmount > originalAmount) {
        logger.error('Refund amount exceeds original payment', {
          chargeId: charge.id,
          refundedAmount,
          originalAmount,
          transactionAmount: transaction.amount,
        });
        await client.query('ROLLBACK');
        throw new Error('Invalid refund: amount exceeds original payment');
      }

      // Validate transaction amount matches Stripe charge amount
      // 目的: 确保数据库记录与 Stripe 数据一致
      if (transaction.amount !== originalAmount) {
        logger.warn('Transaction amount mismatch with Stripe charge', {
          transactionId: transaction.transaction_id,
          transactionAmount: transaction.amount,
          chargeAmount: originalAmount,
        });
        // Continue processing but log the discrepancy
      }

      logger.info('Processing refund', {
        transactionId: transaction.transaction_id,
        chargeId: charge.id,
        refundedAmount,
        originalAmount,
        isFullRefund,
      });

      if (isFullRefund) {
        // Full refund: Update status to refunded
        // 目的: 全额退款时，标记交易为已退款
        await client.query(
          `UPDATE payment_transactions
           SET payment_status = 'refunded',
               refunded_amount = $1,
               updated_at = NOW()
           WHERE transaction_id = $2`,
          [refundedAmount, transaction.transaction_id]
        );

        // Update purchase status
        await purchaseService.updatePurchaseStatus(
          transaction.purchase_id,
          PurchaseStatus.REFUNDED
        );

        // Release position back to available (only for full refund)
        // 目的: 全额退款时释放位置，部分退款保留位置
        // 注意: sold_timestamp_consistency 約束により、status='available' の場合は sold_at を NULL にする必要がある
        await client.query(
          `UPDATE positions
           SET status = 'available', user_id = NULL, sold_at = NULL, updated_at = NOW()
           WHERE position_id = (
             SELECT position_id FROM purchases WHERE purchase_id = $1
           ) AND status = 'sold'`,
          [transaction.purchase_id]
        );

        // Rollback campaign statistics (full refund)
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
      } else {
        // Partial refund: Only update refunded_amount, keep position and status
        // 目的: 部分退款时，只记录退款金额，不改变状态
        await client.query(
          `UPDATE payment_transactions
           SET refunded_amount = $1,
               updated_at = NOW()
           WHERE transaction_id = $2`,
          [refundedAmount, transaction.transaction_id]
        );

        // Partially refund revenue (but keep position_sold count)
        // 目的: 部分退款时，减少收入但保留位置
        await client.query(
          `UPDATE campaigns
           SET total_revenue = GREATEST(total_revenue - $1, 0),
               updated_at = NOW()
           WHERE campaign_id = (
             SELECT campaign_id FROM purchases WHERE purchase_id = $2
           )`,
          [refundedAmount, transaction.purchase_id]
        );

        logger.info('Partial refund processed', {
          transactionId: transaction.transaction_id,
          refundedAmount,
          remainingAmount: originalAmount - refundedAmount,
        });
      }

      await client.query('COMMIT');

      logger.info('Payment refund processed', {
        transactionId: transaction.transaction_id,
        purchaseId: transaction.purchase_id,
        refundedAmount,
        isFullRefund,
      });

      // Send notification to user
      try {
        const purchase = await purchaseService.getPurchaseById(transaction.purchase_id);
        if (purchase) {
          const notificationTitle = isFullRefund ? '返金が完了しました' : '一部返金が完了しました';
          const notificationBody = isFullRefund
            ? `返金処理が完了しました。返金額: ¥${refundedAmount.toLocaleString()}`
            : `一部返金処理が完了しました。返金額: ¥${refundedAmount.toLocaleString()}`;

          await notificationService.sendToUser(
            purchase.user_id,
            NotificationType.PAYMENT_COMPLETED,
            {
              title: notificationTitle,
              body: notificationBody,
              data: {
                purchase_id: purchase.purchase_id,
                transaction_id: transaction.transaction_id,
                refund_amount: refundedAmount.toString(),
                is_full_refund: isFullRefund.toString(),
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

  /**
   * Initiate a refund (Admin function)
   * 目的: 管理员主动发起退款
   * I/O: transactionId, amount(可选), reason → Stripe Refund 对象
   * 注意点: 只有 ADMIN 用户可以调用，验证金额，支持部分退款
   */
  async initiateRefund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<Stripe.Refund> {
    try {
      // Get transaction
      const transaction = await this.getTransactionById(transactionId);

      if (!transaction) {
        throw errors.notFound('Transaction');
      }

      // Validate transaction status
      // 注意点: REFUNDED 状態のトランザクションは再度退款できない
      if (transaction.payment_status === PaymentStatus.REFUNDED) {
        throw errors.badRequest('Transaction has already been fully refunded');
      }
      if (transaction.payment_status !== PaymentStatus.SUCCEEDED) {
        throw errors.badRequest(`Cannot refund transaction with status: ${transaction.payment_status}`);
      }

      // Validate charge ID exists
      if (!transaction.stripe_charge_id) {
        throw errors.badRequest('No charge ID found for this transaction');
      }

      // Validate refund amount
      const refundAmount = amount || transaction.amount;
      if (refundAmount <= 0) {
        throw errors.badRequest('Refund amount must be positive');
      }

      if (refundAmount > transaction.amount) {
        throw errors.badRequest('Refund amount exceeds original payment amount');
      }

      // Create Stripe refund
      // 目的: 通过 Stripe API 发起退款
      const refundParams: Stripe.RefundCreateParams = {
        charge: transaction.stripe_charge_id,
        amount: refundAmount,
        reason: 'requested_by_customer',
        metadata: {
          transaction_id: transaction.transaction_id,
          purchase_id: transaction.purchase_id,
          admin_reason: reason || 'Admin initiated refund',
          refund_type: refundAmount === transaction.amount ? 'full' : 'partial',
        },
      };

      // Generate idempotency key for Stripe refund
      const stripeIdempotencyKey = `refund_${transactionId}_${refundAmount}_${Date.now()}`;

      // 根据环境选择使用真实 Stripe 或假支付
      let refund: Stripe.Refund;
      if (PAYMENT_CONFIG.useMockPayment) {
        // 使用假支付服务创建退款
        // 注意点: 假支付服务需要 payment_intent_id，我们需要从 transaction 获取
        if (!transaction.stripe_payment_intent_id) {
          throw new Error('No payment intent ID found for mock refund');
        }
        refund = await mockPaymentService.createRefund(
          transaction.stripe_payment_intent_id,
          { amount: refundAmount, reason }
        );
        logger.info('Refund created (mock)', {
          refundId: refund.id,
          transactionId,
          amount: refundAmount,
        });
      } else {
        if (!stripe) {
          throw new Error('Stripe client is not initialized');
        }
        refund = await stripe.refunds.create(
          refundParams,
          { idempotencyKey: stripeIdempotencyKey }
        );
        logger.info('Refund created', {
          refundId: refund.id,
          transactionId,
          amount: refundAmount,
        });
      }

      logger.info('Refund initiated successfully', {
        transactionId,
        refundId: refund.id,
        amount: refundAmount,
        reason,
      });

      // Mock モードでは Webhook が来ないため、直接 DB を更新する
      // 注意点: 本番環境では Webhook 経由で更新されるため、この処理は不要
      if (PAYMENT_CONFIG.useMockPayment) {
        // 全額退款の場合は REFUNDED、部分退款の場合は SUCCEEDED のまま（refunded_amount で追跡）
        const newStatus = refundAmount === transaction.amount
          ? PaymentStatus.REFUNDED
          : PaymentStatus.SUCCEEDED;
        await pool.query(
          `UPDATE payment_transactions
           SET payment_status = $1,
               refunded_amount = COALESCE(refunded_amount, 0) + $2,
               updated_at = NOW()
           WHERE transaction_id = $3`,
          [newStatus, refundAmount, transactionId]
        );
        logger.info('Mock: Updated transaction status after refund', {
          transactionId,
          newStatus,
          refundAmount
        });
      }

      return refund;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to initiate refund', {
        error: errorMessage,
        transactionId,
        amount,
      });
      throw error;
    }
  }

  /**
   * Get transaction by purchase ID
   * 目的: 通过购买 ID 查询支付交易
   */
  async getTransactionByPurchaseId(purchaseId: string): Promise<PaymentTransaction | null> {
    try {
      const { rows } = await pool.query<PaymentTransaction>(
        `SELECT * FROM payment_transactions
         WHERE purchase_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [purchaseId]
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToPaymentTransaction(rows[0]);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get transaction by purchase ID', {
        error: errorMessage,
        purchaseId,
      });
      throw error;
    }
  }

  /**
   * Clean up expired Konbini payments
   * 目的: 清理过期的 Konbini 支付，释放位置
   * I/O: 无输入 → 清理的交易数量
   * 注意点: Konbini 支付有效期为4天，过期后自动取消
   */
  async cleanupExpiredKonbiniPayments(): Promise<number> {
    const client = await pool.connect();
    let cleanedCount = 0;

    try {
      await client.query('BEGIN');

      // Find expired Konbini transactions
      // 目的: 查找超过4天未完成的 Konbini 支付
      const { rows: expiredTransactions } = await client.query<PaymentTransaction>(
        `SELECT * FROM payment_transactions
         WHERE payment_method = 'konbini'
           AND payment_status IN ('pending', 'requires_action')
           AND created_at < NOW() - INTERVAL '4 days'
         FOR UPDATE SKIP LOCKED`
      );

      logger.info('Found expired Konbini payments', {
        count: expiredTransactions.length,
      });

      for (const transaction of expiredTransactions) {
        try {
          // Cancel the PaymentIntent in Stripe
          // 目的: 在 Stripe 端取消未完成的支付
          // 注意点: stripe が null の場合（Mock モード）はスキップ
          if (transaction.stripe_payment_intent_id && stripe) {
            try {
              await stripe.paymentIntents.cancel(transaction.stripe_payment_intent_id);
            } catch (stripeError: unknown) {
              const errorMsg = stripeError instanceof Error ? stripeError.message : 'Unknown';
              // PaymentIntent may already be canceled or expired
              logger.warn('Failed to cancel PaymentIntent in Stripe', {
                paymentIntentId: transaction.stripe_payment_intent_id,
                error: errorMsg,
              });
            }
          }

          // Update transaction status
          await client.query(
            `UPDATE payment_transactions
             SET payment_status = 'cancelled',
                 error_message = 'Konbini payment expired',
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
             SET status = 'available', user_id = NULL, updated_at = NOW()
             WHERE position_id = (
               SELECT position_id FROM purchases WHERE purchase_id = $1
             ) AND status = 'reserved'`,
            [transaction.purchase_id]
          );

          cleanedCount++;

          logger.info('Cleaned up expired Konbini payment', {
            transactionId: transaction.transaction_id,
            purchaseId: transaction.purchase_id,
          });
        } catch (txError: unknown) {
          const errorMsg = txError instanceof Error ? txError.message : 'Unknown';
          logger.error('Failed to clean up individual Konbini payment', {
            transactionId: transaction.transaction_id,
            error: errorMsg,
          });
          // Continue with other transactions
        }
      }

      await client.query('COMMIT');

      logger.info('Konbini cleanup completed', {
        cleanedCount,
        totalExpired: expiredTransactions.length,
      });

      return cleanedCount;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cleanup expired Konbini payments', {
        error: errorMessage,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Start scheduled cleanup task
   * 目的: 启动定时任务清理过期的 Konbini 支付
   * 注意点: 每小时运行一次
   */
  startScheduledCleanup(): void {
    // Run cleanup every hour
    const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    logger.info('Starting Konbini payment cleanup scheduler', {
      intervalMs: CLEANUP_INTERVAL_MS,
    });

    // Run immediately on startup
    this.cleanupExpiredKonbiniPayments().catch((err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : 'Unknown';
      logger.error('Initial Konbini cleanup failed', { error: errorMsg });
    });

    // Schedule periodic cleanup
    setInterval(() => {
      this.cleanupExpiredKonbiniPayments().catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : 'Unknown';
        logger.error('Scheduled Konbini cleanup failed', { error: errorMsg });
      });
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Mock: Complete konbini payment (DEVELOPMENT ONLY)
   * 目的: 开发环境下模拟便利店支付完成（无 Webhook）
   * I/O: paymentIntentId, userId → 更新 DB
   * 注意点: 仅在 Mock 模式下可用，生产环境禁止
   */
  async mockCompleteKonbiniPayment(paymentIntentId: string, userId: string): Promise<void> {
    // 安全检查
    if (!PAYMENT_CONFIG.useMockPayment) {
      throw new Error('mockCompleteKonbiniPayment is only available in mock payment mode');
    }

    // 验证交易存在且属于该用户
    const { rows } = await pool.query<PaymentTransaction>(
      'SELECT * FROM payment_transactions WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );

    if (rows.length === 0) {
      throw errors.notFound('Payment transaction');
    }

    const transaction = mapRowToPaymentTransaction(rows[0]);

    if (transaction.user_id !== userId) {
      throw errors.forbidden('You do not own this payment');
    }

    if (transaction.payment_method !== PaymentMethod.KONBINI) {
      throw errors.badRequest('This is not a konbini payment');
    }

    if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
      logger.info('Mock: Konbini payment already completed', { paymentIntentId });
      return;
    }

    // 使用 handleMockPaymentSucceeded 更新所有表
    await this.handleMockPaymentSucceeded(paymentIntentId);

    logger.info('Mock: Konbini payment completed', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      userId,
    });
  }
}

export default new PaymentService();
