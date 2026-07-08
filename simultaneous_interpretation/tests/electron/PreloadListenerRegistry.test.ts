/**
 * preload.ts の IPC リスナー登録/解除テスト（D7回帰）。
 *
 * 対象:
 *   electronAPI.off() が on() で登録した実際のラッパー関数を removeListener に渡すこと。
 *   （旧: on() が匿名ラッパーで登録する一方、off() は元コールバックを渡すため
 *     永久に解除できず、再購読のたびにリスナーが蓄積＝字幕二重の温床）
 */

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

// preload はロード時に exposeInMainWorld を呼ぶ副作用モジュール
import '../../electron/preload';

/** exposeInMainWorld に渡された electronAPI を取り出す */
function getExposedApi(): {
    on: (channel: string, cb: (...args: unknown[]) => void) => void;
    off: (channel: string, cb: (...args: unknown[]) => void) => void;
} {
    const calls = (contextBridge.exposeInMainWorld as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[0][1];
}

describe('electronAPI.on / off（D7: リスナー解除の実効性）', () => {
    beforeEach(() => {
        (ipcRenderer.on as jest.Mock).mockClear();
        (ipcRenderer.removeListener as jest.Mock).mockClear();
    });

    it('off() は on() が登録したラッパー関数そのものを removeListener に渡す', () => {
        const api = getExposedApi();
        const callback = jest.fn();

        api.on('realtime-ws-message', callback);
        expect(ipcRenderer.on).toHaveBeenCalledTimes(1);
        const registeredWrapper = (ipcRenderer.on as jest.Mock).mock.calls[0][1];

        api.off('realtime-ws-message', callback);
        expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1);
        const removedListener = (ipcRenderer.removeListener as jest.Mock).mock.calls[0][1];

        // 同一の関数参照であること（これが成立しないと永久にリスナーが残る）
        expect(removedListener).toBe(registeredWrapper);
    });

    it('未登録のコールバックの off() は removeListener を呼ばない', () => {
        const api = getExposedApi();
        api.off('realtime-ws-message', jest.fn());
        expect(ipcRenderer.removeListener).not.toHaveBeenCalled();
    });

    it('許可されていないチャネルは on() で登録されない', () => {
        const api = getExposedApi();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        api.on('not-allowed-channel', jest.fn());
        expect(ipcRenderer.on).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
