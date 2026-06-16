/**
 * voicetranslate-platform-adapter.js
 *
 * プラットフォーム差分アダプタ層
 * =====================================================================
 * 本アプリは「Electronローカルアプリ」「Chrome拡張」「通常ブラウザ」の
 * 3形態で同じ voicetranslate-*.js を共有して動作する。
 * 各形態で異なるのは下記の I/O 部分のみ:
 *   - APIキー / 設定の取得元（Electron=環境変数 / 他=なし）
 *   - WebSocket 伝送（Electron=mainプロセス経由IPC / 他=直接WSS）
 *   - 会話の永続化（Electron=SQLite / 他=非対応）
 *   - 音声ソース検出（Electron=会議アプリ自動検出 / 他=なし）
 *   - ストレージ（Chrome拡張=chrome.storage / 他=localStorage）
 *
 * これらの「個別部分」を本ファイル1箇所に隔離し、共通コードは
 * `getPlatform()` が返す単一インターフェースだけを呼ぶ。
 *
 * 読み込み順: 他の voicetranslate-*.js より「前」に読み込むこと。
 *
 * @example
 *   const platform = VoiceTranslatePlatform.getPlatform();
 *   if (platform.isElectron) { ... }
 *   await platform.saveToStorage('key', 'value');
 */
(function (root) {
    'use strict';

    /** Electron環境か（preload が electronAPI を contextBridge 経由で公開） */
    function hasElectron() {
        return typeof root.window !== 'undefined' && typeof root.window.electronAPI !== 'undefined';
    }

    /** Chrome拡張環境か（chrome.storage が利用可能） */
    function hasChromeExtension() {
        return typeof chrome !== 'undefined' && !!chrome.storage;
    }

    /**
     * 通常ブラウザ向け実装（既定）。
     * Chrome拡張はこれを継承し、ストレージのみ差し替える。
     */
    class BrowserPlatform {
        /** @returns {'browser'|'extension'|'electron'} */
        get kind() {
            return 'browser';
        }

        /** @returns {boolean} 既存コードの isElectron() 互換 */
        get isElectron() {
            return false;
        }

        /** @returns {boolean} 会話永続化(SQLite)に対応するか */
        get supportsConversation() {
            return false;
        }

        /** @returns {object|null} 会話永続化API（非対応環境は null） */
        get conversation() {
            return null;
        }

        // --- ストレージ ---
        /**
         * @param {string} key
         * @param {string} value
         */
        saveToStorage(key, value) {
            localStorage.setItem(key, value);
        }

        /**
         * @param {string} key
         * @returns {Promise<string|null>}
         */
        async getFromStorage(key) {
            return localStorage.getItem(key);
        }

        // --- 環境変数（APIキー / モデル設定） ---
        /** @returns {Promise<string|null>} 環境変数のAPIキー（非対応環境は null） */
        async getEnvApiKey() {
            return null;
        }

        /** @returns {Promise<object|null>} 環境変数のモデル設定（非対応環境は null） */
        async getEnvConfig() {
            return null;
        }

        // --- 音声ソース検出（Electron専用） ---
        /** @returns {Promise<Array|null>} 会議アプリ等のソース一覧（非対応環境は null） */
        async detectMeetingApps() {
            return null;
        }

        // --- WebSocket 伝送 ---
        // 注意: ブラウザ環境では WebSocket オブジェクトを呼び出し側の
        // state.ws が保持する（path-processors がリスナを直接付与するため）。
        // ここでは Electron の IPC 伝送のみを抽象化する。
        /**
         * Electron の Realtime WebSocket イベントを購読する。
         * ブラウザ環境では何もしない（呼び出し側が state.ws に直接付与）。
         * @param {{onOpen:Function,onMessage:Function,onError:Function,onClose:Function}} _handlers
         */
        subscribeRealtimeEvents(_handlers) {
            // ブラウザ環境では不要
        }

        /**
         * Electron の mainプロセス経由で WebSocket 接続を要求する。
         * ブラウザ環境では未対応（呼び出し側が直接 new WebSocket する）。
         * @returns {Promise<{success:boolean,message?:string}>}
         */
        async connectRealtime() {
            return { success: false, message: 'browser環境ではIPC接続は使用しません' };
        }

        /**
         * Electron 経由でメッセージ送信。ブラウザ環境では未対応を返す。
         * @returns {Promise<{success:boolean,message?:string}>}
         */
        async sendRealtime() {
            return { success: false, message: 'browser環境ではstate.wsを使用します' };
        }

        /** Electron 経由で接続を閉じる。ブラウザ環境では何もしない。 */
        async closeRealtime() {
            // ブラウザ環境では呼び出し側が state.ws.close() する
        }
    }

    /**
     * Chrome拡張向け実装。
     * 伝送・WSはブラウザと共通、ストレージのみ chrome.storage を使う。
     */
    class ExtensionPlatform extends BrowserPlatform {
        get kind() {
            return 'extension';
        }

        saveToStorage(key, value) {
            chrome.storage.local.set({ [key]: value });
        }

        async getFromStorage(key) {
            return new Promise((resolve) => {
                chrome.storage.local.get([key], (result) => {
                    resolve(result[key]);
                });
            });
        }
    }

    /**
     * Electron向け実装。electronAPI(preload経由) に全委譲する。
     */
    class ElectronPlatform {
        constructor() {
            /** @private */
            this._api = root.window.electronAPI;
        }

        get kind() {
            return 'electron';
        }

        get isElectron() {
            return true;
        }

        get supportsConversation() {
            return typeof this._api.conversation !== 'undefined';
        }

        get conversation() {
            return this.supportsConversation ? this._api.conversation : null;
        }

        // ストレージは Electron でも localStorage を使用（既存挙動を踏襲）
        saveToStorage(key, value) {
            localStorage.setItem(key, value);
        }

        async getFromStorage(key) {
            return localStorage.getItem(key);
        }

        async getEnvApiKey() {
            return this._api.getEnvApiKey();
        }

        async getEnvConfig() {
            return this._api.getEnvConfig();
        }

        async detectMeetingApps() {
            return this._api.detectMeetingApps();
        }

        subscribeRealtimeEvents(handlers) {
            this._api.on('realtime-ws-open', () => handlers.onOpen());
            this._api.on('realtime-ws-message', (message) => handlers.onMessage(message));
            this._api.on('realtime-ws-error', (error) => handlers.onError(error));
            this._api.on('realtime-ws-close', (data) => handlers.onClose(data));
        }

        async connectRealtime({ url, apiKey, model }) {
            return this._api.realtimeWebSocketConnect({ url, apiKey, model });
        }

        async sendRealtime(message) {
            return this._api.realtimeWebSocketSend(JSON.stringify(message));
        }

        async closeRealtime() {
            return this._api.realtimeWebSocketClose();
        }
    }

    /**
     * 現在の実行環境に応じたプラットフォーム実装を生成する。
     * @returns {BrowserPlatform|ExtensionPlatform|ElectronPlatform}
     */
    function createPlatform() {
        if (hasElectron()) {
            return new ElectronPlatform();
        }
        if (hasChromeExtension()) {
            return new ExtensionPlatform();
        }
        return new BrowserPlatform();
    }

    /** @type {BrowserPlatform|ExtensionPlatform|ElectronPlatform|null} */
    let singleton = null;

    /**
     * プラットフォーム実装のシングルトンを返す（初回のみ検出）。
     * 静的ファクトリ等 `this` を持たない箇所からも利用可能。
     * @returns {BrowserPlatform|ExtensionPlatform|ElectronPlatform}
     */
    function getPlatform() {
        if (singleton === null) {
            singleton = createPlatform();
        }
        return singleton;
    }

    root.VoiceTranslatePlatform = {
        getPlatform,
        createPlatform,
        BrowserPlatform,
        ExtensionPlatform,
        ElectronPlatform
    };

    // CommonJS（テスト/将来のバンドル用）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.VoiceTranslatePlatform;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
