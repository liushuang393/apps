/**
 * ForgePay プロビジョニングスクリプト（ローカル開発用・手動実行）
 *
 * 目的:
 *   ForgePay 上に、本アプリ用の開発者アカウント・Stripe 鍵・商品（サブスク/買い切り）・
 *   デフォルト設定（成功/キャンセル/通知 URL）を一括セットアップし、
 *   取得した FORGEPAY_API_KEY / 商品 ID を **プロジェクト直下の .env に自動反映** する。
 *   一度成功すれば、以降は全ユーザーが .env の商品 ID を使い回して購入できる
 *   （プロビジョニングは初回セットアップ時のみ実行すればよい）。
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
 *   APP_PUBLIC_URL=http://localhost:3002 \
 *   node scripts/forgepay-provision.mjs
 *
 *   既に API キーがある場合は登録をスキップ:
 *   FORGEPAY_API_KEY=fpb_test_xxx STRIPE_TEST_SECRET_KEY=sk_test_xxx node scripts/forgepay-provision.mjs
 *
 *   .env を書き換えず表示のみにしたい場合:
 *   node scripts/forgepay-provision.mjs --print-only   （または NO_WRITE_ENV=1）
 *
 * 注意:
 *   - Stripe 鍵は ForgePay 側へ送って暗号化保存するだけで、アプリの .env には一切書かない
 *     （INTEGRATION_GUIDE §3「アプリが絶対にやってはいけないこと」を順守）。
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const BASE = (process.env.FORGEPAY_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const APP_URL = (process.env.APP_PUBLIC_URL || 'https://example.com').replace(/\/+$/, '');
const CALLBACK_URL = process.env.FORGEPAY_CALLBACK_URL || `${APP_URL}/api/forgepay-callback`;

// .env への自動書き込みを行うか（--print-only / NO_WRITE_ENV=1 で表示のみ）
const WRITE_ENV = !process.argv.includes('--print-only') && process.env.NO_WRITE_ENV !== '1';

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
        if (reg.status === 409) {
            // 既に登録済みのメール。API キーはハッシュ保存のため再取得不可。
            console.error(`⚠️  このメール（${email}）は既に ForgePay へ登録済みです。`);
            console.error('   既存の API キーを使って再実行してください:');
            console.error('     FORGEPAY_API_KEY=fpb_test_xxx STRIPE_TEST_SECRET_KEY=sk_test_xxx \\');
            console.error('       node scripts/forgepay-provision.mjs');
            console.error('   API キーが分からない場合はダッシュボード（http://localhost:3001）で再発行するか、');
            console.error('   POST /api/v1/onboarding/forgot-key で再取得してください。');
            process.exit(1);
        }
        assertOk('開発者登録', reg);
        apiKey = reg.data.apiKey.key;
        console.log(`✅ 開発者登録: ${email}`);
        console.log(`   API キー: ${apiKey}`);
        // 後続ステップ（商品作成等）が失敗してもキーを失わないよう、登録直後に .env へ保存する。
        // ハッシュ保存のため再取得不可・メールは 409 ロックされるため、ここで確実に永続化する。
        if (WRITE_ENV) {
            updateEnvFile(new URL('../.env', import.meta.url), {
                FORGEPAY_API_URL: BASE,
                FORGEPAY_API_KEY: apiKey,
            });
            console.log('   （新規 API キーを .env に保存しました）');
        }
        console.log('');
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

    // 5) .env へ反映（Stripe 鍵は含めない）
    const envValues = {
        FORGEPAY_API_URL: BASE,
        FORGEPAY_API_KEY: apiKey,
        FORGEPAY_SUBSCRIPTION_PRODUCT_ID: subProductId,
        FORGEPAY_ONETIME_PRODUCT_ID: onetimeProductId,
        APP_PUBLIC_URL: APP_URL,
    };

    if (WRITE_ENV) {
        const envPath = new URL('../.env', import.meta.url);
        updateEnvFile(envPath, envValues);
        console.log('\n✅ .env を更新しました（.env.bak にバックアップ済み）:');
        for (const key of Object.keys(envValues)) {
            console.log(`   ${key}=${key === 'FORGEPAY_API_KEY' ? `${apiKey.slice(0, 12)}...` : envValues[key]}`);
        }
        console.log('');
    } else {
        console.log('\n========== .env に設定してください ==========');
        for (const [key, value] of Object.entries(envValues)) {
            console.log(`${key}=${value}`);
        }
        console.log('===========================================\n');
    }

    console.log('次: stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe を起動し、');
    console.log('    node scripts/e2e-forgepay.mjs で疎通確認してください。');
}

// 同一実行内でバックアップを 1 回だけ作成するためのフラグ（複数回呼ばれても元の .env を上書きしない）
let envBackedUp = false;

/**
 * .env を読み込み、指定キーの値を更新（既存行は値だけ差し替え、無ければ追記）。
 * 他の行・コメントは保持する。書き込み前に .env.bak を作成する（同一実行では初回のみ）。
 * 既存ファイルの改行コード（CRLF / LF）を維持する。
 *
 * @param {URL} envPath - .env の絶対パス
 * @param {Record<string, string>} values - 設定するキー/値
 */
function updateEnvFile(envPath, values) {
    let content = '';
    if (existsSync(envPath)) {
        if (!envBackedUp) {
            copyFileSync(envPath, new URL('../.env.bak', import.meta.url));
            envBackedUp = true;
        }
        content = readFileSync(envPath, 'utf8');
    }

    // 元ファイルの改行コードを維持（CRLF を含むなら CRLF、無ければ LF）
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const remaining = { ...values };

    const updated = lines.map((line) => {
        const m = line.match(/^([A-Z0-9_]+)=/);
        if (m && Object.prototype.hasOwnProperty.call(remaining, m[1])) {
            const key = m[1];
            const newLine = `${key}=${remaining[key]}`;
            delete remaining[key];
            return newLine;
        }
        return line;
    });

    // .env に未存在のキーは末尾へ追記
    const toAppend = Object.entries(remaining).map(([k, v]) => `${k}=${v}`);
    if (toAppend.length > 0) {
        if (updated.length > 0 && updated[updated.length - 1] !== '') {
            updated.push('');
        }
        updated.push(...toAppend);
    }

    writeFileSync(envPath, updated.join(eol), 'utf8');
}

/**
 * 商品と価格を作成し、商品 ID を返す。
 * @param {string} apiKey
 * @param {{name:string, description:string, type:string, amount:number, currency:string, interval:(string|null)}} spec
 * @returns {Promise<string>} 商品 ID
 */
async function createProductWithPrice(apiKey, spec) {
    // 冪等性: 同名商品が既にあれば再利用し、重複作成を防ぐ（再実行・409 復旧時の安全策）。
    const existing = await findProductByName(apiKey, spec.name);
    if (existing) {
        console.log(`ℹ️  既存商品を再利用: ${spec.name} → ${existing.id}`);
        return existing.id;
    }

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

/**
 * 開発者の商品一覧から同名の商品を探す。見つからなければ null。
 * @param {string} apiKey
 * @param {string} name - 商品名
 * @returns {Promise<{id:string, name:string}|null>}
 */
async function findProductByName(apiKey, name) {
    const res = await api('GET', '/admin/products', null, apiKey);
    if (res.status !== 200 || res.data == null || !Array.isArray(res.data.data)) {
        return null;
    }
    return res.data.data.find((p) => p.name === name) || null;
}

main().catch((err) => {
    console.error('予期しないエラー:', err);
    process.exit(1);
});
