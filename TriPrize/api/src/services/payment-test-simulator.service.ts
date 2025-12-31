import Stripe from 'stripe';
import { pool } from '../config/database.config';
import { PAYMENT_CONFIG } from '../config/stripe.config';
import {
  PaymentTransaction,
  PaymentMethod,
  PaymentStatus,
  mapRowToPaymentTransaction,
} from '../models/payment.entity';
import paymentService from './payment.service';
import { generateUUID } from '../utils/crypto.util';
import logger from '../utils/logger.util';
import { errors } from '../middleware/error.middleware';

/**
 * 支付失败原因枚举
 * 目的: 模拟各种真实的支付失败场景
 * 参考: https://stripe.com/docs/testing#cards
 */
export enum PaymentFailureReason {
  CARD_DECLINED = 'card_declined',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  EXPIRED_CARD = 'expired_card',
  PROCESSING_ERROR = 'processing_error',
  INCORRECT_CVC = 'incorrect_cvc',
  FRAUD_SUSPECTED = 'fraudulent',
  LOST_CARD = 'lost_card',
  STOLEN_CARD = 'stolen_card',
}

/**
 * 失败原因对应的错误消息
 */
const FAILURE_MESSAGES: Record<PaymentFailureReason, string> = {
  [PaymentFailureReason.CARD_DECLINED]: 'Your card was declined.',
  [PaymentFailureReason.INSUFFICIENT_FUNDS]: 'Your card has insufficient funds.',
  [PaymentFailureReason.EXPIRED_CARD]: 'Your card has expired.',
  [PaymentFailureReason.PROCESSING_ERROR]: 'An error occurred while processing your card.',
  [PaymentFailureReason.INCORRECT_CVC]: 'Your card\'s security code is incorrect.',
  [PaymentFailureReason.FRAUD_SUSPECTED]: 'This transaction has been flagged as potentially fraudulent.',
  [PaymentFailureReason.LOST_CARD]: 'The card has been reported lost.',
  [PaymentFailureReason.STOLEN_CARD]: 'The card has been reported stolen.',
};

/**
 * 模拟结果接口
 */
export interface SimulationResult {
  success: boolean;
  eventType: string;
  paymentIntentId: string;
  transactionId: string;
  previousStatus: PaymentStatus;
  newStatus: string;
  message: string;
}

/**
 * Payment Test Simulator Service
 * 目的: 在开发/测试环境中模拟 Stripe Webhook 事件，解决测试流程断层问题
 * I/O: 接收 PaymentIntent ID，触发对应的 webhook 处理逻辑
 * 注意点: 
 *   - 仅在非生产环境可用
 *   - 复用现有的 webhook handler 确保逻辑一致
 *   - 完整记录所有模拟操作日志
 */
export class PaymentTestSimulatorService {
  /**
   * 安全检查 - 确保只在测试环境使用
   */
  private ensureTestEnvironment(): void {
    if (PAYMENT_CONFIG.isProduction) {
      throw errors.forbidden('Payment simulation is not available in production environment');
    }
  }

  /**
   * 获取支付交易信息
   */
  private async getTransaction(paymentIntentId: string): Promise<PaymentTransaction> {
    const { rows } = await pool.query<PaymentTransaction>(
      'SELECT * FROM payment_transactions WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );

    if (rows.length === 0) {
      throw errors.notFound(`Payment transaction with PaymentIntent ID: ${paymentIntentId}`);
    }

    return mapRowToPaymentTransaction(rows[0]);
  }

  /**
   * 创建模拟的 Stripe Event
   */
  private createMockEvent(
    eventType: string,
    data: Stripe.PaymentIntent | Stripe.Charge
  ): Stripe.Event {
    return {
      id: `evt_test_${generateUUID().substring(0, 24)}`,
      object: 'event',
      api_version: '2025-02-24.acacia',
      created: Math.floor(Date.now() / 1000),
      type: eventType,
      data: { object: data },
      livemode: false,
      pending_webhooks: 0,
      request: null,
    } as Stripe.Event;
  }

  /**
   * 创建模拟的 PaymentIntent 对象
   */
  private createMockPaymentIntent(
    transaction: PaymentTransaction,
    status: Stripe.PaymentIntent.Status,
    additionalFields?: Partial<Stripe.PaymentIntent>
  ): Stripe.PaymentIntent {
    return {
      id: transaction.stripe_payment_intent_id!,
      object: 'payment_intent',
      amount: transaction.amount,
      currency: transaction.currency,
      status,
      client_secret: `${transaction.stripe_payment_intent_id}_secret_test`,
      latest_charge: `ch_test_${generateUUID().substring(0, 16)}`,
      payment_method: `pm_test_${generateUUID().substring(0, 16)}`,
      payment_method_types: [transaction.payment_method],
      metadata: {
        purchase_id: transaction.purchase_id,
        user_id: transaction.user_id,
      },
      created: Math.floor(transaction.created_at.getTime() / 1000),
      livemode: false,
      ...additionalFields,
    } as Stripe.PaymentIntent;
  }

  /**
   * 模拟支付成功
   * 目的: 触发 payment_intent.succeeded webhook
   */
  async simulatePaymentSucceed(paymentIntentId: string): Promise<SimulationResult> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const previousStatus = transaction.payment_status;

    // 验证当前状态允许模拟成功
    if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
      throw errors.badRequest('Payment already succeeded');
    }
    if (transaction.payment_status === PaymentStatus.REFUNDED) {
      throw errors.badRequest('Payment was refunded, cannot simulate succeed');
    }

    logger.info('Simulating payment success', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
    });

    // 创建模拟的 PaymentIntent 和 Event
    const mockPaymentIntent = this.createMockPaymentIntent(transaction, 'succeeded');
    const mockEvent = this.createMockEvent('payment_intent.succeeded', mockPaymentIntent);

    // 调用现有的 webhook handler
    await paymentService.handleWebhook(mockEvent);

    logger.info('Payment success simulated', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      eventId: mockEvent.id,
    });

    return {
      success: true,
      eventType: 'payment_intent.succeeded',
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
      newStatus: 'succeeded',
      message: '支払いが正常に完了しました。DB とポジションが更新されました。',
    };
  }

  /**
   * 模拟支付失败
   * 目的: 触发 payment_intent.payment_failed webhook
   */
  async simulatePaymentFailed(
    paymentIntentId: string,
    reason: PaymentFailureReason = PaymentFailureReason.CARD_DECLINED
  ): Promise<SimulationResult> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const previousStatus = transaction.payment_status;

    // 验证当前状态允许模拟失败
    if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
      throw errors.badRequest('Payment already succeeded, cannot simulate failure');
    }
    if (transaction.payment_status === PaymentStatus.FAILED) {
      throw errors.badRequest('Payment already failed');
    }

    logger.info('Simulating payment failure', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      reason,
      previousStatus,
    });

    const errorMessage = FAILURE_MESSAGES[reason] || 'Payment failed';

    const mockPaymentIntent = this.createMockPaymentIntent(transaction, 'requires_payment_method', {
      last_payment_error: {
        code: reason,
        message: errorMessage,
        type: 'card_error',
        decline_code: reason,
      } as Stripe.PaymentIntent.LastPaymentError,
    });

    const mockEvent = this.createMockEvent('payment_intent.payment_failed', mockPaymentIntent);
    await paymentService.handleWebhook(mockEvent);

    logger.info('Payment failure simulated', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      reason,
      eventId: mockEvent.id,
    });

    return {
      success: true,
      eventType: 'payment_intent.payment_failed',
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
      newStatus: 'failed',
      message: `支払いが失敗しました: ${errorMessage}`,
    };
  }

  /**
   * 模拟支付取消
   * 目的: 触发 payment_intent.canceled webhook
   */
  async simulatePaymentCanceled(paymentIntentId: string): Promise<SimulationResult> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const previousStatus = transaction.payment_status;

    if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
      throw errors.badRequest('Payment already succeeded, use refund instead');
    }
    if (transaction.payment_status === PaymentStatus.CANCELLED) {
      throw errors.badRequest('Payment already canceled');
    }

    logger.info('Simulating payment cancellation', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
    });

    const mockPaymentIntent = this.createMockPaymentIntent(transaction, 'canceled');
    const mockEvent = this.createMockEvent('payment_intent.canceled', mockPaymentIntent);
    await paymentService.handleWebhook(mockEvent);

    logger.info('Payment cancellation simulated', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      eventId: mockEvent.id,
    });

    return {
      success: true,
      eventType: 'payment_intent.canceled',
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
      newStatus: 'cancelled',
      message: '支払いがキャンセルされました。ポジションが解放されました。',
    };
  }

  /**
   * 模拟退款
   * 目的: 触发 charge.refunded webhook
   */
  async simulateRefund(
    paymentIntentId: string,
    options?: { amount?: number; reason?: string }
  ): Promise<SimulationResult> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const previousStatus = transaction.payment_status;

    if (transaction.payment_status !== PaymentStatus.SUCCEEDED) {
      throw errors.badRequest(`Cannot refund payment with status: ${transaction.payment_status}`);
    }
    if (!transaction.stripe_charge_id) {
      // 模拟成功的支付通常会生成 charge_id，但如果没有，我们生成一个
      const mockChargeId = `ch_test_${generateUUID().substring(0, 16)}`;
      await pool.query(
        'UPDATE payment_transactions SET stripe_charge_id = $1 WHERE transaction_id = $2',
        [mockChargeId, transaction.transaction_id]
      );
      transaction.stripe_charge_id = mockChargeId;
    }

    const refundAmount = options?.amount || transaction.amount;
    const isFullRefund = refundAmount >= transaction.amount;

    logger.info('Simulating refund', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      refundAmount,
      isFullRefund,
      previousStatus,
    });

    // 创建模拟的 Charge 对象
    const mockCharge: Stripe.Charge = {
      id: transaction.stripe_charge_id,
      object: 'charge',
      amount: transaction.amount,
      amount_refunded: refundAmount,
      refunded: isFullRefund,
      currency: transaction.currency,
      payment_intent: transaction.stripe_payment_intent_id,
      status: 'succeeded',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
    } as Stripe.Charge;

    const mockEvent = this.createMockEvent('charge.refunded', mockCharge);
    await paymentService.handleWebhook(mockEvent);

    logger.info('Refund simulated', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      refundAmount,
      isFullRefund,
      eventId: mockEvent.id,
    });

    return {
      success: true,
      eventType: 'charge.refunded',
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
      newStatus: isFullRefund ? 'refunded' : 'partially_refunded',
      message: isFullRefund
        ? `全額返金が完了しました（¥${refundAmount.toLocaleString()}）`
        : `一部返金が完了しました（¥${refundAmount.toLocaleString()}）`,
    };
  }

  /**
   * 模拟便利店支付完成
   * 目的: Konbini 支付在用户去便利店付款后，模拟 Stripe 通知
   */
  async simulateKonbiniComplete(paymentIntentId: string): Promise<SimulationResult> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const previousStatus = transaction.payment_status;

    if (transaction.payment_method !== PaymentMethod.KONBINI) {
      throw errors.badRequest('This is not a konbini payment');
    }
    if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
      throw errors.badRequest('Konbini payment already completed');
    }

    logger.info('Simulating konbini payment completion', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
    });

    // 便利店支付完成使用相同的 succeeded 处理逻辑
    const mockPaymentIntent = this.createMockPaymentIntent(transaction, 'succeeded');
    const mockEvent = this.createMockEvent('payment_intent.succeeded', mockPaymentIntent);
    await paymentService.handleWebhook(mockEvent);

    logger.info('Konbini payment completion simulated', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      eventId: mockEvent.id,
    });

    return {
      success: true,
      eventType: 'payment_intent.succeeded',
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
      newStatus: 'succeeded',
      message: 'コンビニ支払いが完了しました。店舗での支払いがシミュレートされました。',
    };
  }

  /**
   * 模拟便利店支付过期
   * 目的: Konbini 支付在 4 天后未付款，模拟过期
   */
  async simulateKonbiniExpired(paymentIntentId: string): Promise<SimulationResult> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const previousStatus = transaction.payment_status;

    if (transaction.payment_method !== PaymentMethod.KONBINI) {
      throw errors.badRequest('This is not a konbini payment');
    }
    if (transaction.payment_status === PaymentStatus.SUCCEEDED) {
      throw errors.badRequest('Konbini payment already completed, cannot expire');
    }
    if (transaction.payment_status === PaymentStatus.CANCELLED) {
      throw errors.badRequest('Konbini payment already expired/cancelled');
    }

    logger.info('Simulating konbini payment expiration', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
    });

    const mockPaymentIntent = this.createMockPaymentIntent(transaction, 'canceled', {
      cancellation_reason: 'expired',
    } as Partial<Stripe.PaymentIntent>);
    const mockEvent = this.createMockEvent('payment_intent.canceled', mockPaymentIntent);
    await paymentService.handleWebhook(mockEvent);

    logger.info('Konbini payment expiration simulated', {
      paymentIntentId,
      transactionId: transaction.transaction_id,
      eventId: mockEvent.id,
    });

    return {
      success: true,
      eventType: 'payment_intent.canceled',
      paymentIntentId,
      transactionId: transaction.transaction_id,
      previousStatus,
      newStatus: 'cancelled',
      message: 'コンビニ支払いが期限切れになりました（4日経過をシミュレート）',
    };
  }

  /**
   * 获取支付状态和可用的模拟操作
   */
  async getPaymentStatus(paymentIntentId: string): Promise<{
    transaction: PaymentTransaction;
    availableActions: string[];
    description: string;
  }> {
    this.ensureTestEnvironment();

    const transaction = await this.getTransaction(paymentIntentId);
    const availableActions: string[] = [];
    let description = '';

    switch (transaction.payment_status) {
      case PaymentStatus.PENDING:
      case PaymentStatus.PROCESSING:
        availableActions.push('succeed', 'fail', 'cancel');
        if (transaction.payment_method === PaymentMethod.KONBINI) {
          availableActions.push('konbini-complete', 'konbini-expire');
        }
        description = '支払いが処理待ちです。成功/失敗/キャンセルをシミュレートできます。';
        break;

      case PaymentStatus.SUCCEEDED:
        availableActions.push('refund');
        description = '支払いが完了しています。返金をシミュレートできます。';
        break;

      case PaymentStatus.FAILED:
        description = '支払いが失敗しました。再試行するには新しい PaymentIntent が必要です。';
        break;

      case PaymentStatus.CANCELLED:
        description = '支払いがキャンセルされました。';
        break;

      case PaymentStatus.REFUNDED:
        description = '支払いが返金されました。';
        break;

      default:
        description = `現在のステータス: ${transaction.payment_status}`;
    }

    return { transaction, availableActions, description };
  }

  /**
   * 获取所有可用的测试场景
   */
  getAvailableScenarios(): {
    scenarios: Array<{
      action: string;
      description: string;
      endpoint: string;
      requiredStatus: string[];
      body?: string;
    }>;
  } {
    this.ensureTestEnvironment();

    return {
      scenarios: [
        {
          action: 'succeed',
          description: '支払いを成功させる - DBとポジションを更新',
          endpoint: 'POST /api/test/payments/:paymentIntentId/simulate/succeed',
          requiredStatus: ['pending', 'processing', 'requires_action'],
        },
        {
          action: 'fail',
          description: '支払いを失敗させる - エラー理由を指定可能',
          endpoint: 'POST /api/test/payments/:paymentIntentId/simulate/fail',
          requiredStatus: ['pending', 'processing', 'requires_action'],
          body: '{ "reason": "card_declined" | "insufficient_funds" | ... }',
        },
        {
          action: 'cancel',
          description: '支払いをキャンセル - ポジションを解放',
          endpoint: 'POST /api/test/payments/:paymentIntentId/simulate/cancel',
          requiredStatus: ['pending', 'processing', 'requires_action'],
        },
        {
          action: 'refund',
          description: '返金を実行 - 全額または一部返金',
          endpoint: 'POST /api/test/payments/:paymentIntentId/simulate/refund',
          requiredStatus: ['succeeded'],
          body: '{ "amount"?: number, "reason"?: string }',
        },
        {
          action: 'konbini-complete',
          description: 'コンビニ支払い完了をシミュレート',
          endpoint: 'POST /api/test/payments/:paymentIntentId/simulate/konbini-complete',
          requiredStatus: ['pending', 'requires_action'],
        },
        {
          action: 'konbini-expire',
          description: 'コンビニ支払い期限切れをシミュレート（4日経過）',
          endpoint: 'POST /api/test/payments/:paymentIntentId/simulate/konbini-expire',
          requiredStatus: ['pending', 'requires_action'],
        },
      ],
    };
  }
}

export default new PaymentTestSimulatorService();

