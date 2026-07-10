/**
 * sendAudioData 半二重ゲートのテスト（D1/D5回帰）。
 *
 * 対象:
 *   - D1: ゲートが captureProfile（実効デバイス）で判定されること。
 *     仮想カード監視は outputDeviceId 未設定でも TTS 再生中に送信される（今日のバグの再現）。
 *   - D5: sendMessage の失敗フレームを recordRealtimeInputAudioAppend に計上しないこと。
 *
 * 実コード（root の voicetranslate-*.js）を vm で同一コンテキストに読み込み、
 * VoiceTranslateApp.prototype のメソッドを Object.create(prototype) の擬似 this で検証する。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildCaptureProfile } = require('../../voicetranslate-capture-profile.js');
const { buildTransportDescriptor } = require('../../voicetranslate-transport-config.js');

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

/** 擬似 this を作る（プロトタイプメソッドは実物、外部依存のみスタブ） */
function makeApp(App, { profile, isPlayingAudio, outputEndTime = null, sendResult = true }) {
    const app = Object.create(App.prototype);
    app.usesWebRtcTransport = () => false;
    // 既定は PCM append 経路（Electron/WS）。WebRTC ケースは各テストで transport を差し替える。
    app.transport = buildTransportDescriptor({ isElectron: true, isTranslationSession: true });
    app.isRealtimeTranslationSession = () => true;
    app.state = {
        isConnected: true,
        isRecording: true,
        isPlayingAudio,
        audioSourceType: 'system',
        outputDeviceId: '' // 物理出力未検出（今日のバグの再現条件）
    };
    app.captureProfile = profile;
    app.audioSourceTracker = { outputEndTime, bufferWindow: 400, playbackTokens: new Set() };
    app.sendMessage = jest.fn(() => Promise.resolve(sendResult));
    return app;
}

const AUDIO = new Float32Array([0.1, -0.2, 0.3]);

describe('sendAudioData 半二重ゲート（D1）', () => {
    let App;
    beforeAll(() => {
        ({ App } = loadProApp());
    });

    it('仮想カード×TTS再生中×出力未隔離 → フレームを送信する（漏識別バグの回帰）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: false
        });
        const app = makeApp(App, { profile, isPlayingAudio: true });
        const result = app.sendAudioData(AUDIO);
        expect(result).toBe(true);
        expect(app.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('通訳セッション×マイク×TTS再生中 → 送信する（全二重・文落ち回帰ガード）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });
        const app = makeApp(App, { profile, isPlayingAudio: true });
        expect(app.sendAudioData(AUDIO)).toBe(true);
        expect(app.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('通訳セッション×マイクフォールバック×出力隔離済み×TTS再生中 → 送信する', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: true,
            realtimeSession: true
        });
        const app = makeApp(App, { profile, isPlayingAudio: true });
        expect(app.sendAudioData(AUDIO)).toBe(true);
        expect(app.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('通訳セッション×マイクフォールバック×出力未隔離×TTS再生中 → 送信する（PCマイク監視の漏れ防止）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: false,
            realtimeSession: true
        });
        const app = makeApp(App, { profile, isPlayingAudio: true });
        expect(app.sendAudioData(AUDIO)).toBe(true);
        expect(app.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('非通訳セッション×マイクフォールバック中×TTS再生中 → スキップ（物理マイク保護）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: false
        });
        const app = makeApp(App, { profile, isPlayingAudio: true });
        expect(app.sendAudioData(AUDIO)).toBe(false);
        expect(app.sendMessage).not.toHaveBeenCalled();
    });

    it('非通訳セッション×マイクフォールバック中×再生終了直後（bufferWindow内） → スキップ', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: false
        });
        const app = makeApp(App, {
            profile,
            isPlayingAudio: false,
            outputEndTime: Date.now() - 100
        });
        expect(app.sendAudioData(AUDIO)).toBe(false);
    });

    it('セッション種別判定に依存しない（config ドリフトでもマイク以外は全二重を維持）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: false
        });
        const app = makeApp(App, { profile, isPlayingAudio: true });
        app.isRealtimeTranslationSession = () => false; // URL/モデル名が翻訳端点でない場合
        expect(app.sendAudioData(AUDIO)).toBe(true);
        expect(app.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('WebRTC トランスポートでは PCM append しない（既存挙動の維持）', () => {
        const profile = buildCaptureProfile({
            isElectron: false,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false
        });
        const app = makeApp(App, { profile, isPlayingAudio: false });
        app.usesWebRtcTransport = () => true;
        // WebRTC はマイク音声をメディアトラックで送るため PCM append しない（transport で表現）。
        app.transport = buildTransportDescriptor({ isElectron: false, isTranslationSession: true });
        expect(app.sendAudioData(AUDIO)).toBe(false);
        expect(app.sendMessage).not.toHaveBeenCalled();
    });
});

describe('sendAudioData 送信失敗の計上（D5）', () => {
    let App;
    beforeAll(() => {
        ({ App } = loadProApp());
    });

    const fullProfile = () =>
        buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: true
        });

    it('送信成功フレームは統計に計上される（同一ティック内 commit 用に同期計上）', async () => {
        const app = makeApp(App, {
            profile: fullProfile(),
            isPlayingAudio: false,
            sendResult: true
        });
        expect(app.sendAudioData(AUDIO)).toBe(true);
        // 同期計上（Path1 の追記→即 commit 経路が依存）
        expect(app.getRealtimeInputAudioBufferStats().samples).toBe(AUDIO.length);
        await Promise.resolve();
        await Promise.resolve();
        expect(app.getRealtimeInputAudioBufferStats().samples).toBe(AUDIO.length);
    });

    it('送信失敗が判明したフレームは統計から取り消す（幻の commit を防ぐ）', async () => {
        const app = makeApp(App, {
            profile: fullProfile(),
            isPlayingAudio: false,
            sendResult: false
        });
        app.sendAudioData(AUDIO);
        await Promise.resolve();
        await Promise.resolve();
        expect(app.getRealtimeInputAudioBufferStats().samples).toBe(0);
        expect(app.getRealtimeInputAudioBufferStats().chunks).toBe(0);
    });
});
