/**
 * 音声プロセッサー基底クラス
 *
 * @description
 * 音声処理パイプラインの基本プロセッサー
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import {
    IAudioProcessor,
    AudioData,
    AudioProcessingResult,
    AudioFormat
} from '../interfaces/IAudioPipeline';

/**
 * 音声プロセッサー基底クラス
 */
export abstract class AudioProcessor implements IAudioProcessor {
    protected enabled = true;
    protected nextProcessor: IAudioProcessor | null = null;

    /**
     * 音声データを処理
     */
    abstract process(input: AudioData): Promise<AudioProcessingResult>;

    /**
     * プロセッサーを初期化
     */
    async initialize(): Promise<void> {
        // サブクラスでオーバーライド可能
    }

    /**
     * プロセッサーを破棄
     */
    async dispose(): Promise<void> {
        this.nextProcessor = null;
    }

    /**
     * プロセッサーを有効化/無効化
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * プロセッサーが有効か
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * 次のプロセッサーを設定
     */
    setNext(processor: IAudioProcessor): void {
        this.nextProcessor = processor;
    }

    /**
     * 次のプロセッサーに処理を渡す
     */
    protected async processNext(input: AudioData): Promise<AudioProcessingResult> {
        if (this.nextProcessor) {
            return await this.nextProcessor.process(input);
        }
        
        // 最後のプロセッサーの場合
        return {
            data: input,
            success: true
        };
    }

    /**
     * エラー結果を作成
     */
    protected createErrorResult(error: Error): AudioProcessingResult {
        return {
            data: {
                samples: new Float32Array(0),
                sampleRate: 0,
                channels: 1,
                timestamp: Date.now()
            },
            success: false,
            error: error.message
        };
    }
}

