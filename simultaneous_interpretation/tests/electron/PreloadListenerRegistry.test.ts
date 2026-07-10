/** Explicit preload API regression tests. */

jest.mock('electron', () => ({
    contextBridge: { exposeInMainWorld: jest.fn() },
    ipcRenderer: {
        on: jest.fn(),
        removeListener: jest.fn(),
        send: jest.fn(),
        invoke: jest.fn()
    }
}));

import { contextBridge, ipcRenderer } from 'electron';
import '../../electron/preload';

function getExposedApi(): Record<string, any> {
    const calls = (contextBridge.exposeInMainWorld as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[0][1] as Record<string, any>;
}

describe('explicit electron preload API', () => {
    beforeEach(() => {
        (ipcRenderer.on as jest.Mock).mockClear();
        (ipcRenderer.removeListener as jest.Mock).mockClear();
    });

    it('realtime.subscribe returns an effective unsubscribe callback', () => {
        const api = getExposedApi();
        const callback = jest.fn();
        const unsubscribe = api.realtime.subscribe(callback);

        expect(ipcRenderer.on).toHaveBeenCalledWith('realtime:event', expect.any(Function));
        const wrapper = (ipcRenderer.on as jest.Mock).mock.calls[0][1];
        const payload = { connectionId: 'c1', kind: 'open' };
        wrapper({}, payload);
        expect(callback).toHaveBeenCalledWith(payload);

        unsubscribe();
        expect(ipcRenderer.removeListener).toHaveBeenCalledWith('realtime:event', wrapper);
    });

    it('does not expose generic channels, keys, URLs, or arbitrary chat', () => {
        const api = getExposedApi();
        expect(api.on).toBeUndefined();
        expect(api.off).toBeUndefined();
        expect(api.getEnvApiKey).toBeUndefined();
        expect(api.conversation).toBeUndefined();
        expect(Object.keys(api.history).sort()).toEqual([
            'clearAll',
            'endSession',
            'getSession',
            'listSessions',
            'startSession',
            'upsertSegment'
        ]);
        expect(Object.keys(api.translation)).toEqual(['translate']);
    });
});
