/**
 * WebSocket アダプター基底クラス
 *
 * @description
 * WebSocket 接続の共通機能を提供
 * ブラウザとElectronの実装で共有されるロジック
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import {
    IWebSocketAdapter,
    WebSocketConfig,
    WebSocketEvents,
    WebSocketMessage,
    WebSocketState,
    WebSocketError
} from '../interfaces/IWebSocketAdapter';

/**
 * WebSocket アダプター基底クラス
 */
export abstract class WebSocketAdapter implements IWebSocketAdapter {
    protected config: WebSocketConfig | null = null;
    protected events: WebSocketEvents = {};
    protected state: WebSocketState = WebSocketState.DISCONNECTED;
    protected reconnectAttempts = 0;
    protected reconnectTimer: NodeJS.Timeout | number | null = null;

    /**
     * WebSocket を初期化
     */
    async initialize(config: WebSocketConfig, events?: WebSocketEvents): Promise<void> {
        this.config = config;
        this.events = events || {};
        
        // デフォルト設定を適用
        if (!this.config.connectionTimeout) {
            this.config.connectionTimeout = 30000;
        }
        
        if (!this.config.reconnect) {
            this.config.reconnect = {
                enabled: true,
                maxAttempts: 5,
                initialDelay: 1000,
                maxDelay: 30000,
                backoffMultiplier: 2
            };
        }
    }

    /**
     * 接続を確立（サブクラスで実装）
     */
    abstract connect(): Promise<void>;

    /**
     * 接続を切断（サブクラスで実装）
     */
    abstract disconnect(code?: number, reason?: string): Promise<void>;

    /**
     * メッセージを送信（サブクラスで実装）
     */
    abstract send(message: WebSocketMessage | string): Promise<void>;

    /**
     * バイナリデータを送信（サブクラスで実装）
     */
    abstract sendBinary(data: ArrayBuffer): Promise<void>;

    /**
     * 接続状態を取得
     */
    getState(): WebSocketState {
        return this.state;
    }

    /**
     * 接続中かどうか
     */
    isConnected(): boolean {
        return this.state === WebSocketState.CONNECTED;
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<WebSocketConfig>): void {
        if (!this.config) {
            throw new Error('WebSocket adapter not initialized');
        }
        this.config = { ...this.config, ...config };
    }

    /**
     * アダプターを破棄
     */
    async dispose(): Promise<void> {
        this.stopReconnectTimer();
        await this.disconnect();
        this.config = null;
        this.events = {};
    }

    /**
     * 再接続を試行
     */
    protected async attemptReconnect(): Promise<void> {
        if (!this.config?.reconnect?.enabled) {
            return;
        }

        const { maxAttempts, initialDelay, maxDelay, backoffMultiplier } = this.config.reconnect;

        if (this.reconnectAttempts >= maxAttempts) {
            this.handleError({
                code: 'MAX_RECONNECT_ATTEMPTS',
                message: `Maximum reconnect attempts (${maxAttempts}) reached`,
                retryable: false
            });
            return;
        }

        this.reconnectAttempts++;
        
        // 指数バックオフ計算
        const delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, this.reconnectAttempts - 1),
            maxDelay
        );

        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${maxAttempts})`);
        
        if (this.events.onReconnecting) {
            this.events.onReconnecting(this.reconnectAttempts);
        }

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
                this.reconnectAttempts = 0;
                if (this.events.onReconnected) {
                    this.events.onReconnected();
                }
            } catch (error) {
                console.error('[WebSocket] Reconnect failed:', error);
                await this.attemptReconnect();
            }
        }, delay);
    }

    /**
     * 再接続タイマーを停止
     */
    protected stopReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer as number);
            this.reconnectTimer = null;
        }
    }

    /**
     * エラーを処理
     */
    protected handleError(error: WebSocketError): void {
        console.error('[WebSocket] Error:', error);
        this.state = WebSocketState.ERROR;
        
        if (this.events.onError) {
            this.events.onError(error);
        }

        // リトライ可能なエラーの場合は再接続を試行
        if (error.retryable && this.config?.reconnect?.enabled) {
            this.attemptReconnect();
        }
    }

    /**
     * メッセージを処理
     */
    protected handleMessage(message: WebSocketMessage): void {
        if (this.events.onMessage) {
            this.events.onMessage(message);
        }
    }

    /**
     * 接続確立を処理
     */
    protected handleOpen(): void {
        console.log('[WebSocket] Connection established');
        this.state = WebSocketState.CONNECTED;
        this.reconnectAttempts = 0;
        this.stopReconnectTimer();
        
        if (this.events.onOpen) {
            this.events.onOpen();
        }
    }

    /**
     * 接続切断を処理
     */
    protected handleClose(code: number, reason: string): void {
        console.log(`[WebSocket] Connection closed: ${code} - ${reason}`);
        this.state = WebSocketState.DISCONNECTED;
        
        if (this.events.onClose) {
            this.events.onClose(code, reason);
        }

        // 異常終了の場合は再接続を試行
        if (code !== 1000 && code !== 1001 && this.config?.reconnect?.enabled) {
            this.attemptReconnect();
        }
    }

    /**
     * WebSocket URL を構築
     */
    protected buildWebSocketUrl(): string {
        if (!this.config) {
            throw new Error('WebSocket adapter not initialized');
        }

        const { url, model } = this.config;
        return `${url}?model=${encodeURIComponent(model)}`;
    }

    /**
     * WebSocket ヘッダーを構築
     */
    protected buildHeaders(): Record<string, string> {
        if (!this.config) {
            throw new Error('WebSocket adapter not initialized');
        }

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
            ...this.config.headers
        };

        return headers;
    }
}

