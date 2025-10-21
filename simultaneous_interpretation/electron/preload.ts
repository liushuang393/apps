/**
 * Electron プリロードスクリプト
 *
 * @description
 * レンダラープロセスとメインプロセス間の安全な通信を提供。
 * contextBridge を使用してセキュアな API を公開。
 *
 * @features
 * - IPC 通信の安全なブリッジ
 * - ウィンドウ制御 API
 * - システム情報 API
 * - 設定管理 API
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Electron API インターフェース
 */
export interface ElectronAPI {
    /**
     * ウィンドウを最小化
     */
    minimizeWindow: () => void;

    /**
     * ウィンドウを最大化/復元
     */
    maximizeWindow: () => void;

    /**
     * ウィンドウを閉じる
     */
    closeWindow: () => void;

    /**
     * 常に最前面に表示を切り替え
     */
    toggleAlwaysOnTop: () => void;

    /**
     * 設定を取得
     */
    getConfig: () => Promise<unknown>;

    /**
     * 設定を保存
     */
    saveConfig: (config: unknown) => Promise<boolean>;

    /**
     * 音声ソースを取得
     */
    getAudioSources: (types?: ('window' | 'screen')[]) => Promise<unknown[]>;

    /**
     * 会議アプリを検出
     */
    detectMeetingApps: () => Promise<unknown[]>;

    /**
     * 音声ソース ID を検証
     */
    validateSourceId: (sourceId: string) => Promise<boolean>;

    /**
     * 音声トラックの有無を確認
     */
    checkAudioTrack: (sourceId: string) => Promise<boolean>;

    /**
     * Realtime WebSocket 接続
     */
    realtimeWebSocketConnect: (config: {
        url: string;
        apiKey: string;
        model: string;
    }) => Promise<{ success: boolean; message?: string }>;

    /**
     * Realtime WebSocket メッセージ送信
     */
    realtimeWebSocketSend: (message: string) => Promise<{ success: boolean; message?: string }>;

    /**
     * Realtime WebSocket 切断
     */
    realtimeWebSocketClose: () => Promise<{ success: boolean; message?: string }>;

    /**
     * Realtime WebSocket 状態取得
     */
    realtimeWebSocketState: () => Promise<{ state: string; readyState: number }>;

    /**
     * 環境変数からAPIキーを取得
     */
    getEnvApiKey: () => Promise<string | null>;

    /**
     * 環境変数から設定を取得
     *
     * @returns モデル設定オブジェクト
     *   - speechRecognitionModel: 音声認識モデル（入力音声 → 入力テキスト）
     *   - translationModel: 翻訳モデル（入力テキスト → 翻訳テキスト）
     *   - voiceToVoiceModel: 音声→音声翻訳モデル（入力音声 → 翻訳音声）
     *   - realtimeUrl: Realtime API URL
     */
    getEnvConfig: () => Promise<{
        speechRecognitionModel: string;
        translationModel: string;
        voiceToVoiceModel: string;
        realtimeUrl: string;
    }>;

    /**
     * イベントリスナーを登録
     */
    on: (channel: string, callback: (...args: unknown[]) => void) => void;

    /**
     * イベントリスナーを解除
     */
    off: (channel: string, callback: (...args: unknown[]) => void) => void;

    /**
     * プラットフォーム情報を取得
     */
    platform: string;

    /**
     * Electron バージョンを取得
     */
    versions: {
        node: string;
        chrome: string;
        electron: string;
    };
}

/**
 * 許可されたチャンネル
 */
const ALLOWED_CHANNELS = {
    send: ['minimize-window', 'maximize-window', 'close-window', 'toggle-always-on-top'],
    receive: [
        'open-settings',
        'always-on-top-changed',
        'realtime-ws-open',
        'realtime-ws-message',
        'realtime-ws-error',
        'realtime-ws-close'
    ],
    invoke: [
        'get-config',
        'save-config',
        'get-audio-sources',
        'detect-meeting-apps',
        'validate-source-id',
        'check-audio-track',
        'realtime-ws-connect',
        'realtime-ws-send',
        'realtime-ws-close',
        'realtime-ws-state',
        'get-env-api-key'
    ]
};

/**
 * Electron API を公開
 */
const electronAPI: ElectronAPI = {
    /**
     * ウィンドウを最小化
     */
    minimizeWindow: () => {
        ipcRenderer.send('minimize-window');
    },

    /**
     * ウィンドウを最大化/復元
     */
    maximizeWindow: () => {
        ipcRenderer.send('maximize-window');
    },

    /**
     * ウィンドウを閉じる
     */
    closeWindow: () => {
        ipcRenderer.send('close-window');
    },

    /**
     * 常に最前面に表示を切り替え
     */
    toggleAlwaysOnTop: () => {
        ipcRenderer.send('toggle-always-on-top');
    },

    /**
     * 設定を取得
     */
    getConfig: async () => {
        return await ipcRenderer.invoke('get-config');
    },

    /**
     * 設定を保存
     */
    saveConfig: async (config: unknown) => {
        return await ipcRenderer.invoke('save-config', config);
    },

    /**
     * 音声ソースを取得
     */
    getAudioSources: async (types?: ('window' | 'screen')[]) => {
        return await ipcRenderer.invoke('get-audio-sources', types);
    },

    /**
     * 会議アプリを検出
     */
    detectMeetingApps: async () => {
        return await ipcRenderer.invoke('detect-meeting-apps');
    },

    /**
     * 音声ソース ID を検証
     */
    validateSourceId: async (sourceId: string) => {
        return await ipcRenderer.invoke('validate-source-id', sourceId);
    },

    /**
     * 音声トラックの有無を確認
     */
    checkAudioTrack: async (sourceId: string) => {
        return await ipcRenderer.invoke('check-audio-track', sourceId);
    },

    /**
     * Realtime WebSocket 接続
     */
    realtimeWebSocketConnect: async (config: { url: string; apiKey: string; model: string }) => {
        return await ipcRenderer.invoke('realtime-ws-connect', config);
    },

    /**
     * Realtime WebSocket メッセージ送信
     */
    realtimeWebSocketSend: async (message: string) => {
        return await ipcRenderer.invoke('realtime-ws-send', message);
    },

    /**
     * Realtime WebSocket 切断
     */
    realtimeWebSocketClose: async () => {
        return await ipcRenderer.invoke('realtime-ws-close');
    },

    /**
     * Realtime WebSocket 状態取得
     */
    realtimeWebSocketState: async () => {
        return await ipcRenderer.invoke('realtime-ws-state');
    },

    /**
     * 環境変数からAPIキーを取得
     */
    getEnvApiKey: async () => {
        return await ipcRenderer.invoke('get-env-api-key');
    },

    /**
     * 環境変数から設定を取得
     *
     * @returns モデル設定オブジェクト
     *   - speechRecognitionModel: 音声認識モデル
     *   - translationModel: 翻訳モデル
     *   - voiceToVoiceModel: 音声→音声翻訳モデル
     *   - realtimeUrl: Realtime API URL
     */
    getEnvConfig: async () => {
        return await ipcRenderer.invoke('get-env-config');
    },

    /**
     * イベントリスナーを登録
     */
    on: (channel: string, callback: (...args: unknown[]) => void) => {
        if (ALLOWED_CHANNELS.receive.includes(channel)) {
            ipcRenderer.on(channel, (_event, ...args) => callback(...args));
        } else {
            console.warn(`[Preload] Channel not allowed: ${channel}`);
        }
    },

    /**
     * イベントリスナーを解除
     */
    off: (channel: string, callback: (...args: unknown[]) => void) => {
        if (ALLOWED_CHANNELS.receive.includes(channel)) {
            ipcRenderer.removeListener(channel, callback);
        }
    },

    /**
     * プラットフォーム情報を取得
     */
    platform: process.platform,

    /**
     * Electron バージョンを取得
     */
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron || 'unknown'
    }
};

/**
 * contextBridge を使用して API を公開
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

/**
 * デバッグ情報を出力
 */
console.log('[Preload] Electron API exposed to renderer process');
console.log('[Preload] Platform:', electronAPI.platform);
console.log('[Preload] Versions:', electronAPI.versions);
