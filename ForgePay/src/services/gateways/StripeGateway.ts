import { StripeClient } from '../StripeClient';
import {
  PaymentGateway,
  GatewayCheckoutParams,
  GatewayCheckoutResult,
  GatewayWebhookEvent,
  GatewayRefundParams,
  GatewaySubscriptionStatus,
} from './PaymentGateway';
import Stripe from 'stripe';
import { logger } from '../../utils/logger';

/**
 * StripeGateway — PaymentGateway インターフェースの Stripe 実装
 *
 * 既存の StripeClient をラップして抽象インターフェースへ適合させる。
 * StripeClient の詳細な Stripe SDK ロジックはそのまま維持する。
 */
export class StripeGateway implements PaymentGateway {
  readonly gatewayType = 'stripe';

  constructor(private readonly stripeClient: StripeClient) {}

  /**
   * Stripe Checkout Session を作成
   */
  async createCheckoutSession(params: GatewayCheckoutParams): Promise<GatewayCheckoutResult> {
    const result = await this.stripeClient.createCheckoutSession({
      // quickpay では productId/priceId が不要なため空文字をセット
      productId: '',
      priceId: params.priceId ?? '',
      purchaseIntentId: params.purchaseIntentId,
      customerEmail: params.customerEmail,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      mode: params.mode ?? 'payment',
      metadata: params.metadata,
    });

    return {
      gatewaySessionId: result.sessionId,
      checkoutUrl: result.url,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * Stripe Webhook 署名検証
   */
  async verifyWebhook(
    payload: Buffer | string,
    signature: string
  ): Promise<GatewayWebhookEvent> {
    const event = this.stripeClient.verifyWebhookSignature(payload, signature);

    return this.normalizeStripeEvent(event);
  }

  /**
   * 返金を実行
   */
  async createRefund(params: GatewayRefundParams): Promise<void> {
    await this.stripeClient.createRefund({
      paymentIntentId: params.gatewayPaymentId,
      amount: params.amount,
    });
  }

  /**
   * サブスクリプション状態を取得
   */
  async getSubscriptionStatus(
    gatewaySubscriptionId: string
  ): Promise<GatewaySubscriptionStatus | null> {
    try {
      const sub = await this.stripeClient.getSubscription(gatewaySubscriptionId);
      if (!sub) return null;

      return {
        gatewaySubscriptionId: sub.id,
        status: this.mapStripeSubscriptionStatus(sub.status),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
      };
    } catch (error) {
      logger.error('Stripe サブスクリプション状態取得失敗', {
        gatewaySubscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // =========================================
  // プライベートヘルパー
  // =========================================

  /**
   * Stripe イベントを共通形式に正規化
   */
  private normalizeStripeEvent(event: Stripe.Event): GatewayWebhookEvent {
    const base: GatewayWebhookEvent = {
      gatewayEventId: event.id,
      type: 'unknown',
      rawData: event,
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          ...base,
          type: 'payment.succeeded',
          purchaseIntentId:
            session.metadata?.purchase_intent_id ?? session.client_reference_id ?? undefined,
          customerEmail: session.customer_details?.email ?? undefined,
          amount: session.amount_total ?? undefined,
          currency: session.currency ?? undefined,
        };
      }

      case 'invoice.payment_failed':
        return { ...base, type: 'payment.failed' };

      case 'customer.subscription.updated':
        return { ...base, type: 'subscription.updated' };

      case 'customer.subscription.deleted':
        return { ...base, type: 'subscription.cancelled' };

      case 'charge.refunded':
        return { ...base, type: 'refund.created' };

      case 'charge.dispute.created':
        return { ...base, type: 'dispute.created' };

      case 'charge.dispute.closed':
        return { ...base, type: 'dispute.closed' };

      default:
        return base;
    }
  }

  /**
   * Stripe サブスクリプションステータスを共通ステータスに変換
   */
  private mapStripeSubscriptionStatus(
    status: Stripe.Subscription.Status
  ): GatewaySubscriptionStatus['status'] {
    switch (status) {
      case 'active':
        return 'active';
      case 'past_due':
      case 'unpaid':
        return 'past_due';
      case 'canceled':
        return 'cancelled';
      case 'paused':
        return 'paused';
      case 'trialing':
        return 'trialing';
      default:
        return 'cancelled';
    }
  }
}
