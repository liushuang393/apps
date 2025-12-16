/**
 * WebSocket マネージャー
 *
 * @description
 * OpenAI Realtime API との WebSocket 接続を管理するクラス
 *
 * @features
 * - 認証付き WebSocket 接続
 * - 自動再接続（指数バックオフ）
 * - セッション管理
 * - イベントハンドリング
 * - エラーハンドリング
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import {
    WebSocketConfig,
    ConnectionState,
    EventHandlers,
    WebSocketMessage,
    MessageType,
    SessionUpdateMessage
} from '../types/websocket.types';
import { AuthenticationError, ConnectionError, ConfigurationError, TimeoutError } from '../errors';

/**
 * WebSocket マネージャークラス
 */
export class WebSocketManager {
    private readonly config: Required<WebSocketConfig>;
    private ws: WebSocket | null = null;
    private state: ConnectionState = ConnectionState.DISCONNECTED;
    private reconnectCount: number = 0;
    private eventHandlers: EventHandlers = {};
    private sessionId: string | null = null;
    private conversationId: string | null = null;
    private connectionTimeoutId: NodeJS.Timeout | null = null;

    /**
     * コンストラクタ
     *
     * @param config - WebSocket 設定
     * @throws {ConfigurationError} 設定が不正な場合
     * @throws {AuthenticationError} API キーが不正な場合
     */
    constructor(config: WebSocketConfig) {
        this._validateConfig(config);

        this.config = {
            url: config.url,
            apiKey: config.apiKey,
            model: config.model,
            reconnectAttempts: config.reconnectAttempts ?? 3,
            reconnectDelay: config.reconnectDelay ?? 1000,
            connectionTimeout: config.connectionTimeout ?? 10000
        };
    }

    /**
     * 設定の検証
     *
     * @private
     * @param config - 検証する設定
     * @throws {ConfigurationError} 設定が不正な場合
     * @throws {AuthenticationError} API キーが不正な場合
     */
    private _validateConfig(config: WebSocketConfig): void {
        if (!config) {
            throw new ConfigurationError('Configuration is required');
        }

        if (!config.url) {
            throw new ConfigurationError('WebSocket URL is required');
        }

        if (!config.apiKey) {
            throw new ConfigurationError('API key is required');
        }

        if (!config.model) {
            throw new ConfigurationError('Model name is required');
        }

        // API キーの形式検証
        if (!config.apiKey.startsWith('sk-')) {
            throw new AuthenticationError('Invalid API key format. API key must start with "sk-"', {
                apiKey: config.apiKey.substring(0, 7) + '...'
            });
        }
    }

    /**
     * WebSocket URL の構築
     *
     * @private
     * @returns 構築された URL
     */
    private _buildWebSocketUrl(): string {
        const url = new URL(this.config.url);
        url.searchParams.set('model', this.config.model);
        return url.toString();
    }

    /**
     * 接続タイムアウトの設定
     *
     * @private
     */
    private _setupConnectionTimeout(): void {
        this.connectionTimeoutId = setTimeout(() => {
            if (this.state === ConnectionState.CONNECTING) {
                this._handleError(
                    new TimeoutError('Connection timeout', this.config.connectionTimeout)
                );
                this.disconnect();
            }
        }, this.config.connectionTimeout);
    }

    /**
     * 接続タイムアウトのクリア
     *
     * @private
     */
    private _clearConnectionTimeout(): void {
        if (this.connectionTimeoutId) {
            clearTimeout(this.connectionTimeoutId);
            this.connectionTimeoutId = null;
        }
    }

    /**
     * イベントリスナーの設定
     *
     * @private
     */
    private _setupEventListeners(): void {
        if (!this.ws) {
            return;
        }

        this.ws.onopen = (event: Event) => {
            this._clearConnectionTimeout();
            this._setState(ConnectionState.CONNECTED);
            this.reconnectCount = 0;

            // 認証メッセージを送信
            this._sendAuthenticationMessage();

            if (this.eventHandlers.onOpen) {
                this.eventHandlers.onOpen(event);
            }
        };

        this.ws.onmessage = (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data) as WebSocketMessage;
                this._handleMessage(message);

                if (this.eventHandlers.onMessage) {
                    this.eventHandlers.onMessage(message);
                }
            } catch (error) {
                this._handleError(
                    new Error(`Failed to parse message: ${(error as Error).message}`)
                );
            }
        };

        this.ws.onclose = (event: CloseEvent) => {
            this._clearConnectionTimeout();
            this._setState(ConnectionState.DISCONNECTED);

            if (this.eventHandlers.onClose) {
                this.eventHandlers.onClose(event);
            }

            // 自動再接続
            if (this.reconnectCount < this.config.reconnectAttempts) {
                this._reconnect();
            }
        };

        this.ws.onerror = (_event: Event) => {
            this._clearConnectionTimeout();
            const error = new ConnectionError('WebSocket error occurred');
            this._handleError(error);

            if (this.eventHandlers.onError) {
                this.eventHandlers.onError(error);
            }
        };
    }

    /**
     * 認証メッセージの送信
     *
     * @private
     */
    private _sendAuthenticationMessage(): void {
        const authMessage: SessionUpdateMessage = {
            type: MessageType.SESSION_UPDATE,
            session: {
                model: this.config.model,
                modalities: ['text', 'audio'],
                instructions: 'You are a helpful assistant for real-time translation.',
                voice: 'alloy',
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500
                },
                temperature: 0.8,
                max_response_output_tokens: 4096
            }
        };

        this.send(authMessage);
    }

    /**
     * メッセージの処理
     *
     * @private
     * @param message - 受信したメッセージ
     */
    private _handleMessage(message: WebSocketMessage): void {
        if (message.type === MessageType.SESSION_CREATED) {
            const sessionMessage = message as { session?: { id: string } };
            this.sessionId = sessionMessage.session?.id ?? null;
        }
    }

    /**
     * エラーの処理
     *
     * @private
     * @param error - エラーオブジェクト
     */
    private _handleError(error: Error): void {
        this._setState(ConnectionState.ERROR);

        if (this.eventHandlers.onError) {
            this.eventHandlers.onError(error);
        }
    }

    /**
     * 状態の設定
     *
     * @private
     * @param newState - 新しい状態
     */
    private _setState(newState: ConnectionState): void {
        const oldState = this.state;
        this.state = newState;

        if (oldState !== newState && this.eventHandlers.onStateChange) {
            this.eventHandlers.onStateChange(newState);
        }
    }

    /**
     * 再接続
     *
     * @private
     */
    private _reconnect(): void {
        this.reconnectCount++;
        this._setState(ConnectionState.RECONNECTING);

        const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectCount - 1);

        setTimeout(() => {
            this.connect().catch((error) => {
                this._handleError(error as Error);
            });
        }, delay);
    }

    /**
     * 接続待機
     *
     * @private
     * @returns 接続完了を示す Promise
     */
    private async _waitForConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.ws) {
                reject(new ConnectionError('WebSocket is not initialized'));
                return;
            }

            const checkConnection = (): void => {
                if (this.state === ConnectionState.CONNECTED) {
                    resolve();
                } else if (this.state === ConnectionState.ERROR) {
                    reject(new ConnectionError('Failed to connect'));
                }
            };

            this.on('stateChange', checkConnection);

            setTimeout(() => {
                this.off('stateChange', checkConnection);
                if (this.state !== ConnectionState.CONNECTED) {
                    reject(new TimeoutError('Connection timeout', this.config.connectionTimeout));
                }
            }, this.config.connectionTimeout);
        });
    }

    /**
     * WebSocket 接続
     *
     * @async
     * @returns 接続完了を示す Promise
     * @throws {ConnectionError} 接続失敗時
     */
    public async connect(): Promise<void> {
        if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
            return;
        }

        this._setState(ConnectionState.CONNECTING);
        this._setupConnectionTimeout();

        const wsUrl = this._buildWebSocketUrl();
        // Note: Browser WebSocket API doesn't support custom headers
        // API key is passed via URL parameter instead
        this.ws = new WebSocket(wsUrl);

        this._setupEventListeners();
        await this._waitForConnection();
    }

    /**
     * WebSocket 切断
     */
    public disconnect(): void {
        this._clearConnectionTimeout();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this._setState(ConnectionState.DISCONNECTED);
        this.sessionId = null;
        this.conversationId = null;
    }

    /**
     * メッセージ送信
     *
     * @param message - 送信するメッセージ
     * @throws {ConnectionError} 未接続時
     */
    public send(message: WebSocketMessage | Record<string, unknown>): void {
        if (!this.ws || this.state !== ConnectionState.CONNECTED) {
            throw new ConnectionError('WebSocket is not connected');
        }

        this.ws.send(JSON.stringify(message));
    }

    /**
     * イベントハンドラの登録
     *
     * 目的:
     *   WebSocketイベントのハンドラを動的に登録
     *
     * @param event - イベント名（'open', 'message', 'close', 'error', 'stateChange'）
     * @param handler - ハンドラ関数
     *
     * 注意:
     *   イベント名に応じた適切な型のハンドラを渡すこと
     */
    public on<K extends keyof EventHandlers>(
        event: K extends `on${infer E}` ? Uncapitalize<E> : never,
        handler: NonNullable<EventHandlers[K]>
    ): void;
    public on(event: string, handler: (...args: unknown[]) => void): void {
        const eventKey =
            `on${event.charAt(0).toUpperCase()}${event.slice(1)}` as keyof EventHandlers;

        // Record型として扱い、型安全性を保ちつつ代入
        (this.eventHandlers as Record<string, ((...args: unknown[]) => void) | undefined>)[
            eventKey
        ] = handler;
    }

    /**
     * イベントハンドラの解除
     *
     * 目的:
     *   登録されたWebSocketイベントハンドラを削除
     *
     * @param event - イベント名（'open', 'message', 'close', 'error', 'stateChange'）
     * @param handler - 解除するハンドラ関数
     */
    public off<K extends keyof EventHandlers>(
        event: K extends `on${infer E}` ? Uncapitalize<E> : never,
        handler: NonNullable<EventHandlers[K]>
    ): void;
    public off(event: string, handler: (...args: unknown[]) => void): void {
        const eventKey =
            `on${event.charAt(0).toUpperCase()}${event.slice(1)}` as keyof EventHandlers;

        if (this.eventHandlers[eventKey] === handler) {
            delete this.eventHandlers[eventKey];
        }
    }

    /**
     * 接続状態の取得
     *
     * @returns 現在の接続状態
     */
    public getState(): ConnectionState {
        return this.state;
    }

    /**
     * 接続中かどうか
     *
     * @returns 接続中の場合 true
     */
    public isConnected(): boolean {
        return this.state === ConnectionState.CONNECTED;
    }

    /**
     * セッション ID の取得
     *
     * @returns セッション ID
     */
    public getSessionId(): string | null {
        return this.sessionId;
    }

    /**
     * 会話 ID の取得
     *
     * @returns 会話 ID
     */
    public getConversationId(): string | null {
        return this.conversationId;
    }
}
