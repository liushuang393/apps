/**
 * 設定UIコントロールの回帰テスト。
 *
 * 対象:
 *   - 言語セレクト: 入力言語は session.update を送らず、出力言語だけ安全に反映する
 *   - その他セレクト/トグル: 音声ソース、入力デバイス、VAD感度、表示/音声トグル
 *   - Electron IPC/デバイス検出の非同期失敗が未処理 rejection にならないこと
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadProApp() {
    const root = path.join(__dirname, '../..');
    const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

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
        addEventListener: () => {},
        removeEventListener: () => {},
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
            'module.exports = { VoiceTranslateApp, CONFIG };'
        ].join('\n'),
        sandbox
    );
    return { App: sandbox.module.exports.VoiceTranslateApp, CONFIG: sandbox.module.exports.CONFIG };
}

function renderSettingsDom() {
    document.body.innerHTML = `
        <input id="apiKey" />
        <div id="apiKeyProgress"></div>
        <button id="validateBtn"><span id="validateBtnText">APIキー検証</span></button>

        <select id="sourceLang">
            <option value="auto">自動判定</option>
            <option value="ja">日本語</option>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
        </select>
        <select id="targetLang">
            <option value="ja">日本語</option>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
        </select>
        <span id="targetLangDisplay"></span>

        <select id="audioSourceType">
            <option value="microphone">マイク</option>
            <option value="system">システム音声</option>
        </select>
        <div id="systemAudioSourceGroup" style="display: none;"></div>
        <button id="detectSourcesBtn"></button>
        <select id="systemAudioSource">
            <option value=""></option>
            <option value="display-media">display-media</option>
        </select>

        <div id="vadEnabled" class="toggle-switch active"></div>
        <div id="showInputTranscript" class="toggle-switch active"></div>
        <div id="showOutputTranscript" class="toggle-switch active"></div>
        <div id="audioOutputMode" class="toggle-switch active"></div>

        <select id="inputDeviceSelect">
            <option value="auto">自動</option>
            <option value="mic1">Mic 1</option>
        </select>
        <select id="vadSensitivity">
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
        </select>

        <button id="connectBtn"></button>
        <button id="disconnectBtn"></button>
        <button id="startBtn"></button>
        <button id="stopBtn"></button>
        <button id="clearInputBtn"></button>
        <button id="clearOutputBtn"></button>
        <button id="clearAllBtn"></button>
    `;
}

function makeApp(App) {
    renderSettingsDom();

    const saved = [];
    const notifications = [];
    const app = Object.create(App.prototype);
    app.platform = {
        isElectron: true,
        saveToStorage: (key, value) => saved.push([key, value])
    };
    app.elements = {
        apiKey: document.getElementById('apiKey'),
        validateBtn: document.getElementById('validateBtn'),
        sourceLang: document.getElementById('sourceLang'),
        targetLang: document.getElementById('targetLang'),
        sourceLangDisplay: document.createElement('span'),
        targetLangDisplay: document.getElementById('targetLangDisplay'),
        vadEnabled: document.getElementById('vadEnabled'),
        showInputTranscript: document.getElementById('showInputTranscript'),
        showOutputTranscript: document.getElementById('showOutputTranscript'),
        audioOutputMode: document.getElementById('audioOutputMode'),
        inputDeviceSelect: document.getElementById('inputDeviceSelect'),
        vadSensitivity: document.getElementById('vadSensitivity'),
        connectBtn: document.getElementById('connectBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        startBtn: document.getElementById('startBtn'),
        stopBtn: document.getElementById('stopBtn'),
        clearInputBtn: document.getElementById('clearInputBtn'),
        clearOutputBtn: document.getElementById('clearOutputBtn'),
        clearAllBtn: document.getElementById('clearAllBtn')
    };
    app.state = {
        apiKey: '',
        isConnected: false,
        isRecording: false,
        sourceLang: null,
        targetLang: 'ja',
        audioSourceType: 'microphone',
        preferredInputDeviceId: '',
        outputDeviceId: '',
        audioOutputMode: 'translation',
        translatedAudioEl: null
    };
    app.timers = {};
    app.vad = { threshold: 0, debounce: 0 };
    app.captureProfile = null;
    app._ttsSuppressedByLoopback = false;
    app.saved = saved;
    app.notifications = notifications;
    app.notify = (title, message, level) => notifications.push({ title, message, level });
    app.clearTranscript = jest.fn();
    app.start = jest.fn();
    app.stop = jest.fn();
    app.showHistory = jest.fn();
    app.closeHistoryModal = jest.fn();
    app.refreshCaptureProfile = jest.fn();
    app.restartCapture = jest.fn().mockResolvedValue(undefined);
    app.autoDetectVirtualCard = jest.fn().mockResolvedValue(undefined);
    app.detectAudioSources = jest.fn().mockResolvedValue(undefined);
    app.sendMessage = jest.fn().mockResolvedValue(true);
    app.initEventListeners();
    return app;
}

function fireChange(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('change'));
}

function fireClick(element) {
    element.dispatchEvent(new Event('click'));
}

async function flushAsyncEvents() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('settings controls', () => {
    it('入力言語変更は state/storage だけ更新し、translation session へ language 更新を送らない', async () => {
        const { App } = loadProApp();
        const app = makeApp(App);
        app.state.isConnected = true;
        app.sendMessage.mockRejectedValue(new Error('should not send'));

        fireChange(app.elements.sourceLang, 'zh');
        await flushAsyncEvents();

        expect(app.state.sourceLang).toBe('zh');
        expect(app.saved).toContainEqual(['source_lang', 'zh']);
        expect(app.sendMessage).not.toHaveBeenCalled();
        expect(app.notifications.some((n) => n.level === 'error')).toBe(false);
    });

    it('出力言語変更は安全に session.update を送り、transcription.language を含めない', async () => {
        const { App } = loadProApp();
        const app = makeApp(App);
        app.state.isConnected = true;

        fireChange(app.elements.targetLang, 'en');
        await flushAsyncEvents();

        expect(app.state.targetLang).toBe('en');
        expect(app.elements.targetLangDisplay.textContent).toBe('English');
        expect(app.saved).toContainEqual(['target_lang', 'en']);
        expect(app.clearTranscript).toHaveBeenCalledWith('both');
        expect(app.sendMessage).toHaveBeenCalledTimes(1);

        const message = app.sendMessage.mock.calls[0][0];
        expect(message.type).toBe('session.update');
        expect(message.session.audio.output.language).toBe('en');
        expect(message.session.audio.input.transcription).toEqual({
            model: 'gpt-realtime-whisper'
        });
        expect(message.session.audio.input.transcription.language).toBeUndefined();
    });

    it('出力言語の session.update 失敗は通知に変換され、未処理 rejection にしない', async () => {
        const { App } = loadProApp();
        const app = makeApp(App);
        app.state.isConnected = true;
        app.sendMessage.mockRejectedValue(new Error('IPC failed'));

        fireChange(app.elements.targetLang, 'zh');
        await flushAsyncEvents();

        expect(app.notifications).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    title: '設定変更エラー',
                    level: 'error'
                })
            ])
        );
    });

    it('音声ソース・入力デバイス・VAD感度・各トグルを切り替えても同期/非同期エラーを漏らさない', async () => {
        const { App, CONFIG } = loadProApp();
        const app = makeApp(App);

        fireChange(document.getElementById('audioSourceType'), 'system');
        await flushAsyncEvents();
        expect(app.state.audioSourceType).toBe('system');
        expect(app.saved).toContainEqual(['audio_source_type', 'system']);
        expect(app.autoDetectVirtualCard).toHaveBeenCalled();
        expect(app.refreshCaptureProfile).toHaveBeenCalled();
        expect(app.restartCapture).toHaveBeenCalledWith('音声ソース切替に失敗');

        fireChange(app.elements.inputDeviceSelect, 'mic1');
        await flushAsyncEvents();
        expect(app.state.preferredInputDeviceId).toBe('mic1');
        expect(app.saved).toContainEqual(['preferred_input_device', 'mic1']);

        fireClick(app.elements.vadEnabled);
        expect(app.elements.vadEnabled.classList.contains('active')).toBe(false);
        expect(app.saved).toContainEqual(['vadEnabled', false]);

        fireClick(app.elements.showInputTranscript);
        expect(app.saved).toContainEqual(['showInputTranscript', false]);

        fireClick(app.elements.showOutputTranscript);
        expect(app.saved).toContainEqual(['showOutputTranscript', false]);

        fireClick(app.elements.audioOutputMode);
        expect(app.state.audioOutputMode).toBe('off');
        expect(app.saved).toContainEqual(['audio_output_mode', 'off']);

        fireChange(app.elements.vadSensitivity, 'high');
        expect(app.saved).toContainEqual(['vad_sensitivity', 'high']);
        expect(app.vad.threshold).toBe(CONFIG.VAD.SYSTEM.HIGH.threshold);
        expect(app.vad.debounce).toBe(CONFIG.VAD.SYSTEM.HIGH.debounce);
    });

    it('音声ソースの非同期失敗も設定変更エラーとして捕捉する', async () => {
        const { App } = loadProApp();
        const app = makeApp(App);
        app.autoDetectVirtualCard.mockRejectedValue(new Error('device scan failed'));

        fireChange(document.getElementById('audioSourceType'), 'system');
        await flushAsyncEvents();

        expect(app.notifications).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    title: '設定変更エラー',
                    level: 'error'
                })
            ])
        );
    });
});
