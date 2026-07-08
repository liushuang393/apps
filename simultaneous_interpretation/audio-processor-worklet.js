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
            let channelData = input[0]; // モノラルはそのまま使用

            // ステレオ以上は全チャンネル平均でモノラル化する。
            // チャンネル0のみだと、右ch優勢の監視音源（一部の会議/ループバック構成）で
            // 音声を取りこぼし認識漏れになる。
            if (input.length > 1 && channelData) {
                const mixed = new Float32Array(channelData.length);
                for (let c = 0; c < input.length; c++) {
                    const channel = input[c];
                    for (let i = 0; i < channel.length; i++) {
                        mixed[i] += channel[i];
                    }
                }
                for (let i = 0; i < mixed.length; i++) {
                    mixed[i] /= input.length;
                }
                channelData = mixed;
            }

            if (channelData && channelData.length > 0) {
                // メインスレッドに音声データを送信
                // Float32Array をそのまま送信（転送可能オブジェクト）
                this.port.postMessage({
                    type: 'audiodata',
                    data: channelData
                });
            }
        }

        // true を返すと処理を継続
        return true;
    }
}

// AudioWorkletProcessor として登録
registerProcessor('audio-processor-worklet', AudioProcessorWorklet);
