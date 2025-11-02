/**
 * VoiceTranslate Pro - 支払い成功ページスクリプト
 *
 * 目的:
 *   支払い成功後、サブスクリプション状態を確認して保存
 *
 * フロー:
 *   1. Vercel APIでサブスクリプション状態を確認
 *   2. Chrome Storageに保存
 *   3. 翻訳画面へ遷移
 */

/**
 * サブスクリプション状態を確認して保存
 */
async function verifyAndSaveSubscription() {
    try {
        // URLパラメータから無料モードかどうかを判定
        const urlParams = new URLSearchParams(globalThis.location.search);
        const isFreeMode = urlParams.get('mode') === 'free';

        if (isFreeMode) {
            // 無料モードの場合、無料状態を保存
            console.info('[Success] 無料モードで開始');
            await chrome.storage.local.set({
                subscriptionStatus: 'free',
                subscriptionExpiry: null,
                lastChecked: new Date().toISOString()
            });
            return;
        }

        // Supabaseセッションを取得
        const { supabaseSession } = await chrome.storage.local.get(['supabaseSession']);

        if (!supabaseSession || !supabaseSession.access_token) {
            console.warn('Supabaseセッションが見つかりません');

            // デフォルトのトライアル状態を保存
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 7);

            await chrome.storage.local.set({
                subscriptionStatus: 'trialing',
                subscriptionExpiry: expiryDate.toISOString(),
                lastChecked: new Date().toISOString()
            });

            return;
        }

        // Vercel APIを呼び出してサブスクリプション状態を確認
        const apiUrl = globalThis.CONFIG.api.baseUrl + globalThis.CONFIG.api.endpoints.checkSubscription;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: supabaseSession.access_token
            })
        });

        if (!response.ok) {
            throw new Error('サブスクリプション確認APIエラー');
        }

        const data = await response.json();

        // ローカルストレージに保存
        await chrome.storage.local.set({
            subscriptionStatus: data.status,
            subscriptionExpiry: data.expiry || null,
            lastChecked: new Date().toISOString()
        });

        console.log('サブスクリプション状態を保存しました:', data);
    } catch (error) {
        console.error('サブスクリプション確認エラー:', error);

        // エラー時はデフォルトのトライアル状態を保存
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7);

        await chrome.storage.local.set({
            subscriptionStatus: 'trialing',
            subscriptionExpiry: expiryDate.toISOString(),
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
    // サブスクリプション状態を確認
    verifyAndSaveSubscription();

    // 翻訳開始ボタン
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startTranslation);
    }
});

