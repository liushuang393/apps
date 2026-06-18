/**
 * WebSocket アダプターインターフェース
 *
 * @description
 * ブラウザとElectronの WebSocket 実装を統一
 * 異なる環境での WebSocket 通信を抽象化
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * WebSocket 接続状態
 */
export enum WebSocketState {
    /** 未接続 */
    DISCONNECTED = 'disconnected',
    /** 接続中 */
    CONNECTING = 'connecting',
    /** 接続済み */
    CONNECTED = 'connected',
    /** 切断中 */
    DISCONNECTING = 'disconnecting',
    /** エラー */
    ERROR = 'error'
}

/**
 * WebSocket 設定
 */
export interface WebSocketConfig {
    /** WebSocket URL */
    url: string;
    /** API キー */
    apiKey: string;
    /** モデル名 */
    model: string;
    /** 追加ヘッダー */
    headers?: Record<string, string>;
    /** 接続タイムアウト (ms) */
    connectionTimeout?: number;
    /** 再接続設定 */
    reconnect?: {
        /** 再接続を有効化 */
        enabled: boolean;
        /** 最大再接続試行回数 */
        maxAttempts: number;
        /** 初期遅延 (ms) */
        initialDelay: number;
        /** 最大遅延 (ms) */
        maxDelay: number;
        /** 指数バックオフ係数 */
        backoffMultiplier: number;
    };
}

/**
 * WebSocket メッセージ
 */
export interface WebSocketMessage {
    /** メッセージタイプ */
    type: string;
    /** メッセージデータ */
    data?: unknown;
    /** タイムスタンプ */
    timestamp?: number;
}

/**
 * WebSocket エラー
 */
export interface WebSocketError {
    /** エラーコード */
    code: string;
    /** エラーメッセージ */
    message: string;
    /** 詳細情報 */
    details?: unknown;
    /** リトライ可能か */
    retryable: boolean;
}

/**
 * WebSocket イベント
 */
export interface WebSocketEvents {
    /** 接続確立 */
    onOpen?: () => void;
    /** メッセージ受信 */
    onMessage?: (message: WebSocketMessage) => void;
    /** エラー発生 */
    onError?: (error: WebSocketError) => void;
    /** 接続切断 */
    onClose?: (code: number, reason: string) => void;
    /** 再接続開始 */
    onReconnecting?: (attempt: number) => void;
    /** 再接続成功 */
    onReconnected?: () => void;
}

/**
 * WebSocket アダプターインターフェース
 */
export interface IWebSocketAdapter {
    /**
     * WebSocket を初期化
     *
     * @param config - WebSocket 設定
     * @param events - イベントハンドラ
     */
    initialize(config: WebSocketConfig, events?: WebSocketEvents): Promise<void>;

    /**
     * 接続を確立
     */
    connect(): Promise<void>;

    /**
     * 接続を切断
     *
     * @param code - クローズコード
     * @param reason - クローズ理由
     */
    disconnect(code?: number, reason?: string): Promise<void>;

    /**
     * メッセージを送信
     *
     * @param message - 送信するメッセージ
     */
    send(message: WebSocketMessage | string): Promise<void>;

    /**
     * バイナリデータを送信
     *
     * @param data - 送信するバイナリデータ
     */
    sendBinary(data: ArrayBuffer): Promise<void>;

    /**
     * 接続状態を取得
     *
     * @returns 接続状態
     */
    getState(): WebSocketState;

    /**
     * 接続中かどうか
     *
     * @returns 接続中かどうか
     */
    isConnected(): boolean;

    /**
     * 設定を更新
     *
     * @param config - 新しい設定
     */
    updateConfig(config: Partial<WebSocketConfig>): void;

    /**
     * アダプターを破棄
     */
    dispose(): Promise<void>;
}

/**
 * ブラウザ WebSocket アダプター
 *
 * @description
 * ブラウザ環境での WebSocket 実装
 * Web API の WebSocket を使用
 */
export interface IBrowserWebSocketAdapter extends IWebSocketAdapter {
    /**
     * ネイティブ WebSocket インスタンスを取得
     *
     * @returns WebSocket インスタンス
     */
    getNativeWebSocket(): WebSocket | null;
}

/**
 * Electron WebSocket アダプター
 *
 * @description
 * Electron 環境での WebSocket 実装
 * IPC 経由でメインプロセスの WebSocket と通信
 */
export interface IElectronWebSocketAdapter extends IWebSocketAdapter {
    /**
     * IPC チャンネル名を取得
     *
     * @returns IPC チャンネル名
     */
    getIPCChannel(): string;

    /**
     * メインプロセスに接続
     */
    connectToMainProcess(): Promise<void>;
}

/**
 * WebSocket 接続マネージャー
 *
 * @description
 * 複数の WebSocket 接続を管理
 * 接続プール、ロードバランシング、フェイルオーバーなどを提供
 */
export interface IWebSocketManager {
    /**
     * アダプターを登録
     *
     * @param id - アダプターID
     * @param adapter - WebSocket アダプター
     */
    registerAdapter(id: string, adapter: IWebSocketAdapter): void;

    /**
     * アダプターを取得
     *
     * @param id - アダプターID
     * @returns WebSocket アダプター
     */
    getAdapter(id: string): IWebSocketAdapter | null;

    /**
     * アダプターを削除
     *
     * @param id - アダプターID
     */
    removeAdapter(id: string): void;

    /**
     * すべてのアダプターを取得
     *
     * @returns アダプターのマップ
     */
    getAllAdapters(): Map<string, IWebSocketAdapter>;

    /**
     * すべてのアダプターを切断
     */
    disconnectAll(): Promise<void>;

    /**
     * マネージャーを破棄
     */
    dispose(): Promise<void>;
}
