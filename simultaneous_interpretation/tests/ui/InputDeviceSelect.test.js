/**
 * ヘッダ入力デバイス選択（inputDeviceSelect）のテスト。
 *
 * 対象:
 *   - populateInputDeviceSelect: enumerateDevices からの列挙、空label時のフォールバック表示、
 *     仮想カードのプレフィクス、ピン留めデバイス消失時の auto 復帰
 *   - startPinnedDeviceCapture: 仮想カード/マイクの分類と音声制約（EC/NS/AGC）の切替
 *
 * 実コード（root の voicetranslate-*.js）を vm で同一コンテキストに読み込み、
 * VoiceTranslateApp.prototype のメソッドを最小スタブ this で直接検証する。
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
        window: {},
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
        WebSocket: { OPEN: 1 },
        module: { exports: {} }
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;

    vm.runInNewContext(
        [
            read('voicetranslate-utils.js'),
            read('voicetranslate-ui-mixin.js'),
            read('voicetranslate-websocket-mixin.js'),
            read('voicetranslate-pro.js'),
            'module.exports = { VoiceTranslateApp };'
        ].join('\n'),
        sandbox
    );
    return { App: sandbox.module.exports.VoiceTranslateApp, sandbox };
}

const DEVICES = [
    { kind: 'audioinput', deviceId: 'mic1', label: 'ヘッドセット マイク (Realtek)' },
    { kind: 'audioinput', deviceId: 'vb1', label: 'CABLE Output (VB-Audio Virtual Cable)' },
    { kind: 'audioinput', deviceId: 'mic2', label: '' },
    { kind: 'videoinput', deviceId: 'cam1', label: 'Web Camera' }
];

describe('populateInputDeviceSelect', () => {
    it('audioinput を列挙し、仮想カードに🔌、空labelは「マイク N」で表示する', async () => {
        const { App, sandbox } = loadProApp();
        sandbox.navigator.mediaDevices = { enumerateDevices: async () => DEVICES };

        const select = document.createElement('select');
        const fake = {
            elements: { inputDeviceSelect: select },
            state: { preferredInputDeviceId: '' },
            saveToStorage() {}
        };
        await App.prototype.populateInputDeviceSelect.call(fake);

        const options = Array.from(select.querySelectorAll('option'));
        expect(options.map((o) => o.value)).toEqual(['auto', 'mic1', 'vb1', 'mic2']);
        expect(options[1].textContent).toBe('🎙️ ヘッドセット マイク (Realtek)');
        expect(options[2].textContent).toBe('🔌 CABLE Output (VB-Audio Virtual Cable)');
        expect(options[3].textContent).toBe('🎙️ マイク 3'); // 空label（権限未付与）のフォールバック
        expect(select.value).toBe('auto');
    });

    it('ピン留め中デバイスが一覧から消えたら auto へ戻し設定も更新する', async () => {
        const { App, sandbox } = loadProApp();
        sandbox.navigator.mediaDevices = { enumerateDevices: async () => DEVICES };

        const select = document.createElement('select');
        const saved = [];
        const fake = {
            elements: { inputDeviceSelect: select },
            state: { preferredInputDeviceId: 'unplugged-device' },
            saveToStorage(key, value) {
                saved.push([key, value]);
            }
        };
        await App.prototype.populateInputDeviceSelect.call(fake);

        expect(fake.state.preferredInputDeviceId).toBe('');
        expect(saved).toEqual([['preferred_input_device', '']]);
        expect(select.value).toBe('auto');
    });

    it('ピン留め中デバイスが存在すれば選択値を維持する', async () => {
        const { App, sandbox } = loadProApp();
        sandbox.navigator.mediaDevices = { enumerateDevices: async () => DEVICES };

        const select = document.createElement('select');
        const fake = {
            elements: { inputDeviceSelect: select },
            state: { preferredInputDeviceId: 'vb1' },
            saveToStorage() {
                throw new Error('維持時は保存しない');
            }
        };
        await App.prototype.populateInputDeviceSelect.call(fake);

        expect(select.value).toBe('vb1');
        expect(fake.state.preferredInputDeviceId).toBe('vb1');
    });
});

describe('startPinnedDeviceCapture', () => {
    function createCaptureHarness(App, sandbox) {
        const created = [];
        sandbox.AudioCaptureStrategyFactory = {
            createStrategy(options) {
                created.push(options);
                return { capture: async () => ({ getAudioTracks: () => [] }) };
            }
        };
        const stages = [];
        const fake = {
            state: { preferredInputDeviceId: '' },
            // 実インスタンスでは prototype にあるため、スタブ this にも実装を載せる
            lookupInputDeviceLabel: App.prototype.lookupInputDeviceLabel,
            setCaptureFallbackStage(stage) {
                stages.push(stage);
            },
            notify() {}
        };
        return { created, stages, fake };
    }

    it('仮想カードは原声分離扱い（EC/NS/AGC無効）で stage=virtual-card', async () => {
        const { App, sandbox } = loadProApp();
        sandbox.navigator.mediaDevices = { enumerateDevices: async () => DEVICES };
        const { created, stages, fake } = createCaptureHarness(App, sandbox);

        await App.prototype.startPinnedDeviceCapture.call(fake, 'vb1');

        expect(created).toHaveLength(1);
        expect(created[0].deviceId).toBe('vb1');
        expect(created[0].config.echoCancellation).toBe(false);
        expect(created[0].config.noiseSuppression).toBe(false);
        expect(created[0].config.autoGainControl).toBe(false);
        expect(stages).toEqual(['virtual-card']);
    });

    it('マイクはAEC有効・sampleRate非固定で stage=microphone', async () => {
        const { App, sandbox } = loadProApp();
        sandbox.navigator.mediaDevices = { enumerateDevices: async () => DEVICES };
        const { created, stages, fake } = createCaptureHarness(App, sandbox);

        await App.prototype.startPinnedDeviceCapture.call(fake, 'mic1');

        expect(created[0].deviceId).toBe('mic1');
        expect(created[0].config.echoCancellation).toBe(true);
        // ネイティブレート採集でAECを効かせるため sampleRate は固定しない
        expect(created[0].config.sampleRate).toBeUndefined();
        expect(stages).toEqual(['microphone']);
    });
});
