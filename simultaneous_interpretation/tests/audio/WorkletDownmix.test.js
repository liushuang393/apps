/**
 * AudioWorklet プロセッサのステレオダウンミックステスト（D8回帰）。
 *
 * 対象:
 *   audio-processor-worklet.js がステレオ入力を全チャンネル平均でモノラル化すること
 *   （旧: チャンネル0のみ使用 → 右ch優勢の監視音声を喪失＝漏識別）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadWorklet() {
    const file = path.join(__dirname, '../../audio-processor-worklet.js');
    const code = fs.readFileSync(file, 'utf8');

    let RegisteredClass = null;
    const sandbox = {
        console,
        Float32Array,
        /** AudioWorklet 環境のスタブ */
        AudioWorkletProcessor: class {
            constructor() {
                this.port = { postMessage: jest.fn(), onmessage: null };
            }
        },
        registerProcessor: (_name, cls) => {
            RegisteredClass = cls;
        }
    };
    sandbox.globalThis = sandbox;

    vm.runInNewContext(code, sandbox);
    return RegisteredClass;
}

describe('AudioProcessorWorklet（D8: ステレオダウンミックス）', () => {
    it('ステレオ入力（無音L＋有音R）を平均して非ゼロの音声を送出する', () => {
        const Worklet = loadWorklet();
        const p = new Worklet();

        const silentLeft = new Float32Array(128); // 全て0
        const loudRight = new Float32Array(128).fill(0.5);

        expect(p.process([[silentLeft, loudRight]], null, null)).toBe(true);

        expect(p.port.postMessage).toHaveBeenCalledTimes(1);
        const { type, data } = p.port.postMessage.mock.calls[0][0];
        expect(type).toBe('audiodata');
        // (0 + 0.5) / 2 = 0.25 の平均値が全サンプルに載る
        expect(data[0]).toBeCloseTo(0.25, 5);
        expect(data[127]).toBeCloseTo(0.25, 5);
    });

    it('モノラル入力はそのまま送出する', () => {
        const Worklet = loadWorklet();
        const p = new Worklet();

        const mono = new Float32Array(128).fill(0.3);
        p.process([[mono]], null, null);

        const { data } = p.port.postMessage.mock.calls[0][0];
        expect(data[0]).toBeCloseTo(0.3, 5);
    });

    it('stop メッセージ受信後は処理を終了する', () => {
        const Worklet = loadWorklet();
        const p = new Worklet();
        p.port.onmessage({ data: { type: 'stop' } });
        expect(p.process([[new Float32Array(128)]], null, null)).toBe(false);
    });
});
