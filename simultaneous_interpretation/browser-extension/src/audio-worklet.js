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
 *   - TypeScript ではなく JavaScript として保持（AudioWorklet 環境の特殊性のため）
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

        this.shouldStop = false;

        // メインスレッドからのメッセージを受信
        this.port.onmessage = (event) => {
            if (event.data.type === 'stop') {
                // 処理停止フラグ
                this.shouldStop = true;
            }
        };
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
     * @returns {boolean} true: 処理継続, false: 処理停止
     *
     * 注意:
     *   - この関数は128サンプルごとに呼び出される
     *   - 48kHzの場合、約2.67ms間隔で呼び出される
     */
    process(inputs, outputs, parameters) {
        // 停止フラグがセットされている場合は処理を終了
        if (this.shouldStop) {
            return false;
        }

        const input = inputs[0];

        // 入力データが存在する場合
        if (input && input.length > 0) {
            const channelData = input[0]; // モノラル（チャンネル0）

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

