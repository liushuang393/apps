/**
 * ForgePay × ChatGPT App 連携 — TypeScript 参照実装
 *
 * このファイルは ChatGPT App（OpenAI Actions）から ForgePay を呼び出す
 * 典型的なパターンを示すサンプルコードです。
 *
 * 前提:
 *   - ForgePay サーバーが起動済み
 *   - ダッシュボードで商品・価格を作成済み
 *   - API キーを取得済み（登録時にメールで届きます）
 */

const FORGEPAY_API_URL = process.env.FORGEPAY_API_URL ?? 'https://your-forgepay-instance.com/api/v1';
const FORGEPAY_API_KEY = process.env.FORGEPAY_API_KEY ?? ''; // fpb_test_...

// ──────────────────────────────────────────────
// 1. 決済セッションを開始する
//    ChatGPT がユーザーに有料機能を提案するときに呼び出す
// ──────────────────────────────────────────────

export async function startCheckout(params: {
  productId: string;
  priceId: string;
  purchaseIntentId: string; // OpenAI から提供される purchase_intent_id
  customerEmail?: string;
}): Promise<{ checkoutUrl: string; sessionId: string; expiresAt: string }> {
  const response = await fetch(`${FORGEPAY_API_URL}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': FORGEPAY_API_KEY,
    },
    body: JSON.stringify({
      product_id: params.productId,
      price_id: params.priceId,
      purchase_intent_id: params.purchaseIntentId,
      customer_email: params.customerEmail,
      success_url: `${process.env.APP_URL}/payment/success`,
      cancel_url: `${process.env.APP_URL}/payment/cancel`,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`決済セッション作成失敗: ${error.error?.message ?? response.statusText}`);
  }

  const data = await response.json();
  return {
    checkoutUrl: data.checkout_url,
    sessionId: data.session_id,
    expiresAt: data.expires_at,
  };
}

// ──────────────────────────────────────────────
// 2. 決済完了後に unlock_token を検証する
//    ChatGPT が有料機能へのアクセスを許可するかどうかを判断するときに呼び出す
// ──────────────────────────────────────────────

export async function verifyAccess(unlockToken: string): Promise<{
  valid: boolean;
  entitlementId?: string;
  productId?: string;
  status?: string;
  expiresAt?: string;
}> {
  const response = await fetch(
    `${FORGEPAY_API_URL}/entitlements/verify?unlock_token=${encodeURIComponent(unlockToken)}`,
    {
      headers: { 'X-API-Key': FORGEPAY_API_KEY },
    }
  );

  if (!response.ok) {
    // 401: トークンが無効または期限切れ
    return { valid: false };
  }

  const data = await response.json();
  return {
    valid: data.valid,
    entitlementId: data.entitlement_id,
    productId: data.product_id,
    status: data.status,
    expiresAt: data.expires_at,
  };
}

// ──────────────────────────────────────────────
// 3. ChatGPT Action の実装例
//    OpenAI の Actions スキーマに対応する関数
// ──────────────────────────────────────────────

/**
 * ChatGPT Action: ユーザーが有料機能を使おうとしたときの処理
 *
 * GPT のシステムプロンプト例:
 *   "ユーザーが Premium 機能を使おうとしたら、createCheckoutSession を呼び出して
 *    checkout_url をユーザーに伝えてください。"
 */
export async function handlePremiumFeatureRequest(params: {
  purchaseIntentId: string;
  userEmail?: string;
}) {
  // 事前にダッシュボードで作成した商品・価格 ID
  const PREMIUM_PRODUCT_ID = process.env.PREMIUM_PRODUCT_ID ?? '';
  const PREMIUM_PRICE_ID = process.env.PREMIUM_PRICE_ID ?? '';

  const { checkoutUrl, expiresAt } = await startCheckout({
    productId: PREMIUM_PRODUCT_ID,
    priceId: PREMIUM_PRICE_ID,
    purchaseIntentId: params.purchaseIntentId,
    customerEmail: params.userEmail,
  });

  // ChatGPT がユーザーに返すメッセージ
  return {
    message: `以下の URL から安全に決済を完了してください。このリンクは ${new Date(expiresAt).toLocaleString('ja-JP')} まで有効です。`,
    checkout_url: checkoutUrl,
  };
}

/**
 * ChatGPT Action: 決済完了後のアクセス確認
 *
 * GPT のシステムプロンプト例:
 *   "ユーザーが unlock_token を提示したら verifyEntitlement を呼び出して
 *    valid=true の場合のみ Premium コンテンツを提供してください。"
 */
export async function verifyEntitlementAndGrant(unlockToken: string) {
  const result = await verifyAccess(unlockToken);

  if (!result.valid) {
    return {
      granted: false,
      message: '決済が確認できませんでした。決済を完了してから再試行してください。',
    };
  }

  return {
    granted: true,
    message: '決済が確認されました。Premium 機能をご利用いただけます。',
    entitlementId: result.entitlementId,
    expiresAt: result.expiresAt,
  };
}

// ──────────────────────────────────────────────
// 使用例
// ──────────────────────────────────────────────

async function example() {
  // 1. ユーザーが有料機能を使おうとしたとき
  const checkoutResult = await handlePremiumFeatureRequest({
    purchaseIntentId: 'pi_from_openai_12345', // OpenAI から受け取った ID
    userEmail: 'user@example.com',
  });
  console.log('Checkout URL:', checkoutResult.checkout_url);

  // 2. ユーザーが決済を完了し、unlock_token を提示したとき
  const accessResult = await verifyEntitlementAndGrant('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
  console.log('Access granted:', accessResult.granted);
}

example().catch(console.error);
