/**
 * システム音声キャプチャの getUserMedia 制約テスト（R4回帰）。
 *
 * 対象:
 *   仮想カード/ループバック採集で sampleRate をネイティブレートに固定していないこと。
 *   固定すると、共有 AudioContext がネイティブレートで動作する現在の実装との間で
 *   「24kHz固定 → ネイティブレートへup-resample → 送信直前に24kへdown-resample」という
 *   二重リサンプルが発生し、STT 入力音質が劣化する（磕巴/認識劣化の原因）。
 *   ネイティブレートで採集し、送信直前の resampleMicTo24k で一度だけ24kへ変換するのが正しい。
 *
 * startVirtualCardCapture / startLoopbackCapture を代表として検証する
 * （startPinnedDeviceCapture 仮想分岐・startSystemAudioCapture も同一パターンで修正済み）。
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
        AudioCaptureStrategyFactory: { createStrategy: () => {} },
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

function makeApp(App) {
    const app = Object.create(App.prototype);
    app.state = {};
    app.notify = () => {};
    return app;
}

describe('システム音声キャプチャの sampleRate 固定禁止（R4・二重リサンプル回帰ガード）', () => {
    let App, sandbox;
    beforeAll(() => {
        ({ App, sandbox } = loadProApp());
    });

    it('startVirtualCardCapture は sampleRate を固定しない（ネイティブレート採集）', async () => {
        const app = makeApp(App);
        app.state.virtualCardDeviceId = 'virtual-card-1';
        let capturedConfig = null;
        sandbox.AudioCaptureStrategyFactory.createStrategy = ({ config }) => {
            capturedConfig = config;
            return { capture: () => Promise.resolve({}) };
        };

        await app.startVirtualCardCapture();

        expect(capturedConfig.sampleRate).toBeUndefined();
        expect(capturedConfig.echoCancellation).toBe(false);
    });

    it('startLoopbackCapture は sampleRate を固定しない（ネイティブレート採集）', async () => {
        const app = makeApp(App);
        app.platform = {
            detectMeetingApps: () => Promise.resolve([{ id: 'src-1', name: 'Teams' }])
        };
        let capturedConfig = null;
        sandbox.AudioCaptureStrategyFactory.createStrategy = ({ config }) => {
            capturedConfig = config;
            return { capture: () => Promise.resolve({}) };
        };

        await app.startLoopbackCapture();

        expect(capturedConfig.sampleRate).toBeUndefined();
        expect(capturedConfig.echoCancellation).toBe(false);
    });
});
