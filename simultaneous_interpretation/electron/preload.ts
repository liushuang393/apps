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
     *   - realtimeModel: Realtime API用モデル（音声→音声翻訳、音声認識）
     *   - chatModel: Chat Completions API用モデル（言語検出、テキスト翻訳）
     *   - transcribeModel: 入力音声認識用モデル
     *   - realtimeUrl: Realtime API URL
     */
    getEnvConfig: () => Promise<{
        realtimeModel: string;
        chatModel: string;
        transcribeModel: string;
        realtimeUrl: string;
        translation: {
            turnMode?: string;
            vadType?: string;
            semanticEagerness?: string;
            maxSentences?: number;
            postSentenceHoldMs?: number;
            maxBufferMs?: number;
        };
    }>;

    /**
     * 会話データベース API
     */
    conversation: {
        startSession: (sourceLanguage?: string, targetLanguage?: string) => Promise<number>;
        endSession: () => Promise<void>;
        addTurn: (turn: {
            role: 'user' | 'assistant';
            content: string;
            language?: string;
            timestamp: number;
        }) => Promise<number>;
        getRecentTurns: (count?: number, sessionId?: number) => Promise<unknown[]>;
        getContextForAPI: (
            count?: number,
            sessionId?: number
        ) => Promise<Array<{ role: string; content: string }>>;
        getStats: () => Promise<{
            totalSessions: number;
            totalTurns: number;
            currentSessionTurns: number;
            averageTurnsPerSession: number;
        }>;
        getAllSessions: (limit?: number) => Promise<unknown[]>;
        getSessionTurns: (sessionId: number) => Promise<unknown[]>;
        cleanupOldSessions: (daysToKeep?: number) => Promise<number>;
    };

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
 * off() で実際にリスナーを解除できるようにするための対応表。
 * 元コールバック → （チャネル → ipcRenderer に登録したラッパー関数）
 *
 * 注意: 同一コールバックを同一チャネルに二重登録すると後勝ちで上書きされる
 * （現状の呼び出し元に該当ケースは無い）。
 */
const ipcListenerRegistry = new Map<
    (...args: unknown[]) => void,
    Map<string, (event: Electron.IpcRendererEvent, ...args: unknown[]) => void>
>();

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
     *   - realtimeModel: Realtime API用モデル
     *   - chatModel: Chat Completions API用モデル
     *   - realtimeUrl: Realtime API URL
     */
    getEnvConfig: async () => {
        return await ipcRenderer.invoke('get-env-config');
    },

    /**
     * 会話データベース API 実装
     */
    conversation: {
        startSession: async (sourceLanguage?: string, targetLanguage?: string) => {
            return await ipcRenderer.invoke(
                'conversation:start-session',
                sourceLanguage,
                targetLanguage
            );
        },
        endSession: async () => {
            return await ipcRenderer.invoke('conversation:end-session');
        },
        addTurn: async (turn: {
            role: 'user' | 'assistant';
            content: string;
            language?: string;
            timestamp: number;
        }) => {
            return await ipcRenderer.invoke('conversation:add-turn', turn);
        },
        getRecentTurns: async (count?: number, sessionId?: number) => {
            return await ipcRenderer.invoke('conversation:get-recent-turns', count, sessionId);
        },
        getContextForAPI: async (count?: number, sessionId?: number) => {
            return await ipcRenderer.invoke('conversation:get-context-for-api', count, sessionId);
        },
        getStats: async () => {
            return await ipcRenderer.invoke('conversation:get-stats');
        },
        getAllSessions: async (limit?: number) => {
            return await ipcRenderer.invoke('conversation:get-all-sessions', limit);
        },
        getSessionTurns: async (sessionId: number) => {
            return await ipcRenderer.invoke('conversation:get-session-turns', sessionId);
        },
        cleanupOldSessions: async (daysToKeep?: number) => {
            return await ipcRenderer.invoke('conversation:cleanup-old-sessions', daysToKeep);
        }
    },

    /**
     * イベントリスナーを登録
     *
     * ipcRenderer.on にはラッパー関数を渡すため、off() で解除できるよう
     * 元コールバック→（チャネル→ラッパー）の対応を ipcListenerRegistry に保持する。
     * （旧実装は off() に元コールバックを渡しており永久に解除不能＝リスナー蓄積の温床）
     */
    on: (channel: string, callback: (...args: unknown[]) => void) => {
        if (ALLOWED_CHANNELS.receive.includes(channel)) {
            const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
                callback(...args);
            };
            let byChannel = ipcListenerRegistry.get(callback);
            if (byChannel === undefined) {
                byChannel = new Map();
                ipcListenerRegistry.set(callback, byChannel);
            }
            byChannel.set(channel, wrapped);
            ipcRenderer.on(channel, wrapped);
        } else {
            console.warn(`[Preload] Channel not allowed: ${channel}`);
        }
    },

    /**
     * イベントリスナーを解除
     */
    off: (channel: string, callback: (...args: unknown[]) => void) => {
        if (ALLOWED_CHANNELS.receive.includes(channel)) {
            const byChannel = ipcListenerRegistry.get(callback);
            const wrapped = byChannel?.get(channel);
            if (byChannel !== undefined && wrapped !== undefined) {
                ipcRenderer.removeListener(channel, wrapped);
                byChannel.delete(channel);
                if (byChannel.size === 0) {
                    ipcListenerRegistry.delete(callback);
                }
            }
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
console.info('[Preload] Electron API exposed to renderer process');
console.info('[Preload] Platform:', electronAPI.platform);
console.info('[Preload] Versions:', electronAPI.versions);
