/**
 * popup.ts
 * 
 * 目的: ブラウザ拡張機能のエントリーポイント
 * 
 * 注意:
 *   - このファイルは teams-realtime-translator.html から読み込まれる
 *   - 現在は既存の voicetranslate-pro.js を使用
 *   - 将来的に VoiceTranslateCore.ts が完成したら、それを使用するように変更
 */

import { browserAdapter } from './BrowserAdapter';
import { CONFIG } from '../../src/core/Config';

/**
 * アプリケーション初期化
 */
async function initializeApp(): Promise<void> {
    console.log('[Popup] VoiceTranslate Pro 初期化開始');

    try {
        // ブラウザアダプターの初期化確認
        console.log('[Popup] BrowserAdapter 初期化完了');

        // 設定の読み込み
        const apiKey = await browserAdapter.storage.load('openai_api_key');
        const sourceLang = await browserAdapter.storage.load('source_lang');
        const targetLang = await browserAdapter.storage.load('target_lang');

        console.log('[Popup] 設定読み込み完了:', {
            hasApiKey: !!apiKey,
            sourceLang: sourceLang || 'ja',
            targetLang: targetLang || 'en'
        });

        // マイク権限チェック
        const hasMicPermission = await browserAdapter.checkMicrophonePermission();
        if (!hasMicPermission) {
            console.warn('[Popup] マイク権限がありません');
            browserAdapter.notify({
                title: '権限エラー',
                message: 'マイクへのアクセス権限が必要です',
                type: 'warning'
            });
        }

        // 音声ソースの検出
        const audioSources = await browserAdapter.detectAudioSources();
        console.log('[Popup] 音声ソース検出:', audioSources.length, '個');

        // 通知: 初期化完了
        browserAdapter.notify({
            title: 'システム準備完了',
            message: 'VoiceTranslate Pro が起動しました',
            type: 'success',
            duration: 2000
        });

        console.log('[Popup] VoiceTranslate Pro 初期化完了');

    } catch (error) {
        console.error('[Popup] 初期化エラー:', error);
        browserAdapter.notify({
            title: '初期化エラー',
            message: 'アプリケーションの初期化に失敗しました',
            type: 'error'
        });
    }
}

/**
 * DOM読み込み完了時の処理
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Popup] DOM読み込み完了');
    initializeApp();
});

/**
 * ウィンドウアンロード時の処理
 */
window.addEventListener('beforeunload', () => {
    console.log('[Popup] ウィンドウクローズ');
    // クリーンアップ処理（必要に応じて追加）
});

/**
 * グローバルエクスポート（デバッグ用）
 */
if (CONFIG.DEBUG_MODE) {
    (window as any).browserAdapter = browserAdapter;
    console.log('[Popup] デバッグモード: browserAdapter をグローバルに公開');
}

