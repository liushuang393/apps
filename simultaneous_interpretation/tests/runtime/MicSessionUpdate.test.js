/**
 * Electron マイク経路の session.update 形状テスト（P0: noise_reduction 省略）。
 *
 * updateSession が electron-mic プロファイルで noise_reduction フィールドを
 * 送らないことを検証する（API 400 / 左列 ASR 停止の回帰防止）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildCaptureProfile } = require('../../voicetranslate-capture-profile.js');
const { buildTranslationSessionConfig } = require('../../voicetranslate-transport-config.js');

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
        Float32Array,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        WebSocket: { OPEN: 1 },
        CONFIG: {
            AUDIO: { SAMPLE_RATE: 24000 },
            API: {
                REALTIME_URL: 'wss://api.openai.com/v1/realtime/translations',
                REALTIME_MODEL: 'gpt-realtime-translate',
                TRANSCRIBE_MODEL: 'gpt-realtime-whisper'
            }
        },
        module: { exports: {} }
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;

    vm.runInNewContext(
        [
            read('voicetranslate-utils.js'),
            read('voicetranslate-capture-profile.js'),
            read('voicetranslate-transport-config.js'),
            read('voicetranslate-ui-mixin.js'),
            read('voicetranslate-websocket-mixin.js'),
            read('voicetranslate-pro.js'),
            'module.exports = { VoiceTranslateApp, buildTranslationSessionConfig };'
        ].join('\n'),
        sandbox
    );
    return sandbox.module.exports;
}

describe('resolveSessionNoiseReduction / updateSession（electron-mic）', () => {
    it('electron-mic は WS 経路で noise_reduction を省略する', () => {
        const { VoiceTranslateApp } = loadProApp();
        const app = Object.create(VoiceTranslateApp.prototype);
        app.captureProfile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });

        expect(app.resolveSessionNoiseReduction(false)).toBeUndefined();
    });

    it('browser-mic は WebRTC 経路で near_field を既定とする', () => {
        const { VoiceTranslateApp } = loadProApp();
        const app = Object.create(VoiceTranslateApp.prototype);
        app.captureProfile = buildCaptureProfile({
            isElectron: false,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });

        expect(app.resolveSessionNoiseReduction(true)).toEqual({ type: 'near_field' });
    });

    it('browser-tab は WebRTC でも去噪フィールドを省略する', () => {
        const { VoiceTranslateApp } = loadProApp();
        const app = Object.create(VoiceTranslateApp.prototype);
        app.captureProfile = buildCaptureProfile({
            isElectron: false,
            audioSourceType: 'system',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });

        expect(app.resolveSessionNoiseReduction(true)).toBeUndefined();
    });

    it('updateSession の session body に noise_reduction が含まれない（electron-mic）', async () => {
        const { VoiceTranslateApp } = loadProApp();
        const app = Object.create(VoiceTranslateApp.prototype);
        app.state = { isConnected: true, targetLang: 'ja' };
        app.captureProfile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });
        app.buildInputTranscriptionConfig = () => ({ model: 'gpt-realtime-whisper' });

        let sentSession = null;
        app.sendMessage = jest.fn(async (msg) => {
            sentSession = msg.session;
            return true;
        });

        await app.updateSession();

        expect(sentSession).toBeTruthy();
        expect(sentSession.audio.input.transcription).toEqual({ model: 'gpt-realtime-whisper' });
        expect(sentSession.audio.input.noise_reduction).toBeUndefined();
        expect(sentSession.audio.output.language).toBe('ja');
    });
});
