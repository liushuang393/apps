/**
 * VAD 感度設定のテスト（D2/D3回帰）。
 *
 * 対象:
 *   - D3: initVAD が実働 VoiceActivityDetector の実フィールド（debounce）に設定を載せること
 *     （旧: debounceTime に渡して常に既定300msで固定＝語尾切れの原因）。
 *   - D2: updateVADSensitivity が captureProfile.vadPreset（実効デバイス）でプリセットを選ぶこと
 *     （旧: audioSourceType 直読みで、system→マイクフォールバック時に2.5倍高い閾値を適用）。
 *   - setCaptureFallbackStage が段変更時にプロファイルとVADプリセットを追随させること。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildCaptureProfile } = require('../../voicetranslate-capture-profile.js');

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
            'module.exports = { VoiceTranslateApp, CONFIG, VoiceActivityDetector };'
        ].join('\n'),
        sandbox
    );
    return { ...sandbox.module.exports, sandbox };
}

describe('initVAD（D3: 実フィールドへの設定反映）', () => {
    it('debounce が MICROPHONE.MEDIUM の値になる（クラス既定300msのままではない）', () => {
        const { VoiceTranslateApp: App, CONFIG } = loadProApp();
        const app = Object.create(App.prototype);
        app.vad = null;
        app.initVAD();
        expect(app.vad.debounce).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.debounce);
        expect(app.vad.threshold).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.threshold);
    });
});

describe('updateVADSensitivity（D2: 実効デバイスでプリセット選択）', () => {
    it('system モード中でもマイクへフォールバック済みなら MICROPHONE プリセットを適用する', () => {
        const { VoiceTranslateApp: App, CONFIG, VoiceActivityDetector } = loadProApp();
        const app = Object.create(App.prototype);
        app.state = { audioSourceType: 'system', outputDeviceId: '' };
        app.vad = new VoiceActivityDetector({ threshold: 0.01, debounce: 600 });
        app.captureProfile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: false
        });

        app.updateVADSensitivity('medium');

        expect(app.vad.threshold).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.threshold);
        expect(app.vad.debounce).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.debounce);
        // 死んだフィールドへの書込が残っていないこと
        expect(Object.prototype.hasOwnProperty.call(app.vad, 'adaptiveThreshold')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(app.vad, 'debounceTime')).toBe(false);
    });

    it('仮想カード監視中は MICROPHONE プリセットを適用する（感度のみ借用・SYSTEM閾値による欠落防止）', () => {
        const { VoiceTranslateApp: App, CONFIG, VoiceActivityDetector } = loadProApp();
        const app = Object.create(App.prototype);
        app.state = { audioSourceType: 'system', outputDeviceId: 'physical-1' };
        app.vad = new VoiceActivityDetector({ threshold: 0.01, debounce: 600 });
        app.captureProfile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: true
        });

        app.updateVADSensitivity('medium');

        expect(app.vad.threshold).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.threshold);
        expect(app.vad.debounce).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.debounce);
        expect(app.captureProfile.captionPolicy).toBe('stream-preview');
        expect(app.captureProfile.preferContinuousCapture).toBe(true);
    });
});

describe('setCaptureFallbackStage（段変更でプロファイル・VAD・TTS抑止が追随）', () => {
    /** 段遷移テスト用の擬似 this を作る */
    function makeApp(App, VoiceActivityDetector, CONFIG) {
        const app = Object.create(App.prototype);
        app.platform = { isElectron: true };
        app.state = { audioSourceType: 'system', outputDeviceId: 'physical-1' };
        app.elements = { vadSensitivity: { value: 'medium' } };
        app.vad = new VoiceActivityDetector({
            threshold: CONFIG.VAD.SYSTEM.MEDIUM.threshold,
            debounce: CONFIG.VAD.SYSTEM.MEDIUM.debounce
        });
        app._ttsSuppressedByLoopback = false;
        app.applyAudioOutputMode = jest.fn();
        app.notify = jest.fn();
        return app;
    }

    it('microphone 段へ遷移すると MICROPHONE プリセットへ追随する（D2の同期点）', () => {
        const { VoiceTranslateApp: App, CONFIG, VoiceActivityDetector } = loadProApp();
        const app = makeApp(App, VoiceActivityDetector, CONFIG);

        app.setCaptureFallbackStage('microphone');

        expect(app.captureProfile.profileId).toBe('electron-mic-fallback');
        expect(app.vad.threshold).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.threshold);
        expect(app.vad.debounce).toBe(CONFIG.VAD.MICROPHONE.MEDIUM.debounce);
        expect(app._ttsSuppressedByLoopback).toBe(false);
    });

    it('loopback 段へ遷移すると TTS を抑止する（既存挙動の維持）', () => {
        const { VoiceTranslateApp: App, CONFIG, VoiceActivityDetector } = loadProApp();
        const app = makeApp(App, VoiceActivityDetector, CONFIG);

        app.setCaptureFallbackStage('loopback');

        expect(app.captureProfile.profileId).toBe('electron-loopback');
        expect(app._ttsSuppressedByLoopback).toBe(true);
        expect(app.applyAudioOutputMode).toHaveBeenCalled();
    });

    it('virtual-card 段×出力未隔離は TTS を抑止する（D6: 回灌の出力側遮断）', () => {
        const { VoiceTranslateApp: App, CONFIG, VoiceActivityDetector } = loadProApp();
        const app = makeApp(App, VoiceActivityDetector, CONFIG);
        app.state.outputDeviceId = ''; // 物理出力なし＝既定出力が仮想カードの可能性

        app.setCaptureFallbackStage('virtual-card');

        expect(app._ttsSuppressedByLoopback).toBe(true);
    });

    it('virtual-card 段×出力隔離済みはヘッドホン等の物理出力へ TTS を再生する', () => {
        const { VoiceTranslateApp: App, CONFIG, VoiceActivityDetector } = loadProApp();
        const app = makeApp(App, VoiceActivityDetector, CONFIG);

        app.setCaptureFallbackStage('virtual-card');

        expect(app._ttsSuppressedByLoopback).toBe(false);
        expect(app.captureProfile.ttsPolicy).toBe('play');
    });
});

describe('applyAudioOutputMode（D1: 画面トグルの誠実化）', () => {
    /** トグル誠実化テスト用の擬似 this（実 applyAudioOutputMode を使う） */
    function makeToggleApp(App) {
        const app = Object.create(App.prototype);
        const toggle = document.createElement('button');
        toggle.classList.add('active'); // ユーザー設定 ON 表示から開始
        app.elements = { audioOutputMode: toggle };
        // translatedAudioEl=null（Electron/WS 経路相当）。トグル同期は早期returnより前で行う。
        app.state = { audioOutputMode: 'translation', translatedAudioEl: null };
        app._ttsSuppressedByLoopback = false;
        return { app, toggle };
    }

    it('抑止中は設定ONでもトグルを OFF 表示＋suppressed＋理由ツールチップにする（ONなのに無音を出さない）', () => {
        const { VoiceTranslateApp: App } = loadProApp();
        const { app, toggle } = makeToggleApp(App);
        app._ttsSuppressedByLoopback = true;

        app.applyAudioOutputMode();

        expect(toggle.classList.contains('active')).toBe(false);
        expect(toggle.classList.contains('suppressed')).toBe(true);
        expect(toggle.title).not.toBe('');
    });

    it('抑止が解除されると設定に従い ON 表示へ自動復帰する（ユーザー設定値は不変）', () => {
        const { VoiceTranslateApp: App } = loadProApp();
        const { app, toggle } = makeToggleApp(App);
        app._ttsSuppressedByLoopback = true;
        app.applyAudioOutputMode();

        app._ttsSuppressedByLoopback = false;
        app.applyAudioOutputMode();

        expect(toggle.classList.contains('active')).toBe(true);
        expect(toggle.classList.contains('suppressed')).toBe(false);
        expect(toggle.title).toBe('');
        expect(app.state.audioOutputMode).toBe('translation');
    });

    it('設定 off のときは抑止でなくても OFF 表示（誠実）', () => {
        const { VoiceTranslateApp: App } = loadProApp();
        const { app, toggle } = makeToggleApp(App);
        app.state.audioOutputMode = 'off';

        app.applyAudioOutputMode();

        expect(toggle.classList.contains('active')).toBe(false);
        expect(toggle.classList.contains('suppressed')).toBe(false);
    });
});

describe('handleAudioOutputToggleClick（D1: クリックは state 起点・抑止中は据え置き）', () => {
    /** クリック処理テスト用の擬似 this（実 handleAudioOutputToggleClick + applyAudioOutputMode） */
    function makeClickApp(App) {
        const app = Object.create(App.prototype);
        app.elements = { audioOutputMode: document.createElement('button') };
        app.state = { audioOutputMode: 'translation', translatedAudioEl: null };
        app._ttsSuppressedByLoopback = false;
        app.saved = [];
        app.saveToStorage = (k, v) => app.saved.push([k, v]);
        app.notify = jest.fn();
        return app;
    }

    it('非抑止: translation→off→translation を state 起点でトグルし保存する（DOMクラス起点でない）', () => {
        const { VoiceTranslateApp: App } = loadProApp();
        const app = makeClickApp(App);

        app.handleAudioOutputToggleClick();
        expect(app.state.audioOutputMode).toBe('off');
        expect(app.saved).toContainEqual(['audio_output_mode', 'off']);

        app.handleAudioOutputToggleClick();
        expect(app.state.audioOutputMode).toBe('translation');
        expect(app.notify).not.toHaveBeenCalled();
    });

    it('抑止中: クリックしても設定を変えず保存もせず、理由だけ通知する（設定汚染の防止）', () => {
        const { VoiceTranslateApp: App } = loadProApp();
        const app = makeClickApp(App);
        app._ttsSuppressedByLoopback = true;
        app.state.audioOutputMode = 'off';

        app.handleAudioOutputToggleClick();

        expect(app.state.audioOutputMode).toBe('off'); // 据え置き
        expect(app.saved).toHaveLength(0); // 保存しない
        expect(app.notify).toHaveBeenCalled(); // 理由を通知
    });
});
