/**
 * PaymentGateway — 決済プロバイダーの抽象インターフェース
 *
 * 新しい決済プロバイダー（PayPal, Paddle, Square 等）を追加する際は
 * このインターフェースを実装してください。
 */

// =========================================
// 共通パラメータ型
// =========================================

/** チェックアウトセッション作成パラメータ */
export interface GatewayCheckoutParams {
  /** 商品名（quickpay 用。product_id/price_id の代替） */
  name?: string;
  /** 金額（最小通貨単位: 円なら円、ドルならセント） */
  amount?: number;
  /** 通貨コード (ISO 4217: jpy, usd 等) */
  currency?: string;
  /** 既存 Stripe Price ID（product_id/price_id 指定時） */
  priceId?: string;
  /** 購入意図 ID（OpenAI External Checkout の識別子） */
  purchaseIntentId: string;
  /** 顧客メールアドレス */
  customerEmail?: string;
  /** 決済成功後のリダイレクト URL */
  successUrl: string;
  /** 決済キャンセル後のリダイレクト URL */
  cancelUrl: string;
  /** 決済モード */
  mode?: 'payment' | 'subscription';
  /** 追加メタデータ */
  metadata?: Record<string, string>;
}

/** チェックアウトセッション作成結果 */
export interface GatewayCheckoutResult {
  /** プロバイダー側のセッション/注文 ID */
  gatewaySessionId: string;
  /** ユーザーをリダイレクトする決済 URL */
  checkoutUrl: string;
  /** セッション有効期限 */
  expiresAt: Date;
}

/** Webhook イベントの正規化形式 */
export interface GatewayWebhookEvent {
  /** プロバイダー固有のイベント ID（冪等性確保用） */
  gatewayEventId: string;
  /** 正規化されたイベント種別 */
  type:
    | 'payment.succeeded'
    | 'payment.failed'
    | 'subscription.updated'
    | 'subscription.cancelled'
    | 'refund.created'
    | 'dispute.created'
    | 'dispute.closed'
    | 'unknown';
  /** 購入意図 ID */
  purchaseIntentId?: string;
  /** 顧客メールアドレス */
  customerEmail?: string;
  /** 金額（最小通貨単位） */
  amount?: number;
  /** 通貨コード */
  currency?: string;
  /** プロバイダー固有の生データ */
  rawData: unknown;
}

/** 返金パラメータ */
export interface GatewayRefundParams {
  /** プロバイダー固有の支払い ID */
  gatewayPaymentId: string;
  /** 部分返金額（未指定は全額） */
  amount?: number;
  /** 返金理由 */
  reason?: string;
}

/** サブスクリプション状態 */
export interface GatewaySubscriptionStatus {
  /** プロバイダー固有のサブスクリプション ID */
  gatewaySubscriptionId: string;
  /** 状態 */
  status: 'active' | 'past_due' | 'cancelled' | 'paused' | 'trialing';
  /** 次回請求日 */
  currentPeriodEnd?: Date;
}

// =========================================
// PaymentGateway インターフェース
// =========================================

/**
 * 決済ゲートウェイ抽象インターフェース
 *
 * 実装クラス:
 * - StripeGateway (src/services/gateways/StripeGateway.ts)
 * - 将来: PayPalGateway, PaddleGateway 等
 */
export interface PaymentGateway {
  /** ゲートウェイ識別子 (例: 'stripe', 'paypal') */
  readonly gatewayType: string;

  /**
   * チェックアウトセッションを作成し、決済 URL を返す
   */
  createCheckoutSession(params: GatewayCheckoutParams): Promise<GatewayCheckoutResult>;

  /**
   * Webhook ペイロードの署名を検証し、正規化されたイベントを返す
   *
   * @throws 署名検証失敗時はエラーをスロー
   */
  verifyWebhook(payload: Buffer | string, signature: string): Promise<GatewayWebhookEvent>;

  /**
   * 返金を実行する
   */
  createRefund(params: GatewayRefundParams): Promise<void>;

  /**
   * サブスクリプション状態を取得する
   */
  getSubscriptionStatus(
    gatewaySubscriptionId: string
  ): Promise<GatewaySubscriptionStatus | null>;
}
