/**
 * 音声処理パイプライン
 *
 * @description
 * 複数の音声プロセッサーをチェーン接続して処理
 * 責任の連鎖パターンを使用
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import {
    IAudioPipeline,
    IAudioProcessor,
    AudioData,
    AudioProcessingResult
} from '../interfaces/IAudioPipeline';

/**
 * 音声処理パイプライン
 */
export class AudioPipeline implements IAudioPipeline {
    private processors: IAudioProcessor[] = [];
    private enabled = true;

    /**
     * プロセッサーを追加
     */
    addProcessor(processor: IAudioProcessor): void {
        this.processors.push(processor);
        this.rebuildChain();
    }

    /**
     * プロセッサーを削除
     */
    removeProcessor(processor: IAudioProcessor): void {
        const index = this.processors.indexOf(processor);
        if (index !== -1) {
            this.processors.splice(index, 1);
            this.rebuildChain();
        }
    }

    /**
     * すべてのプロセッサーを取得
     */
    getProcessors(): IAudioProcessor[] {
        return [...this.processors];
    }

    /**
     * すべてのプロセッサーをクリア
     */
    clearProcessors(): void {
        this.processors = [];
    }

    /**
     * 音声データを処理
     */
    async process(input: AudioData): Promise<AudioProcessingResult> {
        if (!this.enabled || this.processors.length === 0) {
            return {
                data: input,
                success: true
            };
        }

        try {
            // 最初のプロセッサーから処理を開始
            return await this.processors[0].process(input);
        } catch (error) {
            return {
                data: input,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * パイプラインを初期化
     */
    async initialize(): Promise<void> {
        for (const processor of this.processors) {
            await processor.initialize();
        }
        this.rebuildChain();
    }

    /**
     * パイプラインを破棄
     */
    async dispose(): Promise<void> {
        for (const processor of this.processors) {
            await processor.dispose();
        }
        this.processors = [];
    }

    /**
     * パイプラインを有効化/無効化
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * パイプラインが有効か
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * プロセッサーチェーンを再構築
     */
    private rebuildChain(): void {
        for (let i = 0; i < this.processors.length - 1; i++) {
            this.processors[i].setNext(this.processors[i + 1]);
        }
        
        // 最後のプロセッサーは次がない
        if (this.processors.length > 0) {
            this.processors[this.processors.length - 1].setNext(null as any);
        }
    }
}

/**
 * パイプラインビルダー
 */
export class AudioPipelineBuilder {
    private pipeline: AudioPipeline;

    constructor() {
        this.pipeline = new AudioPipeline();
    }

    /**
     * プロセッサーを追加
     */
    addProcessor(processor: IAudioProcessor): AudioPipelineBuilder {
        this.pipeline.addProcessor(processor);
        return this;
    }

    /**
     * パイプラインを構築
     */
    build(): AudioPipeline {
        return this.pipeline;
    }

    /**
     * パイプラインを初期化して構築
     */
    async buildAndInitialize(): Promise<AudioPipeline> {
        await this.pipeline.initialize();
        return this.pipeline;
    }
}

