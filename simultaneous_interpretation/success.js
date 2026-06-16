/**
 * VoiceTranslate Pro - 支払い成功ページスクリプト
 *
 * 公式手順書 `docs/ForgePay決済システムの他システム実装指南.md` §6 に準拠。
 *   - 決済直後は URL の unlock_token（ForgePay が success_url に付与）で照会するのが最確。
 *   - token が無い再訪問時は、保持中の purchase_intent_id で照会する。
 */

/**
 * 安定した purchase_intent_id を取得する（subscription.js と同じロジック）。
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
 * 購入/サブスクリプション状態を確認して保存する。
 */
async function verifyAndSaveSubscription() {
    try {
        const urlParams = new URLSearchParams(globalThis.location.search);
        const isFreeMode = urlParams.get('mode') === 'free';

        if (isFreeMode) {
            console.info('[Success] 無料モードで開始');
            await chrome.storage.local.set({
                subscriptionStatus: 'free',
                subscriptionExpiry: null,
                lastChecked: new Date().toISOString()
            });
            return;
        }

        // ForgePay が success_url に付与する unlock_token（あれば最優先）
        const unlockToken = urlParams.get('unlock_token') || urlParams.get('token');

        /** @type {object} */
        const requestBody = {};
        if (unlockToken) {
            requestBody.unlock_token = unlockToken;
        } else {
            requestBody.purchase_intent_id = await getPurchaseIntentId();
        }

        const apiUrl =
            globalThis.CONFIG.api.baseUrl + globalThis.CONFIG.api.endpoints.checkSubscription;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`サブスクリプション確認 API エラー: ${response.status}`);
        }

        const data = await response.json();

        await chrome.storage.local.set({
            subscriptionStatus: data.isActive ? data.status || 'active' : 'free',
            subscriptionExpiry: data.expiresAt || null,
            lastChecked: new Date().toISOString()
        });

        console.info('[Success] 購入状態を保存しました:', data);
    } catch (error) {
        console.error('[Success] 購入状態確認エラー:', error);
        // エラー時は無料モードとして保存（誤って有料扱いしない＝安全側）
        await chrome.storage.local.set({
            subscriptionStatus: 'free',
            subscriptionExpiry: null,
            lastChecked: new Date().toISOString()
        });
    }
}

/**
 * 翻訳画面へ遷移
 */
function startTranslation() {
    globalThis.location.href = 'teams-realtime-translator.html';
}

/**
 * ページ読み込み時の初期化
 */
globalThis.addEventListener('load', () => {
    verifyAndSaveSubscription();

    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startTranslation);
    }
});
