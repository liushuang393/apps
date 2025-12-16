/**
 * VoiceTranslate Pro - サブスクリプションページスクリプト
 *
 * 目的:
 *   Googleログイン → Stripe Checkout → サブスクリプション開始
 *
 * フロー:
 *   1. Googleでログイン（Supabase Auth）
 *   2. Stripe Checkoutセッションを作成（Vercel API）
 *   3. Stripeの支払いページにリダイレクト
 */

// Stripe クライアント（遅延初期化）
let stripe = null;

/**
 * Stripe クライアントを取得（遅延初期化）
 */
function getStripeClient() {
    if (!stripe) {
        if (
            !globalThis.CONFIG ||
            !globalThis.CONFIG.stripe ||
            !globalThis.CONFIG.stripe.publishableKey
        ) {
            throw new Error('Stripe設定が見つかりません');
        }
        if (typeof globalThis.Stripe !== 'function') {
            throw new TypeError('Stripe wrapper が読み込まれていません');
        }
        stripe = globalThis.Stripe(globalThis.CONFIG.stripe.publishableKey);
        console.info('[Stripe] クライアント初期化完了');
    }
    return stripe;
}

/**
 * ローディング表示の切り替え
 */
function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = show ? 'flex' : 'none';
    }
}

/**
 * サブスクリプション開始処理
 *
 * Chrome拡張機能では、認証なしで直接Stripe Checkoutに進む
 * APIエラー時は無料モードとして処理
 */
async function startSubscription() {
    try {
        showLoading(true);
        console.info('[Subscription] サブスクリプション開始');

        // Chrome拡張機能のIDを使用
        const extensionId = chrome.runtime.id;
        const userId = `ext_${extensionId}_${Date.now()}`;

        console.info('[Subscription] User ID:', userId);

        // Stripe Checkoutセッションを作成
        const sessionId = await createCheckoutSession(userId);

        console.info('[Subscription] Session ID:', sessionId);

        // Stripeチェックアウトページにリダイレクト
        const stripeClient = getStripeClient();
        const result = await stripeClient.redirectToCheckout({ sessionId });

        if (result.error) {
            throw new Error(result.error.message);
        }
    } catch (error) {
        console.warn('[Subscription] API利用不可、無料モードで続行:', error);

        // ローディングを非表示
        showLoading(false);

        // 無料モードとして保存
        await chrome.storage.local.set({
            subscriptionStatus: 'free',
            subscriptionExpiry: null,
            lastChecked: new Date().toISOString()
        });

        // 成功ページにリダイレクト（無料モード）
        globalThis.location.href = 'success.html?mode=free';
    } finally {
        // 念のため、ローディングを非表示
        showLoading(false);
    }
}

/**
 * Stripe Checkoutセッションを作成
 *
 * @param {string} userId - ユーザーID
 * @returns {Promise<string>} Stripe Checkout Session ID
 */
async function createCheckoutSession(userId) {
    try {
        console.info('[Checkout] セッション作成開始');

        // Vercel APIを呼び出してStripe Checkoutセッションを作成
        const apiUrl =
            globalThis.CONFIG.api.baseUrl + globalThis.CONFIG.api.endpoints.createCheckoutSession;

        console.info('[Checkout] API URL:', apiUrl);

        const requestBody = {
            userId: userId,
            successUrl: chrome.runtime.getURL('subscription-success.html'),
            cancelUrl: chrome.runtime.getURL('subscription.html')
        };

        console.info('[Checkout] Request:', requestBody);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.info('[Checkout] Response status:', response.status);
        console.info(
            '[Checkout] Response headers:',
            Object.fromEntries(response.headers.entries())
        );

        if (!response.ok) {
            let errorText = '';
            try {
                errorText = await response.text();
            } catch (readError) {
                console.error('[Checkout] レスポンス読み取りエラー:', readError);
                errorText = 'レスポンスの読み取りに失敗';
            }
            console.error('[Checkout] Error response:', errorText);
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        // レスポンスボディを取得
        const responseText = await response.text();
        console.info('[Checkout] Response text:', responseText);

        // JSONパース
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('[Checkout] JSON parse error:', parseError);
            throw new Error(`JSONパースエラー: ${responseText.substring(0, 100)}`);
        }

        console.info('[Checkout] Response data:', data);

        if (!data.sessionId) {
            throw new Error('Session ID が返されませんでした');
        }

        return data.sessionId;
    } catch (error) {
        console.error('[Checkout] エラー:', error);
        throw error;
    }
}

/**
 * ページ読み込み時の初期化
 */
globalThis.addEventListener('load', () => {
    console.info('[Init] ========== ページ読み込み開始 ==========');
    console.info('[Init] CONFIG:', globalThis.CONFIG);
    console.info('[Init] Stripe wrapper:', typeof globalThis.Stripe);

    // イベントリスナーを設定
    const subscribeBtn = document.getElementById('subscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', startSubscription);
        console.info('[Init] Subscribe button イベント登録完了');
    } else {
        console.error('[Init] Subscribe button が見つかりません');
    }

    console.info('[Init] ========== 初期化完了 ==========');
});
