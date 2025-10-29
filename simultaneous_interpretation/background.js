/**
 * VoiceTranslate Pro - Background Service Worker
 *
 * 目的:
 *   拡張機能アイコンクリック時に独立ウィンドウを開く
 *   ウィンドウが閉じられるまで状態を保持
 *
 * 注意:
 *   Manifest V3のService Workerとして動作
 */

// ウィンドウIDを保存（既存のウィンドウを再利用）
let translatorWindowId = null;

/**
 * 拡張機能アイコンクリック時の処理
 *
 * 目的:
 *   独立ウィンドウを開く、または既存のウィンドウにフォーカス
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

        // 新しいウィンドウを作成
        const window = await chrome.windows.create({
            url: 'teams-realtime-translator.html',
            type: 'popup',
            width: 450,
            height: 700,
            focused: true
        });

        translatorWindowId = window.id;
    } catch (error) {
        // エラーは無視（本番環境）
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
