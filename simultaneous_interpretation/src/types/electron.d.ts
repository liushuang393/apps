/**
 * Electron API 型定義
 *
 * @description
 * レンダラープロセスで使用する Electron API の型定義。
 * window.electronAPI として公開される。
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 音声ソース情報
 */
export interface AudioSource {
    id: string;
    name: string;
    type: string;
    thumbnail?: string;
}

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
    getConfig: () => Promise<AppConfig>;

    /**
     * 設定を保存
     */
    saveConfig: (config: Partial<AppConfig>) => Promise<boolean>;

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

    /**
     * 音声ソースを取得
     */
    getAudioSources: (types: string[]) => Promise<AudioSource[]>;

    /**
     * 会議アプリを検出
     */
    detectMeetingApps: () => Promise<AudioSource[]>;

    /**
     * ソース ID を検証
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
     * 環境変数からモデル設定を取得
     */
    getEnvConfig: () => Promise<{
        speechRecognitionModel: string;
        translationModel: string;
        voiceToVoiceModel: string;
        realtimeUrl: string;
    }>;

    /**
     * システム音声ストリームを取得（Electron専用）
     */
    getSystemAudioStream?: (sourceId?: string) => Promise<MediaStream>;
}

/**
 * アプリケーション設定
 */
export interface AppConfig {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    alwaysOnTop: boolean;
    startMinimized: boolean;
}

/**
 * Performance Memory 情報
 */
export interface PerformanceMemory {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
}

/**
 * Window オブジェクトの拡張
 */
declare global {
    interface Window {
        electronAPI?: ElectronAPI;
        webkitAudioContext?: typeof AudioContext;
    }

    interface Performance {
        memory?: PerformanceMemory;
    }
}

export {};
