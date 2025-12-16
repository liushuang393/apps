/**
 * ブラウザ WebSocket アダプター
 *
 * @description
 * ブラウザ環境での WebSocket 実装
 * Web API の WebSocket を使用
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { WebSocketAdapter } from './WebSocketAdapter';
import {
    IBrowserWebSocketAdapter,
    WebSocketMessage,
    WebSocketState
} from '../interfaces/IWebSocketAdapter';

/**
 * ブラウザ WebSocket アダプター
 */
export class BrowserWebSocketAdapter extends WebSocketAdapter implements IBrowserWebSocketAdapter {
    private ws: WebSocket | null = null;

    /**
     * 接続を確立
     */
    async connect(): Promise<void> {
        if (!this.config) {
            throw new Error('WebSocket adapter not initialized');
        }

        if (this.state === WebSocketState.CONNECTED || this.state === WebSocketState.CONNECTING) {
            console.warn('[BrowserWebSocket] Already connected or connecting');
            return;
        }

        this.state = WebSocketState.CONNECTING;
        console.info('[BrowserWebSocket] Connecting to:', this.buildWebSocketUrl());

        return new Promise((resolve, reject) => {
            try {
                if (!this.config || !this.config.apiKey) {
                    throw new Error('APIキーが設定されていません');
                }

                // ブラウザの WebSocket ではヘッダーを送れないため、
                // Sec-WebSocket-Protocol で OpenAI Realtime API の認証情報を渡す
                const wsUrl = this.buildWebSocketUrlWithAuth();
                const protocols = this.buildWebSocketProtocols(this.config.apiKey);
                this.ws = new WebSocket(wsUrl, protocols);

                // バイナリデータタイプを設定
                this.ws.binaryType = 'arraybuffer';

                // タイムアウト設定
                const timeout = setTimeout(() => {
                    if (this.state === WebSocketState.CONNECTING) {
                        this.ws?.close();
                        reject(new Error('Connection timeout'));
                    }
                }, this.config.connectionTimeout);

                // イベントハンドラー設定
                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    this.handleOpen();
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleWebSocketMessage(event);
                };

                this.ws.onerror = (event) => {
                    clearTimeout(timeout);
                    this.handleError({
                        code: 'WEBSOCKET_ERROR',
                        message: 'WebSocket error occurred',
                        details: event,
                        retryable: true
                    });
                    reject(new Error('WebSocket error'));
                };

                this.ws.onclose = (event) => {
                    clearTimeout(timeout);
                    this.handleClose(event.code, event.reason);
                };
            } catch (error) {
                this.handleError({
                    code: 'CONNECTION_FAILED',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    details: error,
                    retryable: true
                });
                reject(error);
            }
        });
    }

    /**
     * 接続を切断
     */
    async disconnect(code = 1000, reason = 'Normal closure'): Promise<void> {
        if (!this.ws || this.state === WebSocketState.DISCONNECTED) {
            return;
        }

        this.state = WebSocketState.DISCONNECTING;
        this.stopReconnectTimer();

        return new Promise((resolve) => {
            if (!this.ws) {
                resolve();
                return;
            }

            const closeHandler = () => {
                this.ws = null;
                resolve();
            };

            this.ws.addEventListener('close', closeHandler, { once: true });
            this.ws.close(code, reason);

            // タイムアウト設定（強制切断）
            setTimeout(() => {
                if (this.ws) {
                    this.ws.onclose = null;
                    this.ws = null;
                }
                resolve();
            }, 5000);
        });
    }

    /**
     * メッセージを送信
     */
    async send(message: WebSocketMessage | string): Promise<void> {
        if (!this.ws || this.state !== WebSocketState.CONNECTED) {
            throw new Error('WebSocket not connected');
        }

        try {
            const data = typeof message === 'string' ? message : JSON.stringify(message);
            this.ws.send(data);
        } catch (error) {
            this.handleError({
                code: 'SEND_FAILED',
                message: error instanceof Error ? error.message : 'Failed to send message',
                details: error,
                retryable: false
            });
            throw error;
        }
    }

    /**
     * バイナリデータを送信
     */
    async sendBinary(data: ArrayBuffer): Promise<void> {
        if (!this.ws || this.state !== WebSocketState.CONNECTED) {
            throw new Error('WebSocket not connected');
        }

        try {
            this.ws.send(data);
        } catch (error) {
            this.handleError({
                code: 'SEND_BINARY_FAILED',
                message: error instanceof Error ? error.message : 'Failed to send binary data',
                details: error,
                retryable: false
            });
            throw error;
        }
    }

    /**
     * ネイティブ WebSocket インスタンスを取得
     */
    getNativeWebSocket(): WebSocket | null {
        return this.ws;
    }

    /**
     * WebSocket メッセージを処理
     */
    private handleWebSocketMessage(event: MessageEvent): void {
        try {
            // バイナリデータの場合
            if (event.data instanceof ArrayBuffer) {
                this.handleMessage({
                    type: 'binary',
                    data: event.data,
                    timestamp: Date.now()
                });
                return;
            }

            // テキストデータの場合
            const message = JSON.parse(event.data);
            this.handleMessage({
                type: message.type || 'unknown',
                data: message,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('[BrowserWebSocket] Failed to parse message:', error);
            this.handleError({
                code: 'MESSAGE_PARSE_ERROR',
                message: 'Failed to parse WebSocket message',
                details: error,
                retryable: false
            });
        }
    }

    /**
     * 認証付き WebSocket URL を構築
     *
     * @description
     * ブラウザの WebSocket はヘッダーを送信できないため、
     * URL 自体はそのままにし、Sec-WebSocket-Protocol で認証を行う
     */
    private buildWebSocketUrlWithAuth(): string {
        if (!this.config) {
            throw new Error('WebSocket adapter not initialized');
        }

        const baseUrl = this.buildWebSocketUrl();

        return baseUrl;
    }

    /**
     * OpenAI Realtime API 用の Sec-WebSocket-Protocol を構築
     *
     * @param apiKey - OpenAI API キー
     * @returns プロトコル配列
     */
    private buildWebSocketProtocols(apiKey: string): string[] {
        // 仕様:
        //   - 'realtime': ベースプロトコル
        //   - `openai-insecure-api-key.{API_KEY}`: ブラウザからの暫定的な認証手段
        //   - 'openai-beta.realtime-v1': Realtime API のベータバージョン指定
        return ['realtime', `openai-insecure-api-key.${apiKey}`, 'openai-beta.realtime-v1'];
    }
}
