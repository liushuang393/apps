/**
 * リサンプラープロセッサー
 *
 * @description
 * 音声データのサンプリングレートを変換
 * 線形補間を使用した高品質リサンプリング
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { AudioProcessor } from './AudioProcessor';
import {
    IResamplerProcessor,
    AudioData,
    AudioProcessingResult
} from '../interfaces/IAudioPipeline';

/**
 * リサンプラー設定
 */
export interface ResamplerConfig {
    /** ターゲットサンプリングレート (Hz) */
    targetSampleRate: number;
    /** 補間品質 ('low' | 'medium' | 'high') */
    quality: 'low' | 'medium' | 'high';
}

/**
 * リサンプラープロセッサー
 */
export class ResamplerProcessor extends AudioProcessor implements IResamplerProcessor {
    private config: ResamplerConfig;

    constructor(config: ResamplerConfig) {
        super();
        this.config = config;
    }

    /**
     * 音声データを処理
     */
    async process(input: AudioData): Promise<AudioProcessingResult> {
        if (!this.enabled) {
            return await this.processNext(input);
        }

        try {
            // サンプリングレートが同じ場合はスキップ
            if (input.sampleRate === this.config.targetSampleRate) {
                return await this.processNext(input);
            }

            // リサンプリング
            const resampled = this.resample(
                input.samples,
                input.sampleRate,
                this.config.targetSampleRate
            );

            const output: AudioData = {
                samples: resampled,
                sampleRate: this.config.targetSampleRate,
                channels: input.channels,
                timestamp: input.timestamp
            };

            return await this.processNext(output);

        } catch (error) {
            return this.createErrorResult(error as Error);
        }
    }

    /**
     * サンプリングレートを変換
     */
    resample(
        input: Float32Array,
        sourceSampleRate: number,
        targetSampleRate: number
    ): Float32Array {
        const ratio = sourceSampleRate / targetSampleRate;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Float32Array(outputLength);

        switch (this.config.quality) {
            case 'high':
                return this.resampleCubic(input, ratio, outputLength);
            case 'medium':
                return this.resampleLinear(input, ratio, outputLength);
            case 'low':
            default:
                return this.resampleNearest(input, ratio, outputLength);
        }
    }

    /**
     * 最近傍補間
     */
    private resampleNearest(
        input: Float32Array,
        ratio: number,
        outputLength: number
    ): Float32Array {
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const sourceIndex = Math.round(i * ratio);
            output[i] = input[Math.min(sourceIndex, input.length - 1)];
        }
        
        return output;
    }

    /**
     * 線形補間
     */
    private resampleLinear(
        input: Float32Array,
        ratio: number,
        outputLength: number
    ): Float32Array {
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const sourceIndex = i * ratio;
            const index0 = Math.floor(sourceIndex);
            const index1 = Math.min(index0 + 1, input.length - 1);
            const fraction = sourceIndex - index0;
            
            output[i] = input[index0] * (1 - fraction) + input[index1] * fraction;
        }
        
        return output;
    }

    /**
     * 3次補間
     */
    private resampleCubic(
        input: Float32Array,
        ratio: number,
        outputLength: number
    ): Float32Array {
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const sourceIndex = i * ratio;
            const index = Math.floor(sourceIndex);
            const fraction = sourceIndex - index;
            
            // 4点を取得
            const p0 = input[Math.max(index - 1, 0)];
            const p1 = input[index];
            const p2 = input[Math.min(index + 1, input.length - 1)];
            const p3 = input[Math.min(index + 2, input.length - 1)];
            
            // Catmull-Rom スプライン補間
            output[i] = this.cubicInterpolate(p0, p1, p2, p3, fraction);
        }
        
        return output;
    }

    /**
     * 3次補間計算
     */
    private cubicInterpolate(
        p0: number,
        p1: number,
        p2: number,
        p3: number,
        t: number
    ): number {
        const a0 = p3 - p2 - p0 + p1;
        const a1 = p0 - p1 - a0;
        const a2 = p2 - p0;
        const a3 = p1;
        
        return a0 * t * t * t + a1 * t * t + a2 * t + a3;
    }

    /**
     * ターゲットサンプリングレートを取得
     */
    getTargetSampleRate(): number {
        return this.config.targetSampleRate;
    }

    /**
     * ターゲットサンプリングレートを設定
     */
    setTargetSampleRate(sampleRate: number): void {
        this.config.targetSampleRate = sampleRate;
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<ResamplerConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

