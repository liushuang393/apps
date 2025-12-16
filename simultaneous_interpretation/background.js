/**
 * VoiceTranslate Pro - Background Service Worker
 *
 * 目的:
 *   拡張機能アイコンクリック時に独立ウィンドウを開く
 *   サブスクリプション状態を確認
 *   ウィンドウが閉じられるまで状態を保持
 *
 * 注意:
 *   Manifest V3のService Workerとして動作
 */

// 設定を読み込み
importScripts('config.js');

// ウィンドウIDを保存（既存のウィンドウを再利用）
let translatorWindowId = null;

/**
 * サブスクリプション状態を確認（Supabaseから）
 *
 * 目的:
 *   Supabaseデータベースから最新のサブスクリプション状態を取得
 *
 * 戻り値:
 *   true: サブスクリプション有効
 *   false: サブスクリプション無効または未登録
 */
async function checkSubscriptionStatus() {
    try {
        // Supabaseセッションを取得
        const { supabaseSession } = await chrome.storage.local.get(['supabaseSession']);

        if (!supabaseSession || !supabaseSession.access_token) {
            // ログインしていない → ローカルキャッシュをチェック
            return await checkSubscriptionFromCache();
        }

        // Vercel APIを呼び出してサブスクリプション状態を確認
        const apiUrl = CONFIG.api.baseUrl + CONFIG.api.endpoints.checkSubscription;
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
            // APIエラー → ローカルキャッシュをチェック
            return await checkSubscriptionFromCache();
        }

        const data = await response.json();

        // ローカルストレージに保存（キャッシュ）
        await chrome.storage.local.set({
            subscriptionStatus: data.status,
            subscriptionExpiry: data.expiry || null,
            lastChecked: new Date().toISOString()
        });

        return data.isActive === true;
    } catch (error) {
        console.error('サブスクリプション確認エラー:', error);

        // エラー時はローカルキャッシュをチェック
        return await checkSubscriptionFromCache();
    }
}

/**
 * キャッシュからサブスクリプション状態を確認
 *
 * 目的:
 *   ネットワークエラー時のフォールバック
 */
async function checkSubscriptionFromCache() {
    try {
        const result = await chrome.storage.local.get(['subscriptionStatus', 'subscriptionExpiry']);

        // キャッシュが存在しない場合
        if (!result.subscriptionStatus) {
            return false;
        }

        // 有効期限をチェック
        if (result.subscriptionExpiry) {
            const expiryDate = new Date(result.subscriptionExpiry);
            const now = new Date();

            if (now > expiryDate) {
                return false;
            }
        }

        return result.subscriptionStatus === 'active' || result.subscriptionStatus === 'trialing';
    } catch (error) {
        console.error('キャッシュ確認エラー:', error);
        return false;
    }
}

/**
 * 拡張機能アイコンクリック時の処理
 *
 * 目的:
 *   サブスクリプション状態を確認し、適切なウィンドウを開く
 */
chrome.action.onClicked.addListener(async () => {
    try {
        // 既存のウィンドウが存在するか確認
        if (translatorWindowId !== null) {
            try {
                await chrome.windows.get(translatorWindowId);

                // ウィンドウが存在する場合、フォーカスを当てる
                await chrome.windows.update(translatorWindowId, { focused: true });
                return;
            } catch {
                // ウィンドウが存在しない場合（ユーザーが閉じた）
                translatorWindowId = null;
            }
        }

        // サブスクリプション状態を確認
        const hasActiveSubscription = await checkSubscriptionStatus();

        // 開くページを決定
        const pageUrl = hasActiveSubscription
            ? 'teams-realtime-translator.html'  // サブスクリプション有効 → 翻訳画面
            : 'subscription.html';               // サブスクリプション無効 → 購読画面

        // 新しいウィンドウを作成
        const window = await chrome.windows.create({
            url: pageUrl,
            type: 'popup',
            width: 450,
            height: 700,
            focused: true
        });

        translatorWindowId = window.id;
    } catch (error) {
        console.error('ウィンドウ作成エラー:', error);
    }
});

/**
 * ウィンドウが閉じられた時の処理
 *
 * 目的:
 *   ウィンドウIDをクリアして、次回新しいウィンドウを作成できるようにする
 */
chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === translatorWindowId) {
        translatorWindowId = null;
    }
});
