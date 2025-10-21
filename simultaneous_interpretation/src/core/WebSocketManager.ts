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
    onSessionUpdated?: (session: any) => void;
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
    private connectionTimeout: number | null = null;
    private messageHandlers: WebSocketMessageHandlers = {};

    /**
     * Electron 環境かどうかを判定
     */
    private isElectronEnvironment(): boolean {
        return typeof window !== 'undefined' && !!(window as any).electronAPI;
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

        const electronAPI = (window as any).electronAPI;

        // IPC イベントリスナーを設定
        this.setupElectronHandlers();

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
        this.connectionTimeout = window.setTimeout(() => {
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
    private setupElectronHandlers(): void {
        const electronAPI = (window as any).electronAPI;

        electronAPI.onRealtimeWebSocketOpen(() => {
            console.info('[WebSocketManager] Electron WebSocket接続成功');
            this.handleOpen();
        });

        electronAPI.onRealtimeWebSocketMessage((data: string) => {
            this.handleMessage({ data } as MessageEvent);
        });

        electronAPI.onRealtimeWebSocketError((error: any) => {
            console.error('[WebSocketManager] Electron WebSocketエラー:', error);
            this.handleError(error);
        });

        electronAPI.onRealtimeWebSocketClose((event: any) => {
            console.info('[WebSocketManager] Electron WebSocket接続終了');
            this.handleClose(event);
        });
    }

    /**
     * WebSocket 切断
     */
    async disconnect(): Promise<void> {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        if (this.isElectronEnvironment()) {
            const electronAPI = (window as any).electronAPI;
            await electronAPI.realtimeWebSocketClose();
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
    sendMessage(message: any): void {
        if (this.isElectronEnvironment()) {
            const electronAPI = (window as any).electronAPI;
            electronAPI.realtimeWebSocketSend(JSON.stringify(message)).then((result: any) => {
                if (!result.success) {
                    console.error('[WebSocketManager] Electron送信エラー:', result.message);
                }
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
        const session: any = {
            type: 'session.update',
            session: {}
        };

        if (config.voiceType !== undefined) {
            session.session.voice = config.voiceType;
        }

        if (config.instructions !== undefined) {
            session.session.instructions = config.instructions;
        }

        if (config.vadEnabled !== undefined) {
            session.session.turn_detection = config.vadEnabled
                ? {
                      type: 'server_vad',
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 1200
                  }
                : null;
        }

        console.info('[WebSocketManager] セッション更新:', session);
        this.sendMessage(session);
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
    }

    /**
     * WebSocket メッセージ受信ハンドラー
     */
    private handleMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data);

            if (CONFIG.DEBUG_MODE) {
                console.info('[WebSocketManager] Message:', message.type, message);
            }

            // メッセージタイプに応じてハンドラーを呼び出し
            switch (message.type) {
                case 'session.updated':
                    this.messageHandlers.onSessionUpdated?.(message.session);
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
                case 'conversation.item.input_audio_transcription.completed':
                    this.messageHandlers.onInputTranscription?.(message.transcript);
                    break;
                case 'response.audio_transcript.delta':
                    this.messageHandlers.onAudioTranscriptDelta?.(message.delta);
                    break;
                case 'response.audio_transcript.done':
                    this.messageHandlers.onAudioTranscriptDone?.(message.transcript);
                    break;
                case 'response.audio.delta':
                    this.messageHandlers.onAudioDelta?.(message.delta);
                    break;
                case 'response.audio.done':
                    this.messageHandlers.onAudioDone?.();
                    break;
                case 'response.created':
                    this.messageHandlers.onResponseCreated?.(message.response.id);
                    break;
                case 'response.done':
                    this.messageHandlers.onResponseDone?.(message.response.id);
                    break;
                case 'error':
                    const errorCode = message.error.code || '';
                    this.messageHandlers.onError?.(new Error(message.error.message), errorCode);
                    break;
                default:
                    console.info('[WebSocketManager] 未処理のメッセージタイプ:', message.type);
            }
        } catch (error) {
            console.error('[WebSocketManager] メッセージ解析エラー:', error);
        }
    }

    /**
     * WebSocket エラーハンドラー
     */
    private handleError(error: any): void {
        console.error('[WebSocketManager] WebSocketエラー:', error);
        this.messageHandlers.onError?.(new Error('WebSocket接続エラー'));
    }

    /**
     * WebSocket 切断ハンドラー
     */
    private handleClose(event: any): void {
        const code = event?.code || 1005;
        const reason = event?.reason || '';
        const wasClean = event?.wasClean !== undefined ? event.wasClean : true;

        console.info('[WebSocketManager] 接続終了:', { code, reason, wasClean });

        this.isConnected = false;
        this.ws = null;
    }
}
