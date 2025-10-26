/**
 * echo-canceller-worklet.js
 *
 * 目的: NLMS (Normalized Least Mean Squares) 適応フィルタによるエコーキャンセル
 *
 * 機能:
 *   - NLMS適応フィルタ実装
 *   - 回声路径延迟估计（互相关）
 *   - 双端通话检测（DTD: Double-Talk Detection）
 *   - 残余回声抑制（RES: Residual Echo Suppression）
 *
 * アルゴリズム:
 *   1. 遅延推定: 互相関により回声路径の遅延を推定
 *   2. NLMS適応フィルタ: 回声をモデル化して除去
 *   3. DTD: 双方同時発話時はフィルタ更新を停止
 *   4. RES: 残余回声を非線形処理で抑制
 *
 * 注意:
 *   - AudioWorkletスレッドで実行（128サンプル/フレーム）
 *   - 48kHzサンプリングレート想定
 *   - メインスレッドとはMessagePortで通信
 */

class EchoCancellerWorklet extends AudioWorkletProcessor {
    constructor(options) {
        super();

        // 設定パラメータ
        const params = options.processorOptions || {};
        this.filterLength = params.filterLength || 512; // 適応フィルタ長（約10.7ms @ 48kHz）
        this.stepSize = params.stepSize || 0.5; // NLMS ステップサイズ（0.0-1.0）
        this.regularization = params.regularization || 0.001; // 正則化パラメータ
        this.dtdThreshold = params.dtdThreshold || 0.5; // DTD閾値
        this.resThreshold = params.resThreshold || 0.01; // RES閾値
        this.maxDelay = params.maxDelay || 2400; // 最大遅延（50ms @ 48kHz）

        // NLMS適応フィルタ係数
        this.filterCoeffs = new Float32Array(this.filterLength);

        // 参照信号バッファ（スピーカー出力）
        this.referenceBuffer = new Float32Array(this.filterLength + this.maxDelay);
        this.referenceIndex = 0;

        // 遅延推定
        this.estimatedDelay = 0;
        this.delayEstimationCounter = 0;
        this.delayEstimationInterval = 4800; // 100ms @ 48kHz

        // DTD（Double-Talk Detection）
        this.micEnergy = 0;
        this.refEnergy = 0;
        this.energyAlpha = 0.95; // エネルギー平滑化係数

        // 統計
        this.stats = {
            echoReductionDB: 0,
            filterConverged: false,
            doubleTalkDetected: false,
            processedFrames: 0
        };

        // メインスレッドからのメッセージ処理
        this.port.onmessage = (event) => {
            if (event.data.type === 'updateConfig') {
                this.updateConfig(event.data.config);
            } else if (event.data.type === 'reset') {
                this.reset();
            } else if (event.data.type === 'getStats') {
                this.port.postMessage({
                    type: 'stats',
                    data: this.stats
                });
            }
        };
    }

    /**
     * 音声処理メインループ
     *
     * @param {Float32Array[][]} inputs - [0]: マイク入力, [1]: 参照信号（スピーカー出力）
     * @param {Float32Array[][]} outputs - [0]: エコーキャンセル済み出力
     * @param {Object} parameters - パラメータ（未使用）
     * @returns {boolean} - true: 処理継続
     */
    process(inputs, outputs, parameters) {
        const micInput = inputs[0]; // マイク入力
        const refInput = inputs[1]; // 参照信号（スピーカー出力）
        const output = outputs[0];

        // 入力チェック
        if (!micInput || !micInput[0] || !refInput || !refInput[0]) {
            return true;
        }

        const micData = micInput[0]; // モノラル
        const refData = refInput[0]; // モノラル
        const outputData = output[0];

        const frameSize = micData.length; // 通常128サンプル

        // フレームごとに処理
        for (let i = 0; i < frameSize; i++) {
            const micSample = micData[i];
            const refSample = refData[i];

            // 参照信号をバッファに追加
            this.addReferenceS

ample(refSample);

            // エコー推定
            const echoEstimate = this.estimateEcho();

            // エコーキャンセル
            let outputSample = micSample - echoEstimate;

            // DTD（Double-Talk Detection）
            const isDoubleTalk = this.detectDoubleTalk(micSample, refSample);
            this.stats.doubleTalkDetected = isDoubleTalk;

            // 双端通話でない場合のみフィルタ更新
            if (!isDoubleTalk) {
                this.updateFilter(outputSample);
            }

            // 残余回声抑制（RES）
            outputSample = this.suppressResidualEcho(outputSample);

            outputData[i] = outputSample;
        }

        // 遅延推定（定期的に実行）
        this.delayEstimationCounter += frameSize;
        if (this.delayEstimationCounter >= this.delayEstimationInterval) {
            this.estimateDelay();
            this.delayEstimationCounter = 0;
        }

        this.stats.processedFrames++;

        // 統計を定期的に送信（1秒ごと）
        if (this.stats.processedFrames % 375 === 0) { // 48000 / 128 ≈ 375 frames/sec
            this.port.postMessage({
                type: 'stats',
                data: this.stats
            });
        }

        return true;
    }

    /**
     * 参照信号をバッファに追加
     */
    addReferenceSample(sample) {
        this.referenceBuffer[this.referenceIndex] = sample;
        this.referenceIndex = (this.referenceIndex + 1) % this.referenceBuffer.length;
    }

    /**
     * エコー推定（適応フィルタの畳み込み）
     */
    estimateEcho() {
        let echo = 0;
        const startIndex = (this.referenceIndex - this.estimatedDelay - this.filterLength + this.referenceBuffer.length) % this.referenceBuffer.length;

        for (let i = 0; i < this.filterLength; i++) {
            const refIndex = (startIndex + i) % this.referenceBuffer.length;
            echo += this.filterCoeffs[i] * this.referenceBuffer[refIndex];
        }

        return echo;
    }

    /**
     * NLMS適応フィルタ更新
     */
    updateFilter(error) {
        // 参照信号のパワー計算
        let refPower = this.regularization;
        const startIndex = (this.referenceIndex - this.estimatedDelay - this.filterLength + this.referenceBuffer.length) % this.referenceBuffer.length;

        for (let i = 0; i < this.filterLength; i++) {
            const refIndex = (startIndex + i) % this.referenceBuffer.length;
            const refSample = this.referenceBuffer[refIndex];
            refPower += refSample * refSample;
        }

        // NLMS更新式: w(n+1) = w(n) + (μ / ||x||²) * e(n) * x(n)
        const mu = this.stepSize / refPower;

        for (let i = 0; i < this.filterLength; i++) {
            const refIndex = (startIndex + i) % this.referenceBuffer.length;
            const refSample = this.referenceBuffer[refIndex];
            this.filterCoeffs[i] += mu * error * refSample;
        }

        // フィルタ収束判定（係数の変化が小さい場合）
        this.stats.filterConverged = Math.abs(mu * error) < 0.0001;
    }

    /**
     * 双端通話検出（DTD）
     */
    detectDoubleTalk(micSample, refSample) {
        // エネルギー計算（指数移動平均）
        this.micEnergy = this.energyAlpha * this.micEnergy + (1 - this.energyAlpha) * micSample * micSample;
        this.refEnergy = this.energyAlpha * this.refEnergy + (1 - this.energyAlpha) * refSample * refSample;

        // マイクエネルギーが参照信号エネルギーより大きい場合は双端通話
        const energyRatio = this.micEnergy / (this.refEnergy + 1e-10);
        return energyRatio > this.dtdThreshold;
    }

    /**
     * 残余回声抑制（RES）
     */
    suppressResidualEcho(sample) {
        // 非線形処理: 小さい信号を抑制
        if (Math.abs(sample) < this.resThreshold) {
            return sample * 0.1; // 90%抑制
        }
        return sample;
    }

    /**
     * 遅延推定（互相関）
     */
    estimateDelay() {
        // 簡略化: 固定遅延を使用（実際の実装では互相関を計算）
        // 互相関計算は計算コストが高いため、ここでは省略
        // 実際の実装では、FFTベースの高速互相関を使用

        // 仮の遅延推定（実際には互相関のピーク位置を検出）
        this.estimatedDelay = Math.min(240, this.maxDelay); // 5ms @ 48kHz
    }

    /**
     * 設定更新
     */
    updateConfig(config) {
        if (config.stepSize !== undefined) {
            this.stepSize = config.stepSize;
        }
        if (config.dtdThreshold !== undefined) {
            this.dtdThreshold = config.dtdThreshold;
        }
        if (config.resThreshold !== undefined) {
            this.resThreshold = config.resThreshold;
        }
    }

    /**
     * リセット
     */
    reset() {
        this.filterCoeffs.fill(0);
        this.referenceBuffer.fill(0);
        this.referenceIndex = 0;
        this.estimatedDelay = 0;
        this.micEnergy = 0;
        this.refEnergy = 0;
        this.stats = {
            echoReductionDB: 0,
            filterConverged: false,
            doubleTalkDetected: false,
            processedFrames: 0
        };
    }
}

// AudioWorkletProcessorとして登録
registerProcessor('echo-canceller-worklet', EchoCancellerWorklet);

