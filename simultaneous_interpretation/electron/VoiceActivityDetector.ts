/**
 * Voice Activity Detector (VAD) for Electron
 *
 * 目的:
 *   音声エネルギーを分析して、音声活動を検出する
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * VAD分析結果
 */
export interface VADResult {
    /** 音声エネルギー */
    energy: number;
    /** 音声検出フラグ */
    isSpeaking: boolean;
}

/**
 * VAD設定オプション
 */
export interface VADOptions {
    /** エネルギー閾値（デフォルト: 0.01） */
    threshold?: number;
    /** デバウンス時間（ミリ秒、デフォルト: 300） */
    debounceTime?: number;
    /** 音声開始コールバック */
    onSpeechStart?: () => void;
    /** 音声終了コールバック */
    onSpeechEnd?: () => void;
}

/**
 * Voice Activity Detector クラス
 *
 * 目的:
 *   音声エネルギーを分析して、音声活動を検出する
 */
export class VoiceActivityDetector {
    private threshold: number;
    private debounceTime: number;
    private onSpeechStart: () => void;
    private onSpeechEnd: () => void;

    private isSpeaking: boolean = false;
    private silenceTimer: NodeJS.Timeout | null = null;
    private energyHistory: number[] = [];
    private readonly historySize: number = 10;

    // キャリブレーション
    private calibrationSamples: number[] = [];
    private isCalibrating: boolean = true;
    private readonly calibrationDuration: number = 30;
    private noiseFloor: number = 0;
    private adaptiveThreshold: number;

    /**
     * コンストラクタ
     *
     * @param options - VAD設定オプション
     */
    constructor(options: VADOptions = {}) {
        this.threshold = options.threshold || 0.01;
        this.debounceTime = options.debounceTime || 300;
        this.onSpeechStart = options.onSpeechStart || (() => {});
        this.onSpeechEnd = options.onSpeechEnd || (() => {});
        this.adaptiveThreshold = this.threshold;
    }

    /**
     * 音声データを分析
     *
     * 目的:
     *   音声エネルギーを計算し、音声活動を検出する
     *
     * @param audioData - Float32Array音声データ
     * @returns VAD分析結果
     */
    public analyze(audioData: Float32Array): VADResult {
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
                this.silenceTimer = null;
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
     * 音声エネルギーを計算
     *
     * @param data - Float32Array音声データ
     * @returns エネルギー値
     */
    private calculateEnergy(data: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (value !== undefined) {
                sum += value * value;
            }
        }
        return Math.sqrt(sum / data.length);
    }

    /**
     * 平滑化されたエネルギーを取得
     *
     * @returns 平滑化エネルギー
     */
    private getSmoothedEnergy(): number {
        if (this.energyHistory.length === 0) {
            return 0;
        }
        const sum = this.energyHistory.reduce((acc, val) => acc + val, 0);
        return sum / this.energyHistory.length;
    }

    /**
     * キャリブレーションを完了
     *
     * 目的:
     *   ノイズフロアと適応閾値を計算する
     */
    private completeCalibration(): void {
        const mean =
            this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
        const variance =
            this.calibrationSamples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
            this.calibrationSamples.length;
        const stdDev = Math.sqrt(variance);

        this.noiseFloor = mean;
        this.adaptiveThreshold = mean + stdDev * 3;
        this.isCalibrating = false;

        console.info(
            `[VAD] Calibration complete - Noise: ${this.noiseFloor.toFixed(4)}, Threshold: ${this.adaptiveThreshold.toFixed(4)}`
        );
    }

    /**
     * VADをリセット
     *
     * 目的:
     *   状態をクリアして再キャリブレーションを開始
     */
    public reset(): void {
        this.isSpeaking = false;
        this.energyHistory = [];
        this.calibrationSamples = [];
        this.isCalibrating = true;
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    /**
     * 現在の閾値を取得
     *
     * @returns 適応閾値
     */
    public getThreshold(): number {
        return this.adaptiveThreshold;
    }

    /**
     * キャリブレーション状態を取得
     *
     * @returns キャリブレーション中かどうか
     */
    public isCalibrationInProgress(): boolean {
        return this.isCalibrating;
    }
}
