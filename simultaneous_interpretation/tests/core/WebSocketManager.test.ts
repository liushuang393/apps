/**
 * WebSocketManager.ts のテスト
 * 
 * 目的: WebSocket接続管理、セッション管理、メッセージ送受信のテスト
 */

import { WebSocketManager } from '../../src/core/WebSocketManager';
import type { 
    SessionConfig, 
    WebSocketMessageHandlers,
    ConnectionStatus 
} from '../../src/core/WebSocketManager';

// WebSocket のモック
class MockWebSocket {
    url: string;
    protocol: string | string[];
    readyState: number = 0; // CONNECTING
    onopen: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url: string, protocol?: string | string[]) {
        this.url = url;
        this.protocol = protocol || '';
    }

    send(data: string): void {
        // モック実装
    }

    close(code?: number, reason?: string): void {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) {
            this.onclose(new CloseEvent('close', { code, reason }));
        }
    }

    // テスト用ヘルパー
    simulateOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) {
            this.onopen(new Event('open'));
        }
    }

    simulateMessage(data: any): void {
        if (this.onmessage) {
            this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
        }
    }

    simulateError(): void {
        if (this.onerror) {
            this.onerror(new Event('error'));
        }
    }
}

// グローバル WebSocket をモックに置き換え
(global as any).WebSocket = MockWebSocket;

describe('WebSocketManager', () => {
    let manager: WebSocketManager;
    let mockHandlers: WebSocketMessageHandlers;

    beforeEach(() => {
        manager = new WebSocketManager();
        mockHandlers = {
            onSessionUpdated: jest.fn(),
            onAudioBufferCommitted: jest.fn(),
            onSpeechStarted: jest.fn(),
            onSpeechStopped: jest.fn(),
            onInputTranscription: jest.fn(),
            onAudioTranscriptDelta: jest.fn(),
            onAudioTranscriptDone: jest.fn(),
            onAudioDelta: jest.fn(),
            onAudioDone: jest.fn(),
            onResponseCreated: jest.fn(),
            onResponseDone: jest.fn(),
            onError: jest.fn()
        };
    });

    afterEach(() => {
        if (manager) {
            manager.disconnect();
        }
        // Ensure fake timers are cleaned up
        if (jest.isMockFunction(setTimeout)) {
            jest.useRealTimers();
        }
    });

    describe('初期状態', () => {
        it('should start with offline status', () => {
            expect(manager.getConnectionStatus()).toBe('offline');
        });
    });

    describe('connect()', () => {
        it('should connect successfully with valid API key', async () => {
            const connectPromise = manager.connect('sk-test-key');

            // WebSocket の open イベントを即座にシミュレート
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) {
                ws.simulateOpen();
            }

            await connectPromise;
            expect(manager.getConnectionStatus()).toBe('connected');
        });

        it('should set status to connecting during connection', async () => {
            const connectPromise = manager.connect('sk-test-key');
            expect(manager.getConnectionStatus()).toBe('connecting');
            
            // クリーンアップ
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) {
                ws.simulateOpen();
            }
            await connectPromise;
        });

        it('should reject with error for empty API key', async () => {
            await expect(manager.connect('')).rejects.toThrow('APIキーが必要です');
        });

        it('should handle connection timeout', async () => {
            jest.useFakeTimers();
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            manager.connect('sk-test-key');

            // タイムアウトをシミュレート
            expect(() => {
                jest.advanceTimersByTime(31000);
            }).toThrow('接続タイムアウト (30秒)');

            expect(consoleSpy).toHaveBeenCalledWith('[WebSocketManager] タイムアウト - 接続に失敗');
            consoleSpy.mockRestore();
            jest.useRealTimers();
        });

        it('should handle WebSocket error', async () => {
            const errorHandler = jest.fn();
            manager.setMessageHandlers({ onError: errorHandler });

            await manager.connect('sk-test-key');

            // WebSocket エラーをシミュレート
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) {
                ws.simulateError();
            }

            expect(errorHandler).toHaveBeenCalled();
            const call = errorHandler.mock.calls[0];
            expect(call[0]).toBeInstanceOf(Error);
            expect(call[0].message).toBe('WebSocket接続エラー');
        });
    });

    describe('disconnect()', () => {
        it('should disconnect successfully', async () => {
            // 接続
            const connectPromise = manager.connect('sk-test-key');
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) ws.simulateOpen();
            await connectPromise;

            // 切断
            await manager.disconnect();
            expect(manager.getConnectionStatus()).toBe('offline');
        });

        it('should do nothing if not connected', async () => {
            await expect(manager.disconnect()).resolves.not.toThrow();
            expect(manager.getConnectionStatus()).toBe('offline');
        });
    });

    describe('sendMessage()', () => {
        it('should send message when connected', async () => {
            // 接続
            const connectPromise = manager.connect('sk-test-key');
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) ws.simulateOpen();
            await connectPromise;

            // メッセージ送信
            const sendSpy = jest.spyOn(ws, 'send');
            manager.sendMessage({ type: 'test', data: 'hello' });

            expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
        });

        it('should log warning when not connected', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            manager.sendMessage({ type: 'test' });
            expect(consoleSpy).toHaveBeenCalledWith('[WebSocketManager] WebSocket未接続のため送信できません');
            consoleSpy.mockRestore();
        });
    });

    describe('createSession()', () => {
        it('should create session with valid config', async () => {
            // 接続
            const connectPromise = manager.connect('sk-test-key');
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) ws.simulateOpen();
            await connectPromise;

            const sendSpy = jest.spyOn(ws, 'send');

            const config: SessionConfig = {
                sourceLang: 'ja',
                targetLang: 'en',
                voiceType: 'alloy',
                audioOutputEnabled: true,
                vadEnabled: true,
                instructions: 'Test instructions'
            };

            manager.createSession(config);

            expect(sendSpy).toHaveBeenCalled();
            const sentData = JSON.parse(sendSpy.mock.calls[0][0]);
            expect(sentData.type).toBe('session.update');
        });
    });

    describe('updateSession()', () => {
        it('should update session with partial config', async () => {
            // 接続
            const connectPromise = manager.connect('sk-test-key');
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) ws.simulateOpen();
            await connectPromise;

            const sendSpy = jest.spyOn(ws, 'send');

            manager.updateSession({ voiceType: 'echo' });

            expect(sendSpy).toHaveBeenCalled();
            const sentData = JSON.parse(sendSpy.mock.calls[0][0]);
            expect(sentData.type).toBe('session.update');
        });
    });

    describe('メッセージハンドリング', () => {
        beforeEach(async () => {
            manager.setMessageHandlers(mockHandlers);

            // 接続
            const connectPromise = manager.connect('sk-test-key');
            const ws = (manager as any).ws as MockWebSocket;
            if (ws) ws.simulateOpen();
            await connectPromise;
        });

        it('should handle session.updated event', () => {
            const ws = (manager as any).ws as MockWebSocket;
            ws.simulateMessage({ type: 'session.updated', session: { id: 'test-session' } });

            expect(mockHandlers.onSessionUpdated).toHaveBeenCalledWith({ id: 'test-session' });
        });

        it('should handle response.audio.delta event', () => {
            const ws = (manager as any).ws as MockWebSocket;
            ws.simulateMessage({
                type: 'response.audio.delta',
                delta: 'base64-audio-data'
            });

            expect(mockHandlers.onAudioDelta).toHaveBeenCalledWith('base64-audio-data');
        });

        it('should handle error event', () => {
            const ws = (manager as any).ws as MockWebSocket;
            ws.simulateMessage({
                type: 'error',
                error: { message: 'Test error', code: 'test_error' }
            });

            expect(mockHandlers.onError).toHaveBeenCalled();
            const call = (mockHandlers.onError as jest.Mock).mock.calls[0];
            expect(call[0]).toBeInstanceOf(Error);
            expect(call[0].message).toBe('Test error');
            expect(call[1]).toBe('test_error');
        });
    });

    describe('環境判定', () => {
        it('should detect Electron environment', () => {
            const isElectron = (manager as any).isElectronEnvironment();
            expect(typeof isElectron).toBe('boolean');
        });
    });
});

