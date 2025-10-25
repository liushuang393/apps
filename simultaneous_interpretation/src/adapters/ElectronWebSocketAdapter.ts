/**
 * Electron WebSocket アダプター
 *
 * @description
 * Electron 環境での WebSocket 実装
 * IPC 経由でメインプロセスの WebSocket と通信
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { WebSocketAdapter } from './WebSocketAdapter';
import {
    IElectronWebSocketAdapter,
    WebSocketMessage,
    WebSocketState
} from '../interfaces/IWebSocketAdapter';
import type { ElectronAPI } from '../types/electron';

type ElectronRealtimeAPI = ElectronAPI & {
    realtimeWebSocketSendBinary?: (
        data: ArrayBuffer
    ) => Promise<{ success: boolean; message?: string }>;
    realtimeWebSocketDisconnect?: () => Promise<{ success: boolean; message?: string }>;
    onRealtimeWebSocketMessage?: (callback: (data: string) => void) => void;
    onRealtimeWebSocketError?: (
        callback: (error: { code: string; message: string }) => void
    ) => void;
    onRealtimeWebSocketClose?: (callback: (data: { code: number; reason: string }) => void) => void;
};

/**
 * Electron WebSocket アダプター
 */
export class ElectronWebSocketAdapter
    extends WebSocketAdapter
    implements IElectronWebSocketAdapter
{
    private electronAPI: ElectronRealtimeAPI | null = null;
    private readonly ipcChannel = 'realtime-websocket';

    /**
     * メインプロセスに接続
     */
    async connectToMainProcess(): Promise<void> {
        if (typeof window === 'undefined') {
            throw new Error('Electron API not available');
        }

        const api = window.electronAPI as ElectronRealtimeAPI | undefined;
        if (!api) {
            throw new Error('Electron API not available');
        }

        this.electronAPI = api;

        // IPC イベントリスナーを設定
        this.setupIPCListeners();
    }

    /**
     * 接続を確立
     */
    async connect(): Promise<void> {
        if (!this.config) {
            throw new Error('WebSocket adapter not initialized');
        }

        if (!this.electronAPI) {
            await this.connectToMainProcess();
        }

        if (this.state === WebSocketState.CONNECTED || this.state === WebSocketState.CONNECTING) {
            console.warn('[ElectronWebSocket] Already connected or connecting');
            return;
        }

        this.state = WebSocketState.CONNECTING;
        console.info('[ElectronWebSocket] Connecting via IPC...');

        try {
            const result = await this.electronAPI!.realtimeWebSocketConnect({
                url: this.config.url,
                apiKey: this.config.apiKey,
                model: this.config.model
            });

            if (!result.success) {
                throw new Error(result.message || 'Connection failed');
            }

            // 接続成功は onOpen イベントで通知される
            console.info('[ElectronWebSocket] Connection request sent');
        } catch (error) {
            this.handleError({
                code: 'CONNECTION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: error,
                retryable: true
            });
            throw error;
        }
    }

    /**
     * 接続を切断
     */
    async disconnect(_code = 1000, _reason = 'Normal closure'): Promise<void> {
        if (!this.electronAPI || this.state === WebSocketState.DISCONNECTED) {
            return;
        }

        this.state = WebSocketState.DISCONNECTING;
        this.stopReconnectTimer();

        try {
            const result = this.electronAPI.realtimeWebSocketDisconnect
                ? await this.electronAPI.realtimeWebSocketDisconnect()
                : await this.electronAPI.realtimeWebSocketClose();

            if (!result.success) {
                console.warn('[ElectronWebSocket] Disconnect warning:', result.message);
            }

            this.state = WebSocketState.DISCONNECTED;
        } catch (error) {
            console.error('[ElectronWebSocket] Disconnect error:', error);
            this.state = WebSocketState.DISCONNECTED;
        }
    }

    /**
     * メッセージを送信
     */
    async send(message: WebSocketMessage | string): Promise<void> {
        if (!this.electronAPI || this.state !== WebSocketState.CONNECTED) {
            throw new Error('WebSocket not connected');
        }

        try {
            const data = typeof message === 'string' ? message : JSON.stringify(message);
            const result = await this.electronAPI.realtimeWebSocketSend(data);

            if (!result.success) {
                throw new Error(result.message || 'Send failed');
            }
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
        if (!this.electronAPI || this.state !== WebSocketState.CONNECTED) {
            throw new Error('WebSocket not connected');
        }

        if (!this.electronAPI.realtimeWebSocketSendBinary) {
            throw new Error('Binary send is not supported in the current environment');
        }

        try {
            const result = await this.electronAPI.realtimeWebSocketSendBinary(data);

            if (!result.success) {
                throw new Error(result.message || 'Send binary failed');
            }
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
     * IPC チャンネル名を取得
     */
    getIPCChannel(): string {
        return this.ipcChannel;
    }

    /**
     * IPC イベントリスナーを設定
     */
    private setupIPCListeners(): void {
        if (!this.electronAPI) {
            return;
        }

        // メッセージ受信
        this.electronAPI.onRealtimeWebSocketMessage?.((data: string) => {
            try {
                // 特殊なイベント: 接続確立
                if (data === '__CONNECTED__') {
                    this.handleOpen();
                    return;
                }

                // 通常のメッセージ
                const message = JSON.parse(data);
                this.handleMessage({
                    type: message.type || 'unknown',
                    data: message,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('[ElectronWebSocket] Failed to parse message:', error);
                this.handleError({
                    code: 'MESSAGE_PARSE_ERROR',
                    message: 'Failed to parse WebSocket message',
                    details: error,
                    retryable: false
                });
            }
        });

        // エラー受信
        this.electronAPI.onRealtimeWebSocketError?.((error: { code: string; message: string }) => {
            this.handleError({
                code: error.code,
                message: error.message,
                retryable: true
            });
        });

        // 切断通知
        this.electronAPI.onRealtimeWebSocketClose?.((data: { code: number; reason: string }) => {
            this.handleClose(data.code, data.reason);
        });
    }
}
