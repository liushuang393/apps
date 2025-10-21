/**
 * エンコーダープロセッサー
 *
 * @description
 * 音声データを指定フォーマットにエンコード
 * PCM16, PCM32, Float32 などに対応
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { AudioProcessor, type AudioProcessingResult } from './AudioProcessor';
import type { AudioData } from '../interfaces/ICoreTypes';

/**
 * 音声フォーマット列挙型
 */
export enum AudioFormat {
    PCM16 = 'pcm16',
    PCM32 = 'pcm32',
    FLOAT32 = 'float32'
}

/**
 * エンコーダー設定
 */
export interface EncoderConfig {
    /** 出力フォーマット */
    format: AudioFormat;
    /** ビット深度 (8, 16, 24, 32) */
    bitDepth?: number;
}

/**
 * エンコーダープロセッサー
 */
export class EncoderProcessor extends AudioProcessor {
    readonly name = 'EncoderProcessor';
    private config: EncoderConfig;

    constructor(config: EncoderConfig) {
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
            // エンコード
            const encoded = this.encode(input.samples, this.config.format);

            const output: AudioData = {
                ...input,
                samples: encoded
            };

            return await this.processNext(output);

        } catch (error) {
            return this.createErrorResult(error as Error);
        }
    }

    /**
     * 音声データをエンコード
     */
    encode(samples: Float32Array, format: AudioFormat): Float32Array {
        switch (format) {
            case AudioFormat.PCM16:
                return this.encodePCM16(samples);
            case AudioFormat.PCM32:
                return this.encodePCM32(samples);
            case AudioFormat.FLOAT32:
                return samples; // すでに Float32
            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    }

    /**
     * PCM16 にエンコード
     */
    private encodePCM16(samples: Float32Array): Float32Array {
        const output = new Float32Array(samples.length);

        for (let i = 0; i < samples.length; i++) {
            // Float32 (-1.0 ~ 1.0) を Int16 (-32768 ~ 32767) に変換
            let s = Math.max(-1, Math.min(1, samples[i]!));
            s = s < 0 ? s * 32768 : s * 32767;
            output[i] = Math.floor(s);
        }

        return output;
    }

    /**
     * PCM32 にエンコード
     */
    private encodePCM32(samples: Float32Array): Float32Array {
        const output = new Float32Array(samples.length);

        for (let i = 0; i < samples.length; i++) {
            // Float32 (-1.0 ~ 1.0) を Int32 に変換
            let s = Math.max(-1, Math.min(1, samples[i]!));
            s = s < 0 ? s * 2147483648 : s * 2147483647;
            output[i] = Math.floor(s);
        }

        return output;
    }

    /**
     * ArrayBuffer にエンコード
     */
    encodeToArrayBuffer(samples: Float32Array): ArrayBuffer {
        switch (this.config.format) {
            case AudioFormat.PCM16:
                return this.encodePCM16ToArrayBuffer(samples);
            case AudioFormat.PCM32:
                return this.encodePCM32ToArrayBuffer(samples);
            case AudioFormat.FLOAT32: {
                // Float32Array の buffer をコピーして ArrayBuffer として返す
                const buffer = samples.buffer;
                return buffer instanceof ArrayBuffer ? buffer.slice(0) : new ArrayBuffer(0);
            }
            default:
                throw new Error(`Unsupported format: ${this.config.format}`);
        }
    }

    /**
     * PCM16 を ArrayBuffer にエンコード
     */
    private encodePCM16ToArrayBuffer(samples: Float32Array): ArrayBuffer {
        const buffer = new ArrayBuffer(samples.length * 2);
        const view = new DataView(buffer);

        for (let i = 0; i < samples.length; i++) {
            let s = Math.max(-1, Math.min(1, samples[i]!));
            s = s < 0 ? s * 32768 : s * 32767;
            view.setInt16(i * 2, Math.floor(s), true); // little-endian
        }

        return buffer;
    }

    /**
     * PCM32 を ArrayBuffer にエンコード
     */
    private encodePCM32ToArrayBuffer(samples: Float32Array): ArrayBuffer {
        const buffer = new ArrayBuffer(samples.length * 4);
        const view = new DataView(buffer);

        for (let i = 0; i < samples.length; i++) {
            let s = Math.max(-1, Math.min(1, samples[i]!));
            s = s < 0 ? s * 2147483648 : s * 2147483647;
            view.setInt32(i * 4, Math.floor(s), true); // little-endian
        }

        return buffer;
    }

    /**
     * フォーマットを取得
     */
    getFormat(): AudioFormat {
        return this.config.format;
    }

    /**
     * フォーマットを設定
     */
    setFormat(format: AudioFormat): void {
        this.config.format = format;
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<EncoderConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

