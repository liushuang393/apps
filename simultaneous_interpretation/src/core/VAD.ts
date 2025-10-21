/**
 * VoiceTranslate Pro - Voice Activity Detector (VAD)
 *
 * 目的: 音声の開始と終了を検出し、音声区間を識別する
 *
 * 機能:
 * - エネルギーベースの音声検出
 * - 適応的閾値調整（キャリブレーション）
 * - ノイズフロア推定
 * - デバウンス処理（誤検出防止）
 *
 * 注意点:
 * - 初期化後、約30サンプルでキャリブレーションを実施
 * - 環境ノイズに応じて閾値を自動調整
 */

/**
 * VAD設定オプション
 */
export interface VADOptions {
    /** 音声検出閾値 (0.0-1.0) */
    threshold?: number;
    /** デバウンス時間 (ミリ秒) */
    debounceTime?: number;
    /** 音声開始時のコールバック */
    onSpeechStart?: () => void;
    /** 音声終了時のコールバック */
    onSpeechEnd?: () => void;
}

/**
 * VAD分析結果
 */
export interface VADAnalysisResult {
    /** 現在のエネルギーレベル */
    energy: number;
    /** 音声検出中かどうか */
    isSpeaking: boolean;
}

/**
 * Voice Activity Detector クラス
 *
 * エネルギーベースの音声検出を行い、音声の開始と終了を検出します。
 * 環境ノイズに応じて自動的に閾値を調整します。
 */
export class VoiceActivityDetector {
    /** 音声検出閾値 */
    private threshold: number;
    /** デバウンス時間 (ミリ秒) */
    private debounceTime: number;
    /** 音声開始時のコールバック */
    private onSpeechStart: () => void;
    /** 音声終了時のコールバック */
    private onSpeechEnd: () => void;

    /** 現在音声検出中かどうか */
    private isSpeaking: boolean;
    /** 無音タイマー */
    private silenceTimer: NodeJS.Timeout | null;
    /** エネルギー履歴 */
    private energyHistory: number[];
    /** エネルギー履歴のサイズ */
    private readonly historySize: number;
    /** キャリブレーションサンプル */
    private calibrationSamples: number[];
    /** キャリブレーション中かどうか */
    private isCalibrating: boolean;
    /** キャリブレーション期間（サンプル数） */
    private readonly calibrationDuration: number;
    /** ノイズフロア */
    private noiseFloor: number;
    /** 適応的閾値 */
    private adaptiveThreshold: number;

    /**
     * VoiceActivityDetector のコンストラクタ
     *
     * @param options - VAD設定オプション
     */
    constructor(options: VADOptions = {}) {
        this.threshold = options.threshold || 0.01;
        this.debounceTime = options.debounceTime || 300;
        this.onSpeechStart = options.onSpeechStart || (() => {});
        this.onSpeechEnd = options.onSpeechEnd || (() => {});

        this.isSpeaking = false;
        this.silenceTimer = null;
        this.energyHistory = [];
        this.historySize = 10;
        this.calibrationSamples = [];
        this.isCalibrating = true;
        this.calibrationDuration = 30;
        this.noiseFloor = 0;
        this.adaptiveThreshold = this.threshold;
    }

    /**
     * 音声データを分析し、音声検出を行う
     *
     * @param audioData - 分析する音声データ (Float32Array)
     * @returns VAD分析結果
     */
    analyze(audioData: Float32Array): VADAnalysisResult {
        const energy = this.calculateEnergy(audioData);

        // キャリブレーション中
        if (this.isCalibrating) {
            this.calibrationSamples.push(energy);
            if (this.calibrationSamples.length >= this.calibrationDuration) {
                this.completeCalibration();
            }
            return { energy, isSpeaking: false };
        }

        // エネルギー履歴を更新
        this.energyHistory.push(energy);
        if (this.energyHistory.length > this.historySize) {
            this.energyHistory.shift();
        }

        const smoothedEnergy = this.getSmoothedEnergy();

        // 音声検出ロジック
        if (smoothedEnergy > this.adaptiveThreshold) {
            if (!this.isSpeaking) {
                this.isSpeaking = true;
                this.onSpeechStart();
            }
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
            }
        } else if (this.isSpeaking) {
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
            }
            this.silenceTimer = setTimeout(() => {
                this.isSpeaking = false;
                this.onSpeechEnd();
            }, this.debounceTime);
        }

        return { energy: smoothedEnergy, isSpeaking: this.isSpeaking };
    }

    /**
     * 音声データのエネルギーを計算
     *
     * @param data - 音声データ
     * @returns エネルギーレベル (RMS)
     */
    private calculateEnergy(data: Float32Array): number {
        const sum = data.reduce((acc, val) => acc + val * val, 0);
        return Math.sqrt(sum / data.length);
    }

    /**
     * 平滑化されたエネルギーを取得
     *
     * @returns 平滑化されたエネルギーレベル
     */
    private getSmoothedEnergy(): number {
        if (this.energyHistory.length === 0) {
            return 0;
        }
        const sum = this.energyHistory.reduce((acc, val) => acc + val, 0);
        return sum / this.energyHistory.length;
    }

    /**
     * キャリブレーションを完了し、適応的閾値を設定
     */
    private completeCalibration(): void {
        const mean =
            this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
        const variance =
            this.calibrationSamples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
            this.calibrationSamples.length;
        const stdDev = Math.sqrt(variance);

        this.noiseFloor = mean;

        // 適応閾値を計算（最小値を設定）
        const calculatedThreshold = mean + stdDev * 3;
        const minThreshold = 0.01; // 最小閾値（環境が静かすぎる場合の対策）
        this.adaptiveThreshold = Math.max(calculatedThreshold, minThreshold);

        this.isCalibrating = false;

        console.info(
            `[VAD] Calibration complete - Noise: ${this.noiseFloor.toFixed(4)}, Calculated: ${calculatedThreshold.toFixed(4)}, Final Threshold: ${this.adaptiveThreshold.toFixed(4)}`
        );
    }

    /**
     * VADをリセット
     */
    reset(): void {
        this.isSpeaking = false;
        this.energyHistory = [];
        this.calibrationSamples = [];
        this.isCalibrating = true;
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }
    }

    /**
     * 現在の音声検出状態を取得
     *
     * @returns 音声検出中かどうか
     */
    getIsSpeaking(): boolean {
        return this.isSpeaking;
    }

    /**
     * 現在の適応的閾値を取得
     *
     * @returns 適応的閾値
     */
    getAdaptiveThreshold(): number {
        return this.adaptiveThreshold;
    }

    /**
     * ノイズフロアを取得
     *
     * @returns ノイズフロア
     */
    getNoiseFloor(): number {
        return this.noiseFloor;
    }

    /**
     * キャリブレーション中かどうかを取得
     *
     * @returns キャリブレーション中かどうか
     */
    getIsCalibrating(): boolean {
        return this.isCalibrating;
    }
}
