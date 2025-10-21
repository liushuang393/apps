/**
 * VAD (Voice Activity Detection) プロセッサー
 *
 * @description
 * 音声アクティビティ検出を行うプロセッサー
 * 音声と無音を区別し、音声部分のみを処理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { AudioProcessor, type AudioProcessingResult } from './AudioProcessor';
import type { AudioData } from '../interfaces/ICoreTypes';

/**
 * VAD 設定
 */
export interface VADConfig {
    /** 閾値 (0-1) */
    threshold: number;
    /** デバウンス時間 (ms) */
    debounce: number;
    /** 最小音声長さ (ms) */
    minSpeechMs: number;
    /** プレフィックスパディング (ms) */
    prefixPaddingMs: number;
    /** サフィックスパディング (ms) */
    suffixPaddingMs: number;
}

/**
 * VAD 結果
 */
export interface VADResult {
    /** 音声が検出されたか */
    isSpeaking: boolean;
    /** 信頼度スコア (0-1) */
    confidence: number;
    /** エネルギーレベル */
    energy: number;
    /** タイムスタンプ (ms) */
    timestamp: number;
}

/**
 * VAD プロセッサー
 */
export class VADProcessor extends AudioProcessor {
    readonly name = 'VADProcessor';
    private config: VADConfig;
    private isSpeaking = false;
    private speechStartTime = 0;
    private lastSpeechTime = 0;

    constructor(config?: Partial<VADConfig>) {
        super();
        this.config = {
            threshold: 0.01,
            debounce: 300,
            minSpeechMs: 100,
            prefixPaddingMs: 300,
            suffixPaddingMs: 300,
            ...config
        };
    }

    /**
     * 音声データを処理
     */
    async process(input: AudioData): Promise<AudioProcessingResult> {
        if (!this.enabled) {
            return await this.processNext(input);
        }

        try {
            // VAD 検出
            const vadResult = this.detectVoiceActivity(input);

            // 音声開始
            if (vadResult.isSpeaking && !this.isSpeaking) {
                this.onSpeechStart();
            }

            // 音声終了
            if (!vadResult.isSpeaking && this.isSpeaking) {
                const duration = Date.now() - this.speechStartTime;
                if (duration >= this.config.minSpeechMs) {
                    this.onSpeechEnd();
                }
            }

            // 音声中の場合のみ次のプロセッサーに渡す
            if (this.isSpeaking) {
                return await this.processNext(input);
            }

            // 無音の場合はスキップ
            return {
                audio: input,
                success: true,
                metadata: { skipped: true, reason: 'silence' }
            };

        } catch (error) {
            return this.createErrorResult(error as Error);
        }
    }

    /**
     * 音声アクティビティを検出
     */
    detectVoiceActivity(input: AudioData): VADResult {
        // RMS (Root Mean Square) を計算
        const rms = this.calculateRMS(input.samples);
        
        // 閾値と比較
        const isSpeaking = rms > this.config.threshold;
        
        // デバウンス処理
        const now = Date.now();
        if (isSpeaking) {
            this.lastSpeechTime = now;
        }
        
        const timeSinceLastSpeech = now - this.lastSpeechTime;
        const isDebounced = timeSinceLastSpeech < this.config.debounce;

        return {
            isSpeaking: isSpeaking || isDebounced,
            confidence: Math.min(rms / this.config.threshold, 1),
            energy: rms,
            timestamp: Date.now()
        };
    }

    /**
     * RMS を計算
     */
    private calculateRMS(samples: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i]! * samples[i]!;
        }
        return Math.sqrt(sum / samples.length);
    }

    /**
     * 音声開始時の処理
     */
    private onSpeechStart(): void {
        this.isSpeaking = true;
        this.speechStartTime = Date.now();
        console.log('[VAD] Speech started');
    }

    /**
     * 音声終了時の処理
     */
    private onSpeechEnd(): void {
        this.isSpeaking = false;
        const duration = Date.now() - this.speechStartTime;
        console.log(`[VAD] Speech ended (duration: ${duration}ms)`);
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<VADConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 設定を取得
     */
    getConfig(): VADConfig {
        return { ...this.config };
    }

    /**
     * プロセッサーを破棄
     */
    override async dispose(): Promise<void> {
        await super.dispose();
    }
}