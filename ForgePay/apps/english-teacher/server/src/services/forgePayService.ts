/**
 * forgePayService — ForgePay REST API クライアント
 *
 * English Teacher は Stripe を直接呼ばず、ForgePay 経由で決済を行う。
 * - 決済セッション作成: POST /api/v1/quickpay
 * - 支払い状態確認:     GET /api/v1/entitlements/verify
 *
 * 環境変数:
 * - FORGEPAY_API_URL: ForgePay のベース URL (例: http://localhost:3000)
 * - FORGEPAY_API_KEY: ForgePay に登録した API キー (x-api-key ヘッダー)
 */

export interface ForgePayCheckoutResult {
  session_id: string;
  checkout_url: string;
}

export interface ForgePayPaymentStatus {
  active: boolean;
  purchase_intent_id: string;
}

export interface CreatePaymentOptions {
  /** ForgePay ダッシュボードで作成した商品 ID（UUID） */
  productId?: string;
  /** 金額（アドホックモード時） */
  amount?: number;
  /** 商品名（アドホックモード時） */
  name?: string;
  /** 通貨コード（アドホックモード時） */
  currency?: string;
}

function getForgePayBaseUrl(): string {
  return process.env.FORGEPAY_API_URL ?? 'http://localhost:3000';
}

function getForgePayApiKey(): string {
  const key = process.env.FORGEPAY_API_KEY;
  if (!key) {
    throw new Error('FORGEPAY_API_KEY が設定されていません');
  }
  return key;
}

/**
 * ForgePay quickpay 経由で決済セッションを作成する
 *
 * - success_url / cancel_url は APP_URL 環境変数から自動構築（省略時は ForgePay ダッシュボードのデフォルトを使用）
 * - STRIPE_PRICE_ID 環境変数が設定されている場合は price_id として渡す
 *
 * @param userId ユーザー ID（purchase_intent_id として使用）
 * @param options 商品指定（省略時は環境変数 STRIPE_PRICE_ID を使用）
 */
export async function createPayment(
  userId: string,
  options?: CreatePaymentOptions,
): Promise<ForgePayCheckoutResult> {
  const baseUrl = getForgePayBaseUrl();
  const apiKey = getForgePayApiKey();

  // APP_URL から success_url / cancel_url を自動構築
  const appUrl = process.env.APP_URL;
  const body: Record<string, unknown> = {
    purchase_intent_id: userId,
  };

  if (appUrl) {
    body.success_url = `${appUrl}/callback/forgepay?session_id={CHECKOUT_SESSION_ID}`;
    body.cancel_url = `${appUrl}/`;
  }

  // 環境変数の STRIPE_PRICE_ID を使用（明示指定がない場合）
  if (options?.productId) {
    body.product_id = options.productId;
  } else if (!options?.amount) {
    const stripePriceId = process.env.STRIPE_PRICE_ID;
    if (stripePriceId) {
      body.price_id = stripePriceId;
    }
  }

  if (options?.amount !== undefined) {
    body.amount = options.amount;
    body.name = options.name;
    body.currency = options.currency;
  }

  const response = await fetch(`${baseUrl}/api/v1/quickpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ForgePay quickpay 失敗 (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { session_id: string; checkout_url: string };

  return {
    session_id: data.session_id,
    checkout_url: data.checkout_url,
  };
}

/**
 * ForgePay 経由でユーザーの支払い状態を確認する
 *
 * @param userId チェックアウト時に渡したユーザー ID
 */
export async function checkPaymentStatus(
  userId: string,
): Promise<ForgePayPaymentStatus> {
  const baseUrl = getForgePayBaseUrl();
  const apiKey = getForgePayApiKey();

  const response = await fetch(
    `${baseUrl}/api/v1/entitlements/verify?purchase_intent_id=${encodeURIComponent(userId)}`,
    {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
      },
    },
  );

  if (!response.ok) {
    if (response.status === 404) {
      return { active: false, purchase_intent_id: userId };
    }
    const errorText = await response.text();
    throw new Error(`ForgePay 支払い状態確認失敗 (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { active: boolean; purchase_intent_id: string };

  return {
    active: data.active,
    purchase_intent_id: data.purchase_intent_id,
  };
}
