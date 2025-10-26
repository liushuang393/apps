/**
 * ストリーミング音声送信
 *
 * @description
 * 音声データを小さなチャンクに分割してストリーミング送信
 * 遅延を最小化しつつ、VADと連動して効率的に送信
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import { defaultLogger } from '../utils/Logger';
import { AudioUtils } from '../utils/AudioUtils';

export interface StreamingAudioSenderConfig {
    /** チャンクサイズ (samples) */
    chunkSize: number;
    /** 送信間隔 (ms) */
    sendInterval: number;
    /** 最大バッファサイズ (samples) */
    maxBufferSize: number;
    /** デバッグモード */
    debugMode?: boolean;
}

export type SendAudioChunkFunction = (audioData: string) => void;

/**
 * StreamingAudioSender クラス
 *
 * 音声データを小さなチャンクに分割してストリーミング送信
 */
export class StreamingAudioSender {
    private config: StreamingAudioSenderConfig;
    private sendFunction: SendAudioChunkFunction;
    private buffer: Float32Array;
    private bufferIndex: number = 0;
    private isActive: boolean = false;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private stats: {
        totalChunks: number;
        totalSamples: number;
        droppedChunks: number;
    };

    /**
     * コンストラクタ
     *
     * @param sendFn 音声送信関数
     * @param config 設定
     */
    constructor(sendFn: SendAudioChunkFunction, config?: Partial<StreamingAudioSenderConfig>) {
        this.sendFunction = sendFn;
        this.config = {
            chunkSize: config?.chunkSize ?? 2400, // 100ms @ 24kHz
            sendInterval: config?.sendInterval ?? 100, // 100ms
            maxBufferSize: config?.maxBufferSize ?? 48000, // 2秒 @ 24kHz
            debugMode: config?.debugMode ?? false
        };

        this.buffer = new Float32Array(this.config.maxBufferSize);
        this.stats = {
            totalChunks: 0,
            totalSamples: 0,
            droppedChunks: 0
        };
    }

    /**
     * ストリーミング送信を開始
     */
    start(): void {
        if (this.isActive) {
            defaultLogger.warn('[StreamingAudioSender] Already active');
            return;
        }

        this.isActive = true;
        this.bufferIndex = 0;

        // 定期的にチャンクを送信
        this.intervalId = setInterval(() => {
            this.sendChunk();
        }, this.config.sendInterval);

        if (this.config.debugMode) {
            defaultLogger.debug('[StreamingAudioSender] Started:', {
                chunkSize: this.config.chunkSize,
                sendInterval: this.config.sendInterval
            });
        }
    }

    /**
     * ストリーミング送信を停止
     */
    stop(): void {
        if (!this.isActive) {
            return;
        }

        this.isActive = false;

        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.config.debugMode) {
            defaultLogger.debug('[StreamingAudioSender] Stopped');
        }
    }

    /**
     * 音声データを追加
     *
     * @param audioData 音声データ
     */
    append(audioData: Float32Array): void {
        if (!this.isActive) {
            defaultLogger.warn('[StreamingAudioSender] Not active, cannot append data');
            return;
        }

        // バッファに追加
        for (let i = 0; i < audioData.length; i++) {
            if (this.bufferIndex >= this.config.maxBufferSize) {
                // バッファ満杯 - 古いデータを上書き（循環バッファ）
                this.stats.droppedChunks++;
                this.bufferIndex = 0;

                if (this.config.debugMode) {
                    defaultLogger.warn('[StreamingAudioSender] Buffer overflow, dropping old data');
                }
            }

            this.buffer[this.bufferIndex++] = audioData[i]!;
        }

        this.stats.totalSamples += audioData.length;
    }

    /**
     * すべてのバッファをフラッシュ
     */
    flush(): void {
        if (this.bufferIndex > 0) {
            this.sendChunk(true); // すべて送信
        }
    }

    /**
     * チャンクを送信
     *
     * @param flushAll すべて送信するか
     */
    private sendChunk(flushAll: boolean = false): void {
        if (!this.isActive) {
            return;
        }

        const availableSamples = this.bufferIndex;
        if (availableSamples === 0) {
            return;
        }

        // 送信するサンプル数を決定
        const samplesToSend = flushAll
            ? availableSamples
            : Math.min(this.config.chunkSize, availableSamples);

        if (samplesToSend === 0) {
            return;
        }

        // チャンクを抽出
        const chunk = this.buffer.slice(0, samplesToSend);

        // PCM16にエンコード
        const pcm16 = this.encodePCM16(chunk);

        // Base64エンコード
        const base64 = AudioUtils.arrayBufferToBase64(pcm16.buffer as ArrayBuffer);

        // 送信
        try {
            this.sendFunction(base64);
            this.stats.totalChunks++;

            if (this.config.debugMode) {
                defaultLogger.debug('[StreamingAudioSender] Sent chunk:', {
                    samples: samplesToSend,
                    totalChunks: this.stats.totalChunks
                });
            }
        } catch (error) {
            defaultLogger.error('[StreamingAudioSender] Send error:', error);
        }

        // バッファを左シフト
        this.shiftBuffer(samplesToSend);
    }

    /**
     * バッファを左シフト
     *
     * @param count シフト量
     */
    private shiftBuffer(count: number): void {
        const remaining = this.bufferIndex - count;

        if (remaining > 0) {
            // 残りのデータを先頭に移動
            this.buffer.copyWithin(0, count, this.bufferIndex);
        }

        this.bufferIndex = remaining;
    }

    /**
     * Float32Array を PCM16 に変換
     *
     * @param float32 Float32Array データ
     * @returns Int16Array データ
     */
    private encodePCM16(float32: Float32Array): Int16Array {
        const pcm16 = new Int16Array(float32.length);

        for (let i = 0; i < float32.length; i++) {
            // -1.0 ~ 1.0 を -32768 ~ 32767 に変換
            const s = Math.max(-1, Math.min(1, float32[i]!));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        return pcm16;
    }

    /**
     * 統計情報を取得
     */
    getStats(): {
        totalChunks: number;
        totalSamples: number;
        droppedChunks: number;
        bufferUsage: number;
    } {
        return {
            ...this.stats,
            bufferUsage: this.bufferIndex
        };
    }

    /**
     * リセット
     */
    reset(): void {
        this.stop();
        this.bufferIndex = 0;
        this.stats = {
            totalChunks: 0,
            totalSamples: 0,
            droppedChunks: 0
        };
    }
}
