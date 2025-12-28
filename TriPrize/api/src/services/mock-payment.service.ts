import Stripe from 'stripe';
import { generateUUID } from '../utils/crypto.util';
import logger from '../utils/logger.util';

/**
 * Mock payment service for development and testing
 * 目的: 在开发环境中提供假支付实现，用于快速测试和单元测试
 * I/O: 模拟 Stripe API 响应，不实际调用 Stripe
 * 注意点: 仅用于开发环境，生产环境禁止使用
 */
export class MockPaymentService {
  private readonly mockPaymentIntents: Map<string, Stripe.PaymentIntent> = new Map();
  private readonly mockPaymentMethods: Map<string, Stripe.PaymentMethod> = new Map();

  /**
   * Create a mock payment intent
   * 目的: 创建假的 PaymentIntent，模拟 Stripe API
   */
  async createPaymentIntent(
    params: Stripe.PaymentIntentCreateParams
  ): Promise<Stripe.PaymentIntent> {
    const paymentIntentId = `pi_mock_${generateUUID().substring(0, 24)}`;
    const clientSecret = `pi_mock_${generateUUID()}_secret_${generateUUID()}`;

    // Create mock payment method if konbini
    let paymentMethodId: string | undefined;
    if (params.payment_method_types?.includes('konbini')) {
      paymentMethodId = `pm_mock_${generateUUID().substring(0, 24)}`;
      
      // Generate mock konbini confirmation number
      const confirmationNumber = this.generateMockKonbiniNumber();
      
      // 目的: テスト用の PaymentMethod オブジェクトを作成
      // 注意点: Stripe の完全な型定義には多くの必須フィールドがあるため unknown 経由でキャスト
      const mockPaymentMethod = {
        id: paymentMethodId,
        object: 'payment_method' as const,
        type: 'konbini' as const,
        konbini: {
          store: 'lawson',
          confirmation_number: confirmationNumber,
        },
        billing_details: {
          address: null,
          email: null,
          name: null,
          phone: null,
        },
        customer: null,
        metadata: {},
        created: Math.floor(Date.now() / 1000),
        livemode: false,
      } as unknown as Stripe.PaymentMethod;

      this.mockPaymentMethods.set(paymentMethodId, mockPaymentMethod);
    }

    // Calculate expiration time for konbini (4 days)
    // 目的: Konbini 支払いの有効期限を計算
    // 注意点: Stripe 型定義の互換性問題を回避するため any でアクセス
    const konbiniOptions = params.payment_method_options?.konbini as { expires_after_days?: number } | undefined;
    const expiresAfterDays = konbiniOptions?.expires_after_days || 4;
    const expiresAt = Math.floor(Date.now() / 1000) + (expiresAfterDays * 24 * 60 * 60);

    // コンビニ支払い番号を生成（Mock用）
    // 目的: フロントエンドで支払い番号を表示するため
    // 注意点: 本番環境では Stripe が stores 構造で返すため、同じ構造を模擬
    const mockKonbiniPaymentCode = this.generateMockKonbiniNumber();

    const mockPaymentIntent: Stripe.PaymentIntent = {
      id: paymentIntentId,
      object: 'payment_intent',
      amount: params.amount,
      currency: params.currency || 'jpy',
      status: params.payment_method_types?.includes('konbini')
        ? 'requires_action'
        : 'requires_payment_method',
      client_secret: clientSecret,
      payment_method: paymentMethodId,
      payment_method_types: params.payment_method_types || ['card'],
      metadata: params.metadata || {},
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      next_action: params.payment_method_types?.includes('konbini') ? {
        type: 'konbini_display_details',
        konbini_display_details: {
          hosted_voucher_url: `https://pay.stripe.com/konbini/voucher/${paymentIntentId}`,
          expires_at: expiresAt,
          // Mock用: stores構造を追加（本番Stripeと同じ形式）
          // 注意点: payment_code は各コンビニ店舗に設定する必要がある
          stores: {
            familymart: {
              payment_code: mockKonbiniPaymentCode,
              confirmation_number: mockKonbiniPaymentCode,
            },
            lawson: {
              payment_code: mockKonbiniPaymentCode,
              confirmation_number: mockKonbiniPaymentCode,
            },
            ministop: {
              payment_code: mockKonbiniPaymentCode,
              confirmation_number: mockKonbiniPaymentCode,
            },
            seicomart: {
              payment_code: mockKonbiniPaymentCode,
              confirmation_number: mockKonbiniPaymentCode,
            },
          },
        },
      } : undefined,
    } as Stripe.PaymentIntent;

    this.mockPaymentIntents.set(paymentIntentId, mockPaymentIntent);

    logger.info('Mock payment intent created', {
      paymentIntentId,
      amount: params.amount,
      paymentMethod: params.payment_method_types?.[0],
      isKonbini: params.payment_method_types?.includes('konbini'),
    });

    return mockPaymentIntent;
  }

  /**
   * Retrieve a mock payment intent
   * 目的: 获取假的 PaymentIntent
   */
  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const paymentIntent = this.mockPaymentIntents.get(paymentIntentId);
    
    if (!paymentIntent) {
      throw new Error(`PaymentIntent ${paymentIntentId} not found`);
    }

    return paymentIntent;
  }

  /**
   * Retrieve a mock payment method
   * 目的: 获取假的 PaymentMethod（用于 Konbini）
   */
  async retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const paymentMethod = this.mockPaymentMethods.get(paymentMethodId);
    
    if (!paymentMethod) {
      throw new Error(`PaymentMethod ${paymentMethodId} not found`);
    }

    return paymentMethod;
  }

  /**
   * Confirm a mock payment intent
   * 目的: 模拟支付确认（用于测试）
   */
  async confirmPaymentIntent(
    paymentIntentId: string,
    params?: { payment_method?: string }
  ): Promise<Stripe.PaymentIntent> {
    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    
    // Update status to succeeded
    const updatedPaymentIntent: Stripe.PaymentIntent = {
      ...paymentIntent,
      status: 'succeeded',
      payment_method: params?.payment_method || paymentIntent.payment_method,
    };

    this.mockPaymentIntents.set(paymentIntentId, updatedPaymentIntent);

    logger.info('Mock payment intent confirmed', { paymentIntentId });

    return updatedPaymentIntent;
  }

  /**
   * Cancel a mock payment intent
   * 目的: 模拟支付取消（用于测试）
   */
  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    
    const updatedPaymentIntent: Stripe.PaymentIntent = {
      ...paymentIntent,
      status: 'canceled',
    };

    this.mockPaymentIntents.set(paymentIntentId, updatedPaymentIntent);

    logger.info('Mock payment intent canceled', { paymentIntentId });

    return updatedPaymentIntent;
  }

  /**
   * Create a mock refund
   * 目的: 模拟退款（用于测试）
   */
  async createRefund(
    paymentIntentId: string,
    params?: { amount?: number; reason?: string }
  ): Promise<Stripe.Refund> {
    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    
    const refundId = `re_mock_${generateUUID().substring(0, 24)}`;
    const refundAmount = params?.amount || paymentIntent.amount;

    // 目的: テスト用の Refund オブジェクトを作成
    // 注意点: Stripe の完全な型定義には多くの必須フィールドがあるため unknown 経由でキャスト
    const mockRefund = {
      id: refundId,
      object: 'refund' as const,
      amount: refundAmount,
      currency: paymentIntent.currency,
      payment_intent: paymentIntentId,
      status: 'succeeded' as const,
      reason: params?.reason || 'requested_by_customer',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      balance_transaction: null,
      charge: null,
      metadata: {},
      receipt_number: null,
      source_transfer_reversal: null,
      transfer_reversal: null,
    } as unknown as Stripe.Refund;

    logger.info('Mock refund created', {
      refundId,
      paymentIntentId,
      amount: refundAmount,
    });

    return mockRefund;
  }

  /**
   * Generate mock Konbini confirmation number
   * 目的: 生成假的便利店支付编号
   * 注意点: 格式为12位数字，符合日本便利店支付编号格式
   */
  private generateMockKonbiniNumber(): string {
    // Generate 12-digit number (common format for Konbini payments)
    const randomDigits = Math.floor(Math.random() * 1000000000000)
      .toString()
      .padStart(12, '0');
    return randomDigits;
  }

  /**
   * Clear all mock data (for testing)
   * 目的: 清除所有假数据，用于测试清理
   */
  clearAll(): void {
    this.mockPaymentIntents.clear();
    this.mockPaymentMethods.clear();
    logger.info('All mock payment data cleared');
  }
}

export default new MockPaymentService();
