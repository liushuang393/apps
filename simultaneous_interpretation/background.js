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
    console.info('[Background] 拡張機能アイコンがクリックされました');

    try {
        // 既存のウィンドウが存在するか確認
        if (translatorWindowId !== null) {
            try {
                await chrome.windows.get(translatorWindowId);

                // ウィンドウが存在する場合、フォーカスを当てる
                console.info('[Background] 既存のウィンドウにフォーカス:', translatorWindowId);
                await chrome.windows.update(translatorWindowId, { focused: true });
                return;
            } catch {
                // ウィンドウが存在しない場合（ユーザーが閉じた）
                console.info(
                    '[Background] 既存のウィンドウが見つかりません。新しいウィンドウを作成します。'
                );
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
        console.info('[Background] 新しいウィンドウを作成しました:', translatorWindowId);
    } catch (error) {
        console.error('[Background] ウィンドウ作成エラー:', error);
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
        console.info('[Background] 翻訳ウィンドウが閉じられました:', windowId);
        translatorWindowId = null;
    }
});

console.info('[Background] Service Worker起動完了');
