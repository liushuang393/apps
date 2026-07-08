/**
 * applyOutputSink の setSinkId 失敗耐性テスト（R3回帰）。
 *
 * 対象:
 *   setSinkId が一時的に失敗（未対応/権限/デバイス消失）しても、outputDeviceId を
 *   永続的に破壊しない。破壊すると出力隔離判定が false に固定され、仮想カード監視の
 *   TTS が回復不能に抑止され続ける（今回のバグ）。次回の再生で自動的に再試行され、
 *   成功すれば通常どおり隔離される。
 *
 * 実コード（root の voicetranslate-*.js）を vm で同一コンテキストに読み込み、
 * VoiceTranslateApp.prototype.applyOutputSink を擬似 this で検証する
 * （SendAudioDataDuplexGate.test.js と同じ手法）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadProApp() {
    const root = path.join(__dirname, '../..');
    const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

    const sandbox = {
        console,
        Date,
        document,
        navigator: { mediaDevices: null },
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Float32Array,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        WebSocket: { OPEN: 1 },
        module: { exports: {} }
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;

    vm.runInNewContext(
        [
            read('voicetranslate-utils.js'),
            read('voicetranslate-capture-profile.js'),
            read('voicetranslate-ui-mixin.js'),
            read('voicetranslate-websocket-mixin.js'),
            read('voicetranslate-pro.js'),
            'module.exports = { VoiceTranslateApp };'
        ].join('\n'),
        sandbox
    );
    return { App: sandbox.module.exports.VoiceTranslateApp, sandbox };
}

function makeApp(App, { outputDeviceId = 'physical-1' } = {}) {
    const app = Object.create(App.prototype);
    app.state = {
        outputDeviceId,
        outputDeviceLabel: 'ヘッドホン'
    };
    app.refreshCaptureProfile = jest.fn();
    app.notify = jest.fn();
    return app;
}

describe('applyOutputSink の setSinkId 失敗耐性（R3）', () => {
    let App;
    beforeAll(() => {
        ({ App } = loadProApp());
    });

    it('setSinkId 失敗時も outputDeviceId を保持する（永続状態を破壊しない）', async () => {
        const app = makeApp(App);
        const target = { setSinkId: jest.fn().mockRejectedValue(new Error('NotSupportedError')) };

        await app.applyOutputSink(target);

        expect(app.state.outputDeviceId).toBe('physical-1');
        expect(app.state.outputDeviceLabel).toBe('ヘッドホン');
        expect(app.refreshCaptureProfile).not.toHaveBeenCalled();
        expect(app.notify).toHaveBeenCalledTimes(1);
    });

    it('失敗後の次回再生で同じ deviceId で再試行し、成功すれば適用される', async () => {
        const app = makeApp(App);
        const target = {
            setSinkId: jest
                .fn()
                .mockRejectedValueOnce(new Error('NotSupportedError'))
                .mockResolvedValueOnce(undefined)
        };

        await app.applyOutputSink(target); // 1回目: 失敗
        await app.applyOutputSink(target); // 2回目: 成功（同じ deviceId で再試行）

        expect(target.setSinkId).toHaveBeenNthCalledWith(1, 'physical-1');
        expect(target.setSinkId).toHaveBeenNthCalledWith(2, 'physical-1');
        expect(app.state.outputDeviceId).toBe('physical-1');
    });

    it('連続して失敗しても通知は初回のみ（再生ごとに毎回通知しない）', async () => {
        const app = makeApp(App);
        const target = { setSinkId: jest.fn().mockRejectedValue(new Error('NotSupportedError')) };

        await app.applyOutputSink(target);
        await app.applyOutputSink(target);

        expect(app.notify).toHaveBeenCalledTimes(1);
    });
});
