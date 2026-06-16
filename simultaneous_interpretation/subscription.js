/**
 * VoiceTranslate Pro - サブスクリプション/買い切りページスクリプト
 *
 * 公式手順書 `docs/ForgePay決済システムの他システム実装指南.md` に準拠。
 *   - 決済は ForgePay 経由。クライアントは Stripe も Supabase も触らない。
 *   - purchase_intent_id はアプリ側で発行する一意 ID（端末で生成・保持する UUID）。
 *   - こちらのバックエンド（create-checkout-session）へ依頼し checkout_url へ遷移。
 */

/**
 * ローディング表示の切り替え
 * @param {boolean} show
 */
function showLoading(show) {
    const loadingOverlay = document.getElementById('loading');
    if (loadingOverlay) {
        loadingOverlay.classList.toggle('active', show);
    }
}

/**
 * 安定した purchase_intent_id を取得する。
 * 初回に UUID を生成して保存し、以降は同じ ID を使う（後から購入状態を照会できる）。
 *
 * @returns {Promise<string>} purchase_intent_id
 */
async function getPurchaseIntentId() {
    const { forgepayPurchaseIntentId } = await chrome.storage.local.get([
        'forgepayPurchaseIntentId'
    ]);
    if (forgepayPurchaseIntentId != null && forgepayPurchaseIntentId !== '') {
        return forgepayPurchaseIntentId;
    }
    const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? `vt_${crypto.randomUUID()}`
            : `vt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await chrome.storage.local.set({ forgepayPurchaseIntentId: id });
    return id;
}

/**
 * 決済を開始する。
 *
 * @param {"subscription"|"onetime"} plan - 課金プラン
 */
async function startPayment(plan) {
    try {
        showLoading(true);
        console.info('[Payment] 開始:', plan);

        const purchaseIntentId = await getPurchaseIntentId();
        const apiUrl =
            globalThis.CONFIG.api.baseUrl + globalThis.CONFIG.api.endpoints.createCheckoutSession;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchase_intent_id: purchaseIntentId, plan })
        });

        const data = await response.json().catch(() => ({}));

        // 既に有効な権限がある → 重複課金を避けて成功ページへ
        if (response.status === 409) {
            console.info('[Payment] 既に有効な購入があります');
            globalThis.location.href = 'success.html';
            return;
        }

        if (!response.ok) {
            throw new Error(`API Error ${response.status}: ${data.message || ''}`);
        }

        if (!data.checkout_url) {
            throw new Error('checkout_url が返されませんでした');
        }

        // ForgePay 由来の Stripe Checkout へ遷移
        globalThis.location.href = data.checkout_url;
    } catch (error) {
        console.warn('[Payment] 決済 API 利用不可、無料モードで続行:', error);
        showLoading(false);

        await chrome.storage.local.set({
            subscriptionStatus: 'free',
            subscriptionExpiry: null,
            lastChecked: new Date().toISOString()
        });
        globalThis.location.href = 'success.html?mode=free';
    } finally {
        showLoading(false);
    }
}

/**
 * ページ読み込み時の初期化
 */
globalThis.addEventListener('load', () => {
    const subscribeBtn = document.getElementById('subscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', () => startPayment('subscription'));
    }

    const buyOnceBtn = document.getElementById('buyOnceBtn');
    if (buyOnceBtn) {
        buyOnceBtn.addEventListener('click', () => startPayment('onetime'));
    }

    console.info('[Init] サブスクリプションページ初期化完了');
});
