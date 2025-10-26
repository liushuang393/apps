/**
 * WebSocketManager.ts
 *
 * 目的: OpenAI Realtime API の WebSocket 接続管理
 *
 * 機能:
 *   - WebSocket 接続・切断
 *   - セッション作成・更新
 *   - メッセージ送受信
 *   - エラーハンドリング
 *   - Electron/ブラウザ環境の自動判定
 *
 * 注意:
 *   - ブラウザ環境: sec-websocket-protocol で認証
 *   - Electron環境: Authorization ヘッダーで認証（IPC経由）
 */

import { CONFIG } from './Config';
import type { VoiceType } from '../interfaces/ICoreTypes';
import type { ElectronAPI } from '../types/electron';
import { defaultLogger } from '../utils/Logger';

/**
 * セッション設定
 */
export interface SessionConfig {
    sourceLang: string;
    targetLang: string;
    voiceType: VoiceType;
    audioOutputEnabled: boolean;
    vadEnabled: boolean;
    instructions: string;
}

/**
 * WebSocket メッセージハンドラー
 */
export interface WebSocketMessageHandlers {
    onSessionUpdated?: (session: unknown) => void;
    onAudioBufferCommitted?: () => void;
    onSpeechStarted?: () => void;
    onSpeechStopped?: () => void;
    onInputTranscription?: (transcript: string) => void;
    onAudioTranscriptDelta?: (delta: string) => void;
    onAudioTranscriptDone?: (transcript: string) => void;
    onAudioDelta?: (delta: string) => void;
    onAudioDone?: () => void;
    onResponseCreated?: (responseId: string) => void;
    onResponseDone?: (responseId: string) => void;
    onError?: (error: Error, code?: string) => void;
}

/**
 * WebSocket 接続状態
 */
export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'error';

/**
 * WebSocketManager クラス
 *
 * 目的: OpenAI Realtime API の WebSocket 接続を管理
 */
export class WebSocketManager {
    private ws: WebSocket | null = null;
    private apiKey: string = '';
    private isConnected: boolean = false;
    private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private lastPongTime: number = 0;
    private missedPongs: number = 0;
    private messageHandlers: WebSocketMessageHandlers = {};

    private getElectronAPI(): ElectronAPI | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return window.electronAPI;
    }

    /**
     * Electron 環境かどうかを判定
     */
    private isElectronEnvironment(): boolean {
        return this.getElectronAPI() !== undefined;
    }

    /**
     * 接続状態を取得
     */
    getConnectionStatus(): ConnectionStatus {
        if (this.isConnected) {
            return 'connected';
        }
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            return 'connecting';
        }
        if (this.ws && this.ws.readyState === WebSocket.CLOSING) {
            return 'offline';
        }
        return 'offline';
    }

    /**
     * メッセージハンドラーを設定
     */
    setMessageHandlers(handlers: WebSocketMessageHandlers): void {
        this.messageHandlers = handlers;
    }

    /**
     * WebSocket 接続
     */
    async connect(apiKey: string): Promise<void> {
        if (!apiKey) {
            throw new Error('APIキーが必要です');
        }

        this.apiKey = apiKey;

        const debugInfo = {
            apiKey: apiKey.substring(0, 7) + '...',
            model: CONFIG.API.REALTIME_MODEL,
            url: CONFIG.API.REALTIME_URL
        };
        console.info('[WebSocketManager] 接続開始:', debugInfo);

        if (this.isElectronEnvironment()) {
            await this.connectElectron();
        } else {
            await this.connectBrowser();
        }
    }

    /**
     * Electron 環境での接続
     */
    private async connectElectron(): Promise<void> {
        console.info('[WebSocketManager] Electron環境: mainプロセス経由で接続');

        const electronAPI = this.getElectronAPI();
        if (!electronAPI) {
            throw new Error('Electron API が利用できません');
        }

        // IPC イベントリスナーを設定
        this.setupElectronHandlers(electronAPI);

        // WebSocket 接続を要求
        const result = await electronAPI.realtimeWebSocketConnect({
            url: CONFIG.API.REALTIME_URL,
            apiKey: this.apiKey,
            model: CONFIG.API.REALTIME_MODEL
        });

        if (!result.success) {
            throw new Error(result.message || '接続失敗');
        }

        console.info('[WebSocketManager] Electron WebSocket接続要求送信完了');
    }

    /**
     * ブラウザ環境での接続
     */
    private async connectBrowser(): Promise<void> {
        const wsUrl = `${CONFIG.API.REALTIME_URL}?model=${CONFIG.API.REALTIME_MODEL}`;
        console.info('[WebSocketManager] WebSocket URL:', wsUrl);

        // sec-websocket-protocol ヘッダーで認証
        const protocols = [
            'realtime',
            `openai-insecure-api-key.${this.apiKey}`,
            'openai-beta.realtime-v1'
        ];

        this.ws = new WebSocket(wsUrl, protocols);

        // WebSocket イベント設定
        this.ws.onopen = () => this.handleOpen();
        this.ws.onmessage = (event) => this.handleMessage(event);
        this.ws.onerror = (error) => this.handleError(error);
        this.ws.onclose = (event) => this.handleClose(event);

        // タイムアウト設定
        this.connectionTimeout = setTimeout(() => {
            if (!this.isConnected) {
                console.error('[WebSocketManager] タイムアウト - 接続に失敗');
                this.disconnect();
                throw new Error('接続タイムアウト (30秒)');
            }
        }, CONFIG.API.TIMEOUT);
    }

    /**
     * Electron IPC ハンドラーを設定
     */
    private setupElectronHandlers(electronAPI: ElectronAPI): void {
        electronAPI.on('realtime-ws-open', () => {
            console.info('[WebSocketManager] Electron WebSocket接続成功');
            this.handleOpen();
        });

        electronAPI.on('realtime-ws-message', (data: unknown) => {
            if (typeof data === 'string') {
                this.handleMessage({ data } as MessageEvent);
            } else {
                console.warn('[WebSocketManager] 予期しないメッセージ形式を受信しました');
            }
        });

        electronAPI.on('realtime-ws-error', (error: unknown) => {
            console.error('[WebSocketManager] Electron WebSocketエラー:', error);
            this.handleError(error);
        });

        electronAPI.on('realtime-ws-close', (event: unknown) => {
            console.info('[WebSocketManager] Electron WebSocket接続終了');
            this.handleClose(event);
        });
    }

    /**
     * WebSocket 切断
     */
    async disconnect(): Promise<void> {
        // Keep-Aliveタイマーをクリア
        this.stopKeepAlive();

        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        if (this.isElectronEnvironment()) {
            const electronAPI = this.getElectronAPI();
            if (electronAPI) {
                await electronAPI.realtimeWebSocketClose();
            }
        } else if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        console.info('[WebSocketManager] 切断完了');
    }

    /**
     * メッセージ送信
     */
    sendMessage(message: Record<string, unknown>): void {
        if (this.isElectronEnvironment()) {
            const electronAPI = this.getElectronAPI();
            if (!electronAPI) {
                console.warn('[WebSocketManager] Electron APIが利用できません');
                return;
            }

            electronAPI
                .realtimeWebSocketSend(JSON.stringify(message))
                .then((result) => {
                    if (!result.success) {
                        console.error('[WebSocketManager] Electron送信エラー:', result.message);
                    }
                })
                .catch((error) => {
                    console.error('[WebSocketManager] Electron送信例外:', error);
                });
        } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('[WebSocketManager] WebSocket未接続のため送信できません');
        }
    }

    /**
     * セッション作成
     */
    createSession(config: SessionConfig): void {
        const modalities = config.audioOutputEnabled ? ['text', 'audio'] : ['text'];

        const session = {
            type: 'session.update',
            session: {
                model: CONFIG.API.REALTIME_MODEL,
                modalities: modalities,
                instructions: config.instructions,
                voice: config.voiceType,
                input_audio_format: CONFIG.AUDIO.FORMAT,
                output_audio_format: CONFIG.AUDIO.FORMAT,
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: config.vadEnabled
                    ? {
                          type: 'server_vad',
                          threshold: 0.5,
                          prefix_padding_ms: 300,
                          silence_duration_ms: 1200
                      }
                    : null,
                temperature: 0.8,
                max_response_output_tokens: 4096
            }
        };

        console.info('[WebSocketManager] セッション作成:', session);
        this.sendMessage(session);
    }

    /**
     * セッション更新
     */
    updateSession(config: Partial<SessionConfig>): void {
        const sessionUpdate: {
            type: 'session.update';
            session: Record<string, unknown>;
        } = {
            type: 'session.update',
            session: {}
        };

        if (config.voiceType !== undefined) {
            sessionUpdate.session['voice'] = config.voiceType;
        }

        if (config.instructions !== undefined) {
            sessionUpdate.session['instructions'] = config.instructions;
        }

        if (config.vadEnabled !== undefined) {
            sessionUpdate.session['turn_detection'] = config.vadEnabled
                ? {
                      type: 'server_vad',
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 1200
                  }
                : null;
        }

        console.info('[WebSocketManager] セッション更新:', sessionUpdate);
        this.sendMessage(sessionUpdate);
    }

    /**
     * WebSocket 接続成功ハンドラー
     */
    private handleOpen(): void {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        this.isConnected = true;
        console.info('[WebSocketManager] 接続成功');

        // Keep-Alive心跳を開始
        this.startKeepAlive();
    }

    /**
     * WebSocket メッセージ受信ハンドラー
     */
    private handleMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data) as {
                type?: string;
                [key: string]: unknown;
            };

            const messageType = typeof message.type === 'string' ? message.type : '';

            if (CONFIG.DEBUG_MODE) {
                console.info('[WebSocketManager] Message:', messageType, message);
            }

            switch (messageType) {
                case 'session.updated':
                    this.messageHandlers.onSessionUpdated?.(message['session']);
                    break;
                case 'input_audio_buffer.committed':
                    this.messageHandlers.onAudioBufferCommitted?.();
                    break;
                case 'input_audio_buffer.speech_started':
                    this.messageHandlers.onSpeechStarted?.();
                    break;
                case 'input_audio_buffer.speech_stopped':
                    this.messageHandlers.onSpeechStopped?.();
                    break;
                case 'conversation.item.input_audio_transcription.completed': {
                    const transcript = message['transcript'];
                    if (typeof transcript === 'string') {
                        this.messageHandlers.onInputTranscription?.(transcript);
                    }
                    break;
                }
                case 'response.audio_transcript.delta': {
                    const delta = message['delta'];
                    if (typeof delta === 'string') {
                        this.messageHandlers.onAudioTranscriptDelta?.(delta);
                    }
                    break;
                }
                case 'response.audio_transcript.done': {
                    const transcript = message['transcript'];
                    if (typeof transcript === 'string') {
                        this.messageHandlers.onAudioTranscriptDone?.(transcript);
                    }
                    break;
                }
                case 'response.audio.delta': {
                    const delta = message['delta'];
                    if (typeof delta === 'string') {
                        this.messageHandlers.onAudioDelta?.(delta);
                    }
                    break;
                }
                case 'response.audio.done':
                    this.messageHandlers.onAudioDone?.();
                    break;
                case 'response.created': {
                    const response = message['response'] as { id?: string } | undefined;
                    if (response?.id) {
                        this.messageHandlers.onResponseCreated?.(response.id);
                    }
                    break;
                }
                case 'response.done': {
                    const response = message['response'] as { id?: string } | undefined;
                    if (response?.id) {
                        this.messageHandlers.onResponseDone?.(response.id);
                    }
                    break;
                }
                case 'session.updated': {
                    // Keep-Alive応答を記録
                    this.recordPong();
                    console.info('[WebSocketManager] セッション更新完了');
                    break;
                }
                case 'error': {
                    const errorPayload = message['error'] as
                        | { message?: string; code?: string }
                        | undefined;
                    if (errorPayload?.message) {
                        this.messageHandlers.onError?.(
                            new Error(errorPayload.message),
                            errorPayload.code ?? ''
                        );
                    } else {
                        this.messageHandlers.onError?.(new Error('不明なエラーが発生しました'));
                    }
                    break;
                }
                default:
                    console.info('[WebSocketManager] 未処理のメッセージタイプ:', messageType);
            }
        } catch (error) {
            console.error('[WebSocketManager] メッセージ解析エラー:', error);
        }
    }

    /**
     * WebSocket エラーハンドラー
     */
    private handleError(error: unknown): void {
        console.error('[WebSocketManager] WebSocketエラー:', error);
        this.messageHandlers.onError?.(new Error('WebSocket接続エラー'));
    }

    /**
     * WebSocket 切断ハンドラー
     */
    private handleClose(event: unknown): void {
        const eventObject =
            typeof event === 'object' && event !== null
                ? (event as { code?: number; reason?: string; wasClean?: boolean })
                : {};

        const code = typeof eventObject.code === 'number' ? eventObject.code : 1005;
        const reason = typeof eventObject.reason === 'string' ? eventObject.reason : '';
        const wasClean = typeof eventObject.wasClean === 'boolean' ? eventObject.wasClean : true;

        console.info('[WebSocketManager] 接続終了:', { code, reason, wasClean });

        this.isConnected = false;
        this.ws = null;

        // Keep-Aliveタイマーをクリア
        this.stopKeepAlive();
    }

    /**
     * Keep-Alive心跳を開始
     * 目的: WebSocket接続の生存確認、タイムアウト検出
     * 仕様: 30秒ごとにpingを送信、3回連続で応答なしの場合は再接続
     */
    private startKeepAlive(): void {
        // 既存のタイマーをクリア
        this.stopKeepAlive();

        this.lastPongTime = Date.now();
        this.missedPongs = 0;

        // 30秒ごとにpingを送信
        this.keepAliveInterval = setInterval(() => {
            if (!this.isConnected) {
                this.stopKeepAlive();
                return;
            }

            const now = Date.now();
            const timeSinceLastPong = now - this.lastPongTime;

            // 90秒以上応答がない場合（3回連続でpong未受信）
            if (timeSinceLastPong > 90000) {
                defaultLogger.warn('[WebSocketManager] Keep-Alive timeout - 再接続を試みます');
                this.missedPongs++;

                if (this.missedPongs >= 3) {
                    defaultLogger.error('[WebSocketManager] Keep-Alive失敗 - 接続を切断します');
                    this.disconnect();
                    return;
                }
            }

            // pingメッセージを送信（OpenAI Realtime APIはping/pongをサポートしていないため、session.updateで代用）
            try {
                this.sendMessage({
                    type: 'session.update',
                    session: {
                        // 空のupdateでkeep-aliveとして機能
                    }
                });

                if (CONFIG.DEBUG_MODE) {
                    defaultLogger.debug('[WebSocketManager] Keep-Alive ping送信');
                }
            } catch (error) {
                defaultLogger.error('[WebSocketManager] Keep-Alive ping送信失敗:', error);
            }
        }, 30000); // 30秒間隔

        defaultLogger.info('[WebSocketManager] Keep-Alive開始（30秒間隔）');
    }

    /**
     * Keep-Alive心跳を停止
     */
    private stopKeepAlive(): void {
        if (this.keepAliveInterval !== null) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
            defaultLogger.debug('[WebSocketManager] Keep-Alive停止');
        }
    }

    /**
     * Keep-Alive応答を記録
     * 注意: session.updated イベント受信時に呼び出す
     */
    private recordPong(): void {
        this.lastPongTime = Date.now();
        this.missedPongs = 0;

        if (CONFIG.DEBUG_MODE) {
            defaultLogger.debug('[WebSocketManager] Keep-Alive pong受信');
        }
    }
}
