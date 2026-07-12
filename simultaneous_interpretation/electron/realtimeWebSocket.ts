/**
 * OpenAI Realtime WebSocket の connectionId ベース接続管理。
 *
 * API キーと接続先は main 内部サービスから取得し、renderer からは受け取らない。
 * 古い socket の遅延イベントは現在の接続へ一切影響させない。
 */

import { randomUUID } from 'crypto';
import { WebContents } from 'electron';
import WebSocket from 'ws';
import { CredentialService } from './CredentialService';
import { OpenAIConfigService } from './OpenAIConfigService';

const CONNECT_TIMEOUT_MS = 30_000;
const MAX_OUTBOUND_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_INBOUND_MESSAGE_BYTES = 16 * 1024 * 1024;

const ALLOWED_EVENT_TYPES = new Set([
    'session.update',
    'session.close',
    'input_audio_buffer.append',
    // Realtime GA の翻訳セッション（/v1/realtime/translations）は音声追記を
    // session.* 名前空間で送る。renderer 側 (voicetranslate-websocket-mixin.js の
    // sendAudioData) が isRealtimeTranslationSession() 時にこの型を使うため、
    // 許可しないと全音声フレームが拒否され音声・字幕が丸ごと欠落する。
    'session.input_audio_buffer.append',
    'input_audio_buffer.commit',
    'input_audio_buffer.clear',
    'response.create'
]);

export type RealtimeConnectionState =
    | 'idle'
    | 'connecting'
    | 'open'
    | 'closing'
    | 'closed'
    | 'failed';

export interface RealtimeRendererEvent {
    connectionId: string;
    kind: 'open' | 'message' | 'error' | 'close';
    message?: string;
    code?: number;
    reason?: string;
    authError?: boolean;
}

export interface RealtimeSendResult {
    success: boolean;
    message?: string;
}

interface ActiveConnection {
    id: string;
    owner: WebContents;
    socket: WebSocket;
    state: RealtimeConnectionState;
    connectTimer: NodeJS.Timeout;
    resolveConnect: (value: { connectionId: string }) => void;
    rejectConnect: (error: Error) => void;
    connectSettled: boolean;
}

type WebSocketFactory = (url: string, options: WebSocket.ClientOptions) => WebSocket;

export class RealtimeSessionManager {
    private active: ActiveConnection | null = null;

    public constructor(
        private readonly credentials: CredentialService,
        private readonly config: OpenAIConfigService,
        private readonly socketFactory: WebSocketFactory = (url, options) =>
            new WebSocket(url, options)
    ) {}

    public async connect(owner: WebContents): Promise<{ connectionId: string }> {
        const apiKey = this.credentials.getApiKey();
        if (apiKey === null) {
            throw new Error('OpenAI API キーが設定されていません');
        }

        await this.closeCurrent(false);
        const connectionId = randomUUID();
        const socket = this.socketFactory(this.config.buildRealtimeUrl(), {
            headers: { Authorization: `Bearer ${apiKey}` },
            maxPayload: MAX_INBOUND_MESSAGE_BYTES
        });

        return await new Promise<{ connectionId: string }>((resolve, reject) => {
            const connectTimer = setTimeout(() => {
                const current = this.active;
                if (current === null || current.id !== connectionId || current.connectSettled) {
                    return;
                }
                current.connectSettled = true;
                current.state = 'failed';
                this.active = null;
                current.socket.terminate();
                reject(new Error('Realtime WebSocket 接続がタイムアウトしました'));
            }, CONNECT_TIMEOUT_MS);

            const connection: ActiveConnection = {
                id: connectionId,
                owner,
                socket,
                state: 'connecting',
                connectTimer,
                resolveConnect: resolve,
                rejectConnect: reject,
                connectSettled: false
            };
            this.active = connection;
            this.attachHandlers(connection);
        });
    }

    public send(connectionId: string, event: unknown): RealtimeSendResult {
        const connection = this.active;
        if (
            connection === null ||
            connection.id !== connectionId ||
            connection.state !== 'open' ||
            connection.socket.readyState !== WebSocket.OPEN
        ) {
            return { success: false, message: 'Realtime WebSocket が接続されていません' };
        }

        let message: string;
        try {
            this.validateEvent(event);
            message = JSON.stringify(event);
        } catch (error) {
            return { success: false, message: this.errorMessage(error) };
        }
        if (Buffer.byteLength(message, 'utf8') > MAX_OUTBOUND_MESSAGE_BYTES) {
            return { success: false, message: 'Realtime メッセージが大きすぎます' };
        }

        try {
            connection.socket.send(message);
            return { success: true };
        } catch (error) {
            return { success: false, message: `送信失敗: ${this.errorMessage(error)}` };
        }
    }

    public async close(connectionId: string): Promise<void> {
        if (this.active === null || this.active.id !== connectionId) {
            return;
        }
        await this.closeCurrent(true);
    }

    public getState(): { connectionId: string | null; state: RealtimeConnectionState } {
        return this.active === null
            ? { connectionId: null, state: 'idle' }
            : { connectionId: this.active.id, state: this.active.state };
    }

    public ownsConnection(connectionId: string, owner: WebContents): boolean {
        return this.active?.id === connectionId && this.active.owner.id === owner.id;
    }

    public async cleanup(): Promise<void> {
        await this.closeCurrent(false);
    }

    private attachHandlers(connection: ActiveConnection): void {
        connection.socket.on('open', () => {
            if (!this.isCurrent(connection)) {
                return;
            }
            clearTimeout(connection.connectTimer);
            connection.state = 'open';
            this.emit(connection, { connectionId: connection.id, kind: 'open' });
            if (!connection.connectSettled) {
                connection.connectSettled = true;
                connection.resolveConnect({ connectionId: connection.id });
            }
        });

        connection.socket.on('message', (data: WebSocket.Data) => {
            if (!this.isCurrent(connection)) {
                return;
            }
            this.emit(connection, {
                connectionId: connection.id,
                kind: 'message',
                message: data.toString()
            });
        });

        connection.socket.on('error', (error: Error) => {
            if (!this.isCurrent(connection)) {
                return;
            }
            const authError = /401|403|unauthori[sz]ed|invalid[_ -]?api[_ -]?key/iu.test(
                error.message
            );
            this.emit(connection, {
                connectionId: connection.id,
                kind: 'error',
                message: error.message,
                authError
            });
            if (!connection.connectSettled) {
                clearTimeout(connection.connectTimer);
                connection.connectSettled = true;
                connection.state = 'failed';
                this.active = null;
                connection.socket.terminate();
                connection.rejectConnect(
                    new Error(`Realtime WebSocket 接続に失敗しました: ${error.message}`)
                );
            }
        });

        connection.socket.on('close', (code: number, reason: Buffer) => {
            if (!this.isCurrent(connection)) {
                return;
            }
            clearTimeout(connection.connectTimer);
            const reasonText = reason.toString();
            const authError =
                code === 1008 ||
                /401|403|unauthori[sz]ed|invalid[_ -]?api[_ -]?key/iu.test(reasonText);
            connection.state = 'closed';
            this.active = null;
            this.emit(connection, {
                connectionId: connection.id,
                kind: 'close',
                code,
                reason: reasonText,
                authError
            });
            if (!connection.connectSettled) {
                connection.connectSettled = true;
                connection.rejectConnect(
                    new Error(`Realtime WebSocket が接続前に終了しました (${code})`)
                );
            }
        });
    }

    private async closeCurrent(emitClose: boolean): Promise<void> {
        const connection = this.active;
        if (connection === null) {
            return;
        }

        this.active = null;
        clearTimeout(connection.connectTimer);
        connection.state = 'closing';
        if (!connection.connectSettled) {
            connection.connectSettled = true;
            connection.rejectConnect(new Error('Realtime WebSocket 接続をキャンセルしました'));
        }
        if (emitClose) {
            this.emit(connection, {
                connectionId: connection.id,
                kind: 'close',
                code: 1000,
                reason: 'client-close'
            });
        }

        await new Promise<void>((resolve) => {
            if (
                connection.socket.readyState === WebSocket.CLOSED ||
                connection.socket.readyState === WebSocket.CLOSING
            ) {
                resolve();
                return;
            }
            const timer = setTimeout(() => {
                connection.socket.terminate();
                resolve();
            }, 2_000);
            connection.socket.once('close', () => {
                clearTimeout(timer);
                resolve();
            });
            try {
                connection.socket.close(1000, 'client-close');
            } catch {
                clearTimeout(timer);
                connection.socket.terminate();
                resolve();
            }
        });
    }

    private validateEvent(event: unknown): asserts event is Record<string, unknown> {
        if (typeof event !== 'object' || event === null || Array.isArray(event)) {
            throw new Error('Realtime イベントはオブジェクトで指定してください');
        }
        const type = (event as Record<string, unknown>)['type'];
        if (typeof type !== 'string' || !ALLOWED_EVENT_TYPES.has(type)) {
            throw new Error(`Realtime イベント種別が許可されていません: ${String(type)}`);
        }
    }

    private isCurrent(connection: ActiveConnection): boolean {
        return this.active?.id === connection.id && this.active.socket === connection.socket;
    }

    private emit(connection: ActiveConnection, event: RealtimeRendererEvent): void {
        if (connection.owner.isDestroyed()) {
            return;
        }
        connection.owner.send('realtime:event', event);
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
