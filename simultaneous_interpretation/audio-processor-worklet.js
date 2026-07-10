/**
 * AudioWorklet プロセッサ
 *
 * 目的:
 *   ScriptProcessorNode の代替として、音声データをリアルタイム処理
 *
 * 注意:
 *   - このファイルは AudioWorklet スレッドで実行される
 *   - メインスレッドとは分離された環境で動作
 *   - console.log は使用可能だが、DOM API は使用不可
 */

class AudioProcessorWorklet extends AudioWorkletProcessor {
    /**
     * コンストラクタ
     *
     * 目的:
     *   AudioWorklet プロセッサを初期化
     */
    constructor() {
        super();

        // メインスレッドからのメッセージを受信
        this.port.onmessage = (event) => {
            if (event.data.type === 'stop') {
                // 処理停止フラグ
                this.shouldStop = true;
            }
        };

        this.shouldStop = false;
        this.sourceRate = typeof sampleRate === 'number' ? sampleRate : 48000;
        this.targetRate = 24000;
        this.step = this.sourceRate / this.targetRate;
        this.pendingInput = [];
        this.readPosition = 0;
        this.outputBuffer = new Float32Array(480);
        this.outputIndex = 0;
        this.totalOutputSamples = 0;
    }

    appendAndResample(input) {
        for (let i = 0; i < input.length; i++) {
            this.pendingInput.push(input[i]);
        }

        while (this.readPosition + 1 < this.pendingInput.length) {
            const index = Math.floor(this.readPosition);
            const fraction = this.readPosition - index;
            const value =
                this.pendingInput[index] +
                (this.pendingInput[index + 1] - this.pendingInput[index]) * fraction;
            this.outputBuffer[this.outputIndex++] = value;
            this.totalOutputSamples++;
            this.readPosition += this.step;

            if (this.outputIndex === this.outputBuffer.length) {
                const ownedBuffer = this.outputBuffer;
                this.port.postMessage(
                    {
                        type: 'audiodata',
                        data: ownedBuffer,
                        sampleRate: this.targetRate
                    },
                    [ownedBuffer.buffer]
                );
                this.outputBuffer = new Float32Array(480);
                this.outputIndex = 0;
            }
        }

        const consumed = Math.min(
            Math.floor(this.readPosition),
            Math.max(0, this.pendingInput.length - 1)
        );
        if (consumed > 0) {
            this.pendingInput.splice(0, consumed);
            this.readPosition -= consumed;
        }
    }

    /**
     * 音声データを処理
     *
     * 目的:
     *   入力音声データをメインスレッドに送信
     *
     * @param {Float32Array[][]} inputs - 入力音声データ
     * @param {Float32Array[][]} outputs - 出力音声データ（未使用）
     * @param {Object} parameters - パラメータ（未使用）
     * @returns {boolean} - true: 処理継続, false: 処理停止
     *
     * 注意:
     *   - この関数は128サンプルごとに呼び出される
     *   - 48kHzの場合、約2.67ms間隔で呼び出される
     */
    process(inputs, _outputs, _parameters) {
        // 停止フラグがセットされている場合は処理を終了
        if (this.shouldStop) {
            return false;
        }

        const input = inputs[0];

        // 入力データが存在する場合
        if (input && input.length > 0) {
            const frames = input[0]?.length || 0;
            if (frames > 0) {
                // AudioWorklet が所有する mono buffer に全 channel を平均する。
                const mono = new Float32Array(frames);
                for (let channelIndex = 0; channelIndex < input.length; channelIndex++) {
                    const channel = input[channelIndex];
                    for (let frame = 0; frame < frames; frame++) {
                        mono[frame] += channel[frame] / input.length;
                    }
                }
                this.appendAndResample(mono);
            }
        }

        // true を返すと処理を継続
        return true;
    }
}

// AudioWorkletProcessor として登録
registerProcessor('audio-processor-worklet', AudioProcessorWorklet);
