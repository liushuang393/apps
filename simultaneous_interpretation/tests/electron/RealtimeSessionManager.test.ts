import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { CredentialService } from '../../electron/CredentialService';
import { OpenAIConfigService } from '../../electron/OpenAIConfigService';
import { RealtimeSessionManager } from '../../electron/realtimeWebSocket';

class FakeSocket extends EventEmitter {
    public readyState = WebSocket.CONNECTING;
    public readonly send = jest.fn();
    public readonly terminate = jest.fn(() => {
        this.readyState = WebSocket.CLOSED;
    });
    public readonly close = jest.fn((code = 1000, reason = 'client-close') => {
        this.readyState = WebSocket.CLOSED;
        this.emit('close', code, Buffer.from(reason));
    });

    public open(): void {
        this.readyState = WebSocket.OPEN;
        this.emit('open');
    }
}

function owner(id = 1) {
    return {
        id,
        send: jest.fn(),
        isDestroyed: jest.fn(() => false)
    };
}

describe('RealtimeSessionManager', () => {
    const credentials = { getApiKey: () => 'test-key' } as unknown as CredentialService;
    const config = new OpenAIConfigService({});

    afterEach(() => {
        jest.useRealTimers();
    });

    it('resolves connect only after open and validates outbound event types', async () => {
        const socket = new FakeSocket();
        const renderer = owner();
        const factory = jest.fn(() => socket as unknown as WebSocket);
        const manager = new RealtimeSessionManager(credentials, config, factory);
        const connecting = manager.connect(renderer as never);
        let settled = false;
        void connecting.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        socket.open();
        const result = await connecting;
        expect(renderer.send).toHaveBeenCalledWith(
            'realtime:event',
            expect.objectContaining({ connectionId: result.connectionId, kind: 'open' })
        );
        expect(manager.send(result.connectionId, { type: 'session.update', session: {} })).toEqual({
            success: true
        });
        // Realtime GA 翻訳セッションの音声追記型。拒否すると全音声フレームが落ちる（回帰防止）。
        expect(
            manager.send(result.connectionId, {
                type: 'session.input_audio_buffer.append',
                audio: 'AAAA'
            })
        ).toEqual({ success: true });
        expect(manager.send(result.connectionId, { type: 'arbitrary.request' }).success).toBe(
            false
        );
    });

    it('ignores delayed events from an old socket after reconnect', async () => {
        const sockets = [new FakeSocket(), new FakeSocket()];
        const renderer = owner();
        const manager = new RealtimeSessionManager(
            credentials,
            config,
            () => sockets.shift() as unknown as WebSocket
        );
        const firstPromise = manager.connect(renderer as never);
        await Promise.resolve();
        // socket 0 has been shifted; keep explicit references for stale-event simulation.
        const firstSocket = (manager as unknown as { active: { socket: FakeSocket } }).active
            .socket;
        firstSocket.open();
        const firstConnection = await firstPromise;

        const secondPromise = manager.connect(renderer as never);
        await Promise.resolve();
        await Promise.resolve();
        const secondSocket = (manager as unknown as { active: { socket: FakeSocket } }).active
            .socket;
        secondSocket.open();
        const secondConnection = await secondPromise;
        firstSocket.emit('close', 1006, Buffer.from('late close'));

        expect(manager.getState()).toEqual({
            connectionId: secondConnection.connectionId,
            state: 'open'
        });
        expect(firstConnection.connectionId).not.toBe(secondConnection.connectionId);
    });

    it('rejects error-before-open and clears active state', async () => {
        const socket = new FakeSocket();
        const manager = new RealtimeSessionManager(
            credentials,
            config,
            () => socket as unknown as WebSocket
        );
        const connecting = manager.connect(owner() as never);
        await Promise.resolve();
        socket.emit('error', new Error('401 unauthorized'));
        await expect(connecting).rejects.toThrow('401 unauthorized');
        expect(socket.terminate).toHaveBeenCalled();
        expect(manager.getState()).toEqual({ connectionId: null, state: 'idle' });
    });

    it('times out a websocket that never opens', async () => {
        jest.useFakeTimers();
        const socket = new FakeSocket();
        const manager = new RealtimeSessionManager(
            credentials,
            config,
            () => socket as unknown as WebSocket
        );
        const connecting = manager.connect(owner() as never);
        await Promise.resolve();
        jest.advanceTimersByTime(30_000);
        await expect(connecting).rejects.toThrow('タイムアウト');
        expect(socket.terminate).toHaveBeenCalledTimes(1);
    });

    it('rejects connect without a configured key', async () => {
        const noCredentials = { getApiKey: () => null } as unknown as CredentialService;
        const manager = new RealtimeSessionManager(noCredentials, config);
        await expect(manager.connect(owner() as never)).rejects.toThrow('API キー');
    });

    it('bounds payloads and reports send failures without throwing', async () => {
        const socket = new FakeSocket();
        const manager = new RealtimeSessionManager(
            credentials,
            config,
            () => socket as unknown as WebSocket
        );
        const connecting = manager.connect(owner() as never);
        await Promise.resolve();
        socket.open();
        const { connectionId } = await connecting;

        expect(manager.send('stale-id', { type: 'session.close' }).success).toBe(false);
        expect(manager.send(connectionId, null).success).toBe(false);
        expect(
            manager.send(connectionId, {
                type: 'input_audio_buffer.append',
                audio: 'a'.repeat(4 * 1024 * 1024)
            }).success
        ).toBe(false);
        socket.send.mockImplementationOnce(() => {
            throw new Error('send failed');
        });
        expect(manager.send(connectionId, { type: 'session.close' })).toMatchObject({
            success: false,
            message: expect.stringContaining('send failed')
        });
    });

    it('forwards current messages, checks ownership, and closes idempotently', async () => {
        const socket = new FakeSocket();
        const renderer = owner(7);
        const manager = new RealtimeSessionManager(
            credentials,
            config,
            () => socket as unknown as WebSocket
        );
        const connecting = manager.connect(renderer as never);
        await Promise.resolve();
        socket.open();
        const { connectionId } = await connecting;
        expect(manager.ownsConnection(connectionId, renderer as never)).toBe(true);
        expect(manager.ownsConnection(connectionId, owner(8) as never)).toBe(false);

        socket.emit('message', Buffer.from('{"type":"session.updated"}'));
        expect(renderer.send).toHaveBeenLastCalledWith(
            'realtime:event',
            expect.objectContaining({ kind: 'message' })
        );
        await manager.close('stale-id');
        await manager.close(connectionId);
        await manager.close(connectionId);
        await manager.cleanup();
        expect(manager.getState()).toEqual({ connectionId: null, state: 'idle' });
    });

    it('rejects a socket that closes before opening', async () => {
        const socket = new FakeSocket();
        const renderer = owner();
        const manager = new RealtimeSessionManager(
            credentials,
            config,
            () => socket as unknown as WebSocket
        );
        const connecting = manager.connect(renderer as never);
        await Promise.resolve();
        socket.emit('close', 1008, Buffer.from('invalid api key'));
        await expect(connecting).rejects.toThrow('接続前に終了');
        expect(renderer.send).toHaveBeenCalledWith(
            'realtime:event',
            expect.objectContaining({ kind: 'close', authError: true })
        );
    });
});
