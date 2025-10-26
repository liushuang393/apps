/**
 * 音声検証の型定義
 *
 * @description
 * 音声データの有効性検証に関する型定義
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * 検証結果
 */
export interface ValidationResult {
    /** 検証が成功したか */
    valid: boolean;

    /** 失敗理由（validがfalseの場合） */
    reason?: string;

    /** オプション: 詳細情報 */
    details?: ValidationDetails;
}

/**
 * 検証詳細情報
 */
export interface ValidationDetails {
    /** サンプル数 */
    sampleCount: number;

    /** RMS（Root Mean Square）エネルギー */
    rmsEnergy: number;

    /** ゼロサンプル比率 (0.0 ~ 1.0) */
    zeroRatio: number;

    /** 最小エネルギー閾値 */
    minEnergyThreshold: number;

    /** 最大ゼロ比率閾値 */
    maxZeroRatio: number;
}

/**
 * 音声検証設定
 */
export interface AudioValidationConfig {
    /** 最小サンプル数 */
    minSampleCount: number;

    /** 最小RMSエネルギー */
    minRMSEnergy: number;

    /** 最大ゼロサンプル比率 (0.0 ~ 1.0) */
    maxZeroRatio: number;

    /** 詳細情報を含めるか */
    includeDetails: boolean;
}

/**
 * 音声品質メトリクス
 */
export interface AudioQualityMetrics {
    /** RMSエネルギー */
    rms: number;

    /** ピーク振幅 */
    peakAmplitude: number;

    /** ゼロクロッシングレート */
    zeroCrossingRate: number;

    /** SNR推定値 (dB) */
    estimatedSNR?: number;

    /** 音声らしさスコア (0.0 ~ 1.0) */
    speechLikelihood?: number;
}
