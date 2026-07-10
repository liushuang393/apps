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

function loadWorklet(sourceRate = 48000) {
    const file = path.join(__dirname, '../../audio-processor-worklet.js');
    const code = fs.readFileSync(file, 'utf8');

    let RegisteredClass = null;
    const sandbox = {
        console,
        Float32Array,
        sampleRate: sourceRate,
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

        for (let i = 0; i < 8; i++) {
            expect(p.process([[silentLeft, loudRight]], null, null)).toBe(true);
        }

        expect(p.port.postMessage).toHaveBeenCalledTimes(1);
        const [{ type, data, sampleRate }, transferList] = p.port.postMessage.mock.calls[0];
        expect(type).toBe('audiodata');
        expect(sampleRate).toBe(24000);
        expect(data).toHaveLength(480);
        expect(transferList).toEqual([data.buffer]);
        // (0 + 0.5) / 2 = 0.25 の平均値が全サンプルに載る
        expect(data[0]).toBeCloseTo(0.25, 5);
        expect(data[479]).toBeCloseTo(0.25, 5);
    });

    it('モノラル入力はそのまま送出する', () => {
        const Worklet = loadWorklet();
        const p = new Worklet();

        const mono = new Float32Array(128).fill(0.3);
        for (let i = 0; i < 8; i++) {
            p.process([[mono]], null, null);
        }

        const { data } = p.port.postMessage.mock.calls[0][0];
        expect(data[0]).toBeCloseTo(0.3, 5);
    });

    it('stop メッセージ受信後は処理を終了する', () => {
        const Worklet = loadWorklet();
        const p = new Worklet();
        p.port.onmessage({ data: { type: 'stop' } });
        expect(p.process([[new Float32Array(128)]], null, null)).toBe(false);
    });

    it.each([44100, 48000])(
        '%iHz の連続入力で位相を保持し、出力数誤差が0.01%%未満',
        (sourceRate) => {
            const Worklet = loadWorklet(sourceRate);
            const p = new Worklet();
            let remaining = sourceRate * 2;
            while (remaining > 0) {
                const frames = Math.min(128, remaining);
                p.process([[new Float32Array(frames).fill(0.2)]], null, null);
                remaining -= frames;
            }

            const expected = 24000 * 2;
            const actual = p.totalOutputSamples;
            expect(Math.abs(actual - expected) / expected).toBeLessThan(0.0001);
            expect(p.port.postMessage.mock.calls.length / 2).toBeLessThanOrEqual(60);
            expect(p.pendingInput.length).toBeLessThanOrEqual(2);
        }
    );
});
