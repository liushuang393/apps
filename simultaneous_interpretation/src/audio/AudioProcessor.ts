/**
 * 音声プロセッサー基底クラス
 *
 * @description
 * 音声処理パイプラインの基本プロセッサー
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import type { AudioData } from '../interfaces/ICoreTypes';

/**
 * 音声処理結果
 */
export interface AudioProcessingResult {
    /** 処理済み音声データ */
    audio: AudioData;
    /** 処理が成功したか */
    success: boolean;
    /** エラーメッセージ (失敗時) */
    error?: string;
    /** メタデータ */
    metadata?: Record<string, unknown>;
}

/**
 * 音声プロセッサーインターフェース
 */
export interface IAudioProcessor {
    /** プロセッサー名 */
    readonly name: string;
    /** 音声データを処理 */
    process(input: AudioData): Promise<AudioProcessingResult>;
    /** プロセッサーを初期化 */
    initialize(): Promise<void>;
    /** プロセッサーを破棄 */
    dispose(): Promise<void>;
    /** 有効/無効を設定 */
    setEnabled(enabled: boolean): void;
    /** 有効かどうか */
    isEnabled(): boolean;
    /** 次のプロセッサーを設定 */
    setNext(processor: IAudioProcessor | null): void;
}

/**
 * 音声プロセッサー基底クラス
 */
export abstract class AudioProcessor implements IAudioProcessor {
    abstract readonly name: string;
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
    setNext(processor: IAudioProcessor | null): void {
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
            audio: input,
            success: true
        };
    }

    /**
     * エラー結果を作成
     */
    protected createErrorResult(error: Error): AudioProcessingResult {
        return {
            audio: {
                samples: new Float32Array(0),
                sampleRate: 0,
                channels: 1
            },
            success: false,
            error: error.message
        };
    }
}
