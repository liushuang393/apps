/**
 * ForgePay 決済フロー ライブ E2E スクリプト（手動実行）
 *
 * 全業務フローを実際の ForgePay（+ Stripe テストモード）に対して確認する:
 *   1. 未購入確認        : entitlements/verify が 404（権限なし）
 *   2. 重複なし→checkout : quickpay で checkout_url 生成
 *   3. 支払い            : 表示された checkout_url をブラウザで開き、テストカードで支払う（手動）
 *   4. 有効化確認        : entitlements/verify が active になるまでポーリング
 *   5. （任意）返金      : 返金後 entitlements/verify が revoked/inactive になることを確認
 *
 * 前提:
 *   - scripts/forgepay-provision.mjs 実行済み（API キー・商品・Stripe 鍵・設定が揃っている）
 *   - stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe が起動している
 *   - 環境変数: FORGEPAY_API_URL, FORGEPAY_API_KEY, FORGEPAY_SUBSCRIPTION_PRODUCT_ID
 *
 * 実行:
 *   FORGEPAY_API_KEY=fpb_test_xxx FORGEPAY_SUBSCRIPTION_PRODUCT_ID=<uuid> \
 *   node scripts/e2e-forgepay.mjs
 *
 * テストカード: 4242 4242 4242 4242 / 任意の未来の有効期限 / 任意の CVC
 */

const BASE = (process.env.FORGEPAY_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = process.env.FORGEPAY_API_KEY;
const PRODUCT_ID = process.env.FORGEPAY_SUBSCRIPTION_PRODUCT_ID || process.env.FORGEPAY_ONETIME_PRODUCT_ID;
const USER_ID = process.env.E2E_USER_ID || `e2e_user_${Math.floor(Date.now() / 1000)}`;

if (!API_KEY) {
    console.error('FORGEPAY_API_KEY が未設定です。');
    process.exit(1);
}
if (!PRODUCT_ID) {
    console.error('FORGEPAY_SUBSCRIPTION_PRODUCT_ID（または ONETIME）が未設定です。');
    process.exit(1);
}

/** @param {string} method @param {string} path @param {object|null} body */
async function api(method, path, body) {
    const headers = { 'X-API-Key': API_KEY };
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

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log(`== ForgePay ライブ E2E ==`);
    console.log(`   base=${BASE} product=${PRODUCT_ID} user=${USER_ID}\n`);

    // 1) 未購入確認
    const before = await api('GET', `/entitlements/verify?purchase_intent_id=${encodeURIComponent(USER_ID)}`, null);
    if (before.status === 404) {
        console.log('✅ [1] 未購入を確認（404）');
    } else if (before.status === 200 && before.data.has_access === false) {
        console.log('✅ [1] 未購入を確認（inactive）');
    } else {
        console.log(`⚠️  [1] 想定外の初期状態: HTTP ${before.status}`, before.data);
    }

    // 2) checkout 作成
    const checkout = await api('POST', '/quickpay', {
        purchase_intent_id: USER_ID,
        product_id: PRODUCT_ID,
    });
    if (checkout.status !== 200 && checkout.status !== 201) {
        console.error('❌ [2] checkout 作成失敗:', checkout.status, checkout.data);
        process.exit(1);
    }
    console.log('✅ [2] checkout 作成成功');
    console.log(`\n   👉 次の URL をブラウザで開き、テストカード 4242 4242 4242 4242 で支払ってください:\n`);
    console.log(`   ${checkout.data.checkout_url}\n`);

    // 3-4) 有効化をポーリング（最大 ~3 分）
    console.log('   支払い完了を待っています（entitlements/verify をポーリング、Ctrl+C で中断）...');
    const deadline = Date.now() + 3 * 60 * 1000;
    let activated = false;
    while (Date.now() < deadline) {
        await sleep(5000);
        const v = await api('GET', `/entitlements/verify?purchase_intent_id=${encodeURIComponent(USER_ID)}`, null);
        if (v.status === 200 && v.data.has_access === true) {
            console.log(`\n✅ [4] 有効化を確認: status=${v.data.status} entitlement=${v.data.entitlement_id}`);
            activated = true;
            break;
        }
        process.stdout.write('.');
    }

    if (!activated) {
        console.log('\n⏱️  タイムアウト（未支払いか Webhook 未到達）。stripe listen の起動を確認してください。');
        process.exit(1);
    }

    console.log('\n🎉 決済フロー E2E 成功。');
    console.log('   返金テストは ForgePay ダッシュボードまたは admin/refunds で実施し、');
    console.log('   再度本スクリプトの verify が inactive/revoked に変わることを確認してください。');
}

main().catch((err) => {
    console.error('予期しないエラー:', err);
    process.exit(1);
});
