/**
 * 無音検証フォールバックの連鎖制限テスト（D4回帰）。
 *
 * 対象:
 *   evaluateSilenceVerification が「1録音セッションにつき自動フォールバック1回まで」を守ること。
 *   （旧: restartCapture で検証窓が再アームされ、会議開始前の静寂で
 *     仮想カード→ループバック→マイクと連鎖降格し、以降会議音声を拾えなくなる）
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

/** 無音検証テスト用の擬似 this（無音状態の Electron system モード） */
function makeApp(App, overrides = {}) {
    const app = Object.create(App.prototype);
    app.platform = { isElectron: true };
    app.state = {
        audioSourceType: 'system',
        isRecording: true,
        preferredInputDeviceId: ''
    };
    app._captureFallbackStage = 'virtual-card';
    app._captureFallbackTarget = null;
    app.silenceFallbackDone = false;
    app.silenceVerifyMaxEnergy = 0; // 無音
    app.silenceVerifyActive = true;
    app.silenceVerifyTimer = null;
    app.notify = jest.fn();
    app.restartCapture = jest.fn();
    return Object.assign(app, overrides);
}

describe('evaluateSilenceVerification（D4: 連鎖降格の制限）', () => {
    let App;
    beforeAll(() => {
        ({ App } = loadProApp());
    });

    it('無音1回目: loopback への自動フォールバックを1回だけ実行しフラグを立てる', () => {
        const app = makeApp(App);

        app.evaluateSilenceVerification();

        expect(app.restartCapture).toHaveBeenCalledTimes(1);
        expect(app._captureFallbackTarget).toBe('loopback');
        expect(app.silenceFallbackDone).toBe(true);
    });

    it('無音2回目（フラグ済）: 自動切替せず警告通知のみ（マイクまで連鎖しない）', () => {
        const app = makeApp(App, {
            _captureFallbackStage: 'loopback',
            silenceFallbackDone: true
        });

        app.evaluateSilenceVerification();

        expect(app.restartCapture).not.toHaveBeenCalled();
        expect(app._captureFallbackTarget).toBe(null);
        expect(app.notify).toHaveBeenCalled(); // 「音声が検出できません」エラー案内
    });

    it('音声を検出済み（maxEnergy >= 閾値）: 何もしない', () => {
        const app = makeApp(App, { silenceVerifyMaxEnergy: 0.5 });

        app.evaluateSilenceVerification();

        expect(app.restartCapture).not.toHaveBeenCalled();
        expect(app.notify).not.toHaveBeenCalled();
        expect(app.silenceFallbackDone).toBe(false);
    });

    it('ピン留めデバイス選択中: 自動切替せず警告のみ（ユーザーの明示選択を覆さない）', () => {
        const app = makeApp(App);
        app.state.preferredInputDeviceId = 'pinned-device-1';

        app.evaluateSilenceVerification();

        expect(app.restartCapture).not.toHaveBeenCalled();
        expect(app.notify).toHaveBeenCalled();
    });

    it('マイクモード: 自動切替の対象外', () => {
        const app = makeApp(App, { _captureFallbackStage: null });
        app.state.audioSourceType = 'microphone';

        app.evaluateSilenceVerification();

        expect(app.restartCapture).not.toHaveBeenCalled();
    });
});
