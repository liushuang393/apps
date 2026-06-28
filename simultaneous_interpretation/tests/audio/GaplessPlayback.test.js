/**
 * ギャップレス翻訳音声再生（D6）テスト。
 *
 * 対象: playAudioChunk / scheduleAudioChunk / pcm16ToAudioBuffer / handleAudioPlaybackEnded
 *       （WebSocketMixin、実体は voicetranslate-websocket-mixin.js）。
 *
 * 検証: PCM16チャンクが「直前チャンクの終了時刻」へ隙間なく予約されること
 *       （従来の onended 連鎖＋per-chunk decode による無音ギャップの解消）。
 *
 * 実コードを vm で読み込み、AudioContext をモックして start() の予約時刻を観測する。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SAMPLES_PER_CHUNK = 2400; // 24kHz で 0.1s 相当
const CHUNK_DURATION = SAMPLES_PER_CHUNK / 24000; // 0.1

function loadWebSocketMixin() {
    const source = fs.readFileSync(
        path.join(__dirname, '../../voicetranslate-websocket-mixin.js'),
        'utf8'
    );
    const sandbox = {
        console,
        Date,
        setTimeout,
        clearTimeout,
        CONFIG: { AUDIO: { SAMPLE_RATE: 24000 } },
        // base64 → PCM16(2400 sample) を返す（中身は問わない）
        Utils: { base64ToArrayBuffer: () => new Int16Array(SAMPLES_PER_CHUNK).buffer },
        WebSocket: { OPEN: 1 },
        module: { exports: {} }
    };
    vm.runInNewContext(`${source}\nmodule.exports = WebSocketMixin;`, sandbox);
    return sandbox.module.exports;
}

function createMockCtx() {
    const starts = [];
    const sources = [];
    const ctx = {
        currentTime: 0,
        destination: {},
        createGain() {
            return { gain: {}, connect() {}, disconnect() {} };
        },
        createBuffer(channels, length, rate) {
            return { length, duration: length / rate, copyToChannel() {} };
        },
        createBufferSource() {
            const s = {
                buffer: null,
                onended: null,
                connect() {},
                disconnect() {},
                start(t) {
                    starts.push(t);
                },
                stop() {}
            };
            sources.push(s);
            return s;
        }
    };
    return { ctx, starts, sources };
}

function createApp(ctx) {
    const app = {
        state: {
            outputAudioContext: ctx,
            outputVolume: 1,
            inputGainNode: null,
            isPlayingAudio: false
        },
        audioSourceTracker: {},
        notify() {}
    };
    Object.assign(app, loadWebSocketMixin());
    // mixin 適用の「後」に stub する（先に置くと Object.assign が上書きする）
    app.initializeOutputAudioContext = async () => {};
    return app;
}

describe('ギャップレス翻訳音声再生（D6）', () => {
    it('チャンクを隙間なく連結予約する（前チャンク終了時刻＝次チャンク開始時刻）', async () => {
        const { ctx, starts } = createMockCtx();
        const app = createApp(ctx);

        app.playAudioChunk('AAAA');
        app.playAudioChunk('BBBB');
        app.playAudioChunk('CCCC');
        await app._playbackChain;

        expect(starts).toHaveLength(3);
        expect(starts[0]).toBeCloseTo(0, 5);
        expect(starts[1]).toBeCloseTo(CHUNK_DURATION, 5); // 0.1 = ギャップなし
        expect(starts[2]).toBeCloseTo(CHUNK_DURATION * 2, 5); // 0.2
    });

    it('全チャンク再生終了で isPlayingAudio と連結カーソルが解除される', async () => {
        const { ctx, sources } = createMockCtx();
        const app = createApp(ctx);

        app.playAudioChunk('AAAA');
        await app._playbackChain;
        expect(app.state.isPlayingAudio).toBe(true);

        // サーバ再生終了（onended）を発火
        sources.forEach((s) => s.onended && s.onended());

        expect(app.state.isPlayingAudio).toBe(false);
        expect(app._nextPlaybackTime).toBe(0);
    });

    it('再生が現在時刻より前に取り残されたら現在時刻から予約し直す（無音連鎖防止）', async () => {
        const { ctx, starts } = createMockCtx();
        const app = createApp(ctx);

        app.playAudioChunk('AAAA');
        await app._playbackChain; // cursor = 0.1
        // 実時間が予約カーソルを追い越した状況をシミュレート
        ctx.currentTime = 5.0;
        app.playAudioChunk('BBBB');
        await app._playbackChain;

        expect(starts[1]).toBeCloseTo(5.0, 5); // 過去の 0.1 ではなく現在時刻 5.0
    });
});
