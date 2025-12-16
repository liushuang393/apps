/**
 * 音声データ検証
 *
 * @description
 * 音声データの有効性を検証し、無音・無効なデータの送信を防ぐ
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import type {
    ValidationResult,
    ValidationDetails,
    AudioValidationConfig,
    AudioQualityMetrics
} from '../types/Validation';

export class AudioValidator {
    private config: AudioValidationConfig;

    /**
     * コンストラクタ
     *
     * @param config 検証設定（オプション）
     */
    constructor(config?: Partial<AudioValidationConfig>) {
        this.config = {
            minSampleCount: 4800, // 200ms @ 24kHz
            minRMSEnergy: 0.001, // 非常に小さい閾値
            maxZeroRatio: 0.95, // 95%以上がゼロの場合は無効
            includeDetails: false,
            ...config
        };
    }

    /**
     * 音声データを検証
     *
     * @param audioData 音声データ（Float32Array）
     * @returns 検証結果
     */
    validate(audioData: Float32Array): ValidationResult {
        // 1. 長さチェック
        if (audioData.length < this.config.minSampleCount) {
            return {
                valid: false,
                reason: `音声データが短すぎます（${audioData.length} < ${this.config.minSampleCount} samples）`,
                ...(this.config.includeDetails ? { details: this.createDetails(audioData) } : {})
            };
        }

        // 2. エネルギーチェック（RMS）
        const rms = this.calculateRMS(audioData);
        if (rms < this.config.minRMSEnergy) {
            return {
                valid: false,
                reason: `RMSエネルギーが低すぎます（${rms.toFixed(6)} < ${this.config.minRMSEnergy}）`,
                ...(this.config.includeDetails
                    ? { details: this.createDetails(audioData, rms) }
                    : {})
            };
        }

        // 3. ゼロサンプル比率チェック
        const zeroRatio = this.calculateZeroRatio(audioData);
        if (zeroRatio > this.config.maxZeroRatio) {
            return {
                valid: false,
                reason: `ゼロサンプル比率が高すぎます（${(zeroRatio * 100).toFixed(1)}% > ${this.config.maxZeroRatio * 100}%）`,
                ...(this.config.includeDetails
                    ? { details: this.createDetails(audioData, rms, zeroRatio) }
                    : {})
            };
        }

        // すべてのチェックに合格
        return {
            valid: true,
            ...(this.config.includeDetails
                ? { details: this.createDetails(audioData, rms, zeroRatio) }
                : {})
        };
    }

    /**
     * RMS（Root Mean Square）を計算
     *
     * @param data 音声データ
     * @returns RMS値
     */
    calculateRMS(data: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const sample = data[i]!;
            sum += sample * sample;
        }
        return Math.sqrt(sum / data.length);
    }

    /**
     * ゼロサンプル比率を計算
     *
     * @param data 音声データ
     * @param threshold ゼロと判定する閾値（デフォルト: 0.001）
     * @returns ゼロサンプル比率（0.0 ~ 1.0）
     */
    calculateZeroRatio(data: Float32Array, threshold: number = 0.001): number {
        let zeroCount = 0;
        for (let i = 0; i < data.length; i++) {
            if (Math.abs(data[i]!) < threshold) {
                zeroCount++;
            }
        }
        return zeroCount / data.length;
    }

    /**
     * 音声品質メトリクスを計算
     *
     * @param data 音声データ
     * @returns 品質メトリクス
     */
    calculateQualityMetrics(data: Float32Array): AudioQualityMetrics {
        const rms = this.calculateRMS(data);
        const peakAmplitude = this.calculatePeakAmplitude(data);
        const zeroCrossingRate = this.calculateZeroCrossingRate(data);

        // SNR推定（簡易）
        const estimatedSNR = rms > 0 ? 20 * Math.log10(peakAmplitude / rms) : 0;

        // 音声らしさスコア（簡易: RMSとZCRから推定）
        const speechLikelihood = this.estimateSpeechLikelihood(rms, zeroCrossingRate);

        return {
            rms,
            peakAmplitude,
            zeroCrossingRate,
            estimatedSNR,
            speechLikelihood
        };
    }

    /**
     * 設定を更新
     *
     * @param config 新しい設定
     */
    updateConfig(config: Partial<AudioValidationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 現在の設定を取得
     *
     * @returns 設定のコピー
     */
    getConfig(): AudioValidationConfig {
        return { ...this.config };
    }

    /**
     * 詳細情報を作成
     */
    private createDetails(data: Float32Array, rms?: number, zeroRatio?: number): ValidationDetails {
        return {
            sampleCount: data.length,
            rmsEnergy: rms ?? this.calculateRMS(data),
            zeroRatio: zeroRatio ?? this.calculateZeroRatio(data),
            minEnergyThreshold: this.config.minRMSEnergy,
            maxZeroRatio: this.config.maxZeroRatio
        };
    }

    /**
     * ピーク振幅を計算
     */
    private calculatePeakAmplitude(data: Float32Array): number {
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            peak = Math.max(peak, Math.abs(data[i]!));
        }
        return peak;
    }

    /**
     * ゼロクロッシングレートを計算
     */
    private calculateZeroCrossingRate(data: Float32Array): number {
        let crossings = 0;
        for (let i = 1; i < data.length; i++) {
            if ((data[i - 1]! >= 0 && data[i]! < 0) || (data[i - 1]! < 0 && data[i]! >= 0)) {
                crossings++;
            }
        }
        return crossings / (data.length - 1);
    }

    /**
     * 音声らしさを推定（簡易）
     */
    private estimateSpeechLikelihood(rms: number, zcr: number): number {
        // 簡易的な推定: RMSが高く、ZCRが適度な範囲にある場合に高スコア
        const rmsScore = Math.min(rms / 0.1, 1.0); // 0.1を最大とする
        const zcrScore = zcr > 0.05 && zcr < 0.3 ? 1.0 : 0.5; // 適度な範囲

        return (rmsScore + zcrScore) / 2;
    }
}
