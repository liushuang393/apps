/**
 * ForgePay プロビジョニングスクリプト（ローカル開発用・手動実行）
 *
 * 目的:
 *   ForgePay 上に、本アプリ用の開発者アカウント・Stripe 鍵・商品（サブスク/買い切り）・
 *   デフォルト設定（成功/キャンセル/通知 URL）を一括セットアップする。
 *   実行後に出力される FORGEPAY_API_KEY / 商品 ID を .env に貼り付ける。
 *
 * 前提:
 *   - ForgePay が起動している（既定 http://localhost:3000）
 *   - 自分の Stripe テスト用シークレットキー（sk_test_...）を用意していること
 *     （ForgePay は開発者ごとの Stripe アカウントで決済するため必須）
 *
 * 実行:
 *   FORGEPAY_API_URL=http://localhost:3000 \
 *   FORGEPAY_DEV_EMAIL=you@example.com \
 *   STRIPE_TEST_SECRET_KEY=sk_test_xxx \
 *   APP_PUBLIC_URL=https://your-app.example.com \
 *   node scripts/forgepay-provision.mjs
 *
 *   既に API キーがある場合は登録をスキップ:
 *   FORGEPAY_API_KEY=fpb_test_xxx STRIPE_TEST_SECRET_KEY=sk_test_xxx node scripts/forgepay-provision.mjs
 */

const BASE = (process.env.FORGEPAY_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const APP_URL = (process.env.APP_PUBLIC_URL || 'https://example.com').replace(/\/+$/, '');
const CALLBACK_URL = process.env.FORGEPAY_CALLBACK_URL || `${APP_URL}/api/forgepay-callback`;

/**
 * ForgePay へ JSON リクエスト。
 * @param {string} method
 * @param {string} path - /api/v1 配下
 * @param {object|null} body
 * @param {string|null} apiKey
 * @returns {Promise<{status:number, data:any}>}
 */
async function api(method, path, body, apiKey) {
    const headers = {};
    if (apiKey) headers['X-API-Key'] = apiKey;
    const init = { method, headers };
    if (body != null) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}/api/v1${path}`, init);
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { raw: text };
    }
    return { status: res.status, data };
}

/** 失敗時に停止するアサート。 */
function assertOk(label, res) {
    if (res.status >= 400) {
        console.error(`❌ ${label} 失敗 (HTTP ${res.status}):`, JSON.stringify(res.data));
        process.exit(1);
    }
}

async function main() {
    console.log(`== ForgePay プロビジョニング (${BASE}) ==\n`);

    // 1) API キー（既存 or 新規登録）
    let apiKey = process.env.FORGEPAY_API_KEY || '';
    if (!apiKey) {
        const email = process.env.FORGEPAY_DEV_EMAIL;
        if (!email) {
            console.error('FORGEPAY_API_KEY も FORGEPAY_DEV_EMAIL もありません。どちらかを指定してください。');
            process.exit(1);
        }
        const reg = await api('POST', '/onboarding/register', { email, testMode: true }, null);
        assertOk('開発者登録', reg);
        apiKey = reg.data.apiKey.key;
        console.log(`✅ 開発者登録: ${email}`);
        console.log(`   API キー: ${apiKey}\n`);
    } else {
        console.log(`✅ 既存の API キーを使用: ${apiKey.slice(0, 12)}...\n`);
    }

    // 2) Stripe テスト鍵（任意）
    //    ForgePay は開発者が Stripe 鍵未設定の場合、サーバの「グローバル Stripe 鍵」
    //    （ForgePay 側 .env の STRIPE_TEST_SECRET_KEY → config.stripe.secretKey）に
    //    フォールバックする。よって共通システム側でグローバル Stripe が設定済みなら
    //    アプリ側は Stripe 鍵を渡す必要はない（fpb_ キーの認証だけでよい）。
    //    個別の Stripe アカウントを使いたい場合のみ STRIPE_TEST_SECRET_KEY を指定する。
    const stripeSecret = process.env.STRIPE_TEST_SECRET_KEY;
    if (stripeSecret) {
        const keysRes = await api(
            'POST',
            '/onboarding/stripe/keys',
            {
                stripe_secret_key: stripeSecret,
                stripe_publishable_key: process.env.STRIPE_TEST_PUBLISHABLE_KEY || undefined,
                stripe_webhook_secret: process.env.STRIPE_TEST_WEBHOOK_SECRET || undefined,
            },
            apiKey
        );
        assertOk('Stripe 鍵設定', keysRes);
        console.log('✅ この開発者専用の Stripe テスト鍵を設定\n');
    } else {
        console.log('ℹ️  STRIPE_TEST_SECRET_KEY 未指定 → ForgePay のグローバル Stripe を使用\n');
    }

    // 3) デフォルト設定（成功/キャンセル/通知 URL・通貨・ロケール）
    const settingsRes = await api(
        'PUT',
        '/onboarding/settings',
        {
            default_success_url: `${APP_URL}/success.html`,
            default_cancel_url: `${APP_URL}/subscription.html`,
            default_currency: 'jpy',
            default_locale: 'ja',
            callback_url: CALLBACK_URL,
            company_name: 'VoiceTranslate Pro',
        },
        apiKey
    );
    assertOk('デフォルト設定', settingsRes);
    console.log(`✅ 設定: success=${APP_URL}/success.html callback=${CALLBACK_URL}\n`);

    // 4) 商品＋価格を作成（サブスク 550円/月、買い切り 980円）
    const subProductId = await createProductWithPrice(apiKey, {
        name: 'VoiceTranslate Pro（月額）',
        description: 'リアルタイム音声翻訳・サブスクリプション',
        type: 'subscription',
        amount: 550,
        currency: 'jpy',
        interval: 'month',
    });

    const onetimeProductId = await createProductWithPrice(apiKey, {
        name: 'VoiceTranslate Pro（買い切り）',
        description: 'リアルタイム音声翻訳・一回払い',
        type: 'one_time',
        amount: 980,
        currency: 'jpy',
        interval: null,
    });

    // 5) .env に貼る値を出力
    console.log('\n========== .env に設定してください ==========');
    console.log(`FORGEPAY_API_URL=${BASE}`);
    console.log(`FORGEPAY_API_KEY=${apiKey}`);
    console.log(`FORGEPAY_SUBSCRIPTION_PRODUCT_ID=${subProductId}`);
    console.log(`FORGEPAY_ONETIME_PRODUCT_ID=${onetimeProductId}`);
    console.log(`APP_PUBLIC_URL=${APP_URL}`);
    console.log('===========================================\n');
    console.log('次: stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe を起動し、');
    console.log('    node scripts/e2e-forgepay.mjs で疎通確認してください。');
}

/**
 * 商品と価格を作成し、商品 ID を返す。
 * @param {string} apiKey
 * @param {{name:string, description:string, type:string, amount:number, currency:string, interval:(string|null)}} spec
 * @returns {Promise<string>} 商品 ID
 */
async function createProductWithPrice(apiKey, spec) {
    const prod = await api(
        'POST',
        '/admin/products',
        { name: spec.name, description: spec.description, type: spec.type },
        apiKey
    );
    assertOk(`商品作成(${spec.type})`, prod);
    const productId = prod.data.id;

    const priceBody = { product_id: productId, amount: spec.amount, currency: spec.currency };
    if (spec.interval) priceBody.interval = spec.interval;
    const price = await api('POST', '/admin/prices', priceBody, apiKey);
    assertOk(`価格作成(${spec.type})`, price);

    console.log(`✅ 商品: ${spec.name} → ${productId}（${spec.amount}${spec.currency}${spec.interval ? '/' + spec.interval : ''}）`);
    return productId;
}

main().catch((err) => {
    console.error('予期しないエラー:', err);
    process.exit(1);
});
