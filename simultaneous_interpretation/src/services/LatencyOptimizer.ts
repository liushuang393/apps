/**
 * 遅延最適化サービス
 *
 * @description
 * WebSocket 事前接続、音声ストリーミング、非同期処理による遅延削減
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { IWebSocketAdapter } from '../interfaces/IWebSocketAdapter';

/**
 * 遅延最適化設定
 */
export interface LatencyOptimizerConfig {
    /** WebSocket 事前接続を有効化 */
    enablePreconnect: boolean;
    /** 音声ストリーミングを有効化 */
    enableStreaming: boolean;
    /** 非同期処理を有効化 */
    enableAsync: boolean;
    /** チャンクサイズ (ms) */
    chunkSizeMs: number;
    /** バッファサイズ (ms) */
    bufferSizeMs: number;
    /** 事前接続タイムアウト (ms) */
    preconnectTimeout: number;
}

/**
 * 遅延最適化サービス
 */
export class LatencyOptimizer {
    private config: LatencyOptimizerConfig;
    private wsAdapter: IWebSocketAdapter | null = null;
    private audioQueue: ArrayBuffer[] = [];
    private isProcessing = false;
    private streamingEnabled = false;

    constructor(config?: Partial<LatencyOptimizerConfig>) {
        this.config = {
            enablePreconnect: true,
            enableStreaming: true,
            enableAsync: true,
            chunkSizeMs: 100,
            bufferSizeMs: 300,
            preconnectTimeout: 5000,
            ...config
        };
    }

    /**
     * WebSocket アダプターを設定
     */
    setWebSocketAdapter(adapter: IWebSocketAdapter): void {
        this.wsAdapter = adapter;
    }

    /**
     * WebSocket を事前接続
     *
     * @description
     * ユーザーがボタンをクリックする前に接続を確立
     * 初回接続の遅延を削減
     */
    async preconnectWebSocket(): Promise<boolean> {
        if (!this.config.enablePreconnect || !this.wsAdapter) {
            return false;
        }

        console.log('[LatencyOptimizer] Preconnecting WebSocket...');

        try {
            // タイムアウト付きで接続
            const connectPromise = this.wsAdapter.connect();
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Preconnect timeout')), 
                    this.config.preconnectTimeout);
            });

            await Promise.race([connectPromise, timeoutPromise]);
            console.log('[LatencyOptimizer] WebSocket preconnected successfully');
            return true;

        } catch (error) {
            console.warn('[LatencyOptimizer] Preconnect failed:', error);
            return false;
        }
    }

    /**
     * 音声ストリーミングを開始
     *
     * @description
     * 音声データを小さなチャンクに分割して送信
     * バッファリング遅延を削減
     */
    async startStreaming(): Promise<void> {
        if (!this.config.enableStreaming) {
            return;
        }

        this.streamingEnabled = true;
        console.log('[LatencyOptimizer] Streaming started');

        // キューの処理を開始
        this.processAudioQueue();
    }

    /**
     * 音声ストリーミングを停止
     */
    async stopStreaming(): Promise<void> {
        this.streamingEnabled = false;
        this.audioQueue = [];
        console.log('[LatencyOptimizer] Streaming stopped');
    }

    /**
     * 音声データをストリーミング送信
     *
     * @param audioData - 音声データ
     */
    async streamAudio(audioData: ArrayBuffer): Promise<void> {
        if (!this.config.enableStreaming || !this.wsAdapter) {
            // ストリーミング無効の場合は直接送信
            await this.wsAdapter?.sendBinary(audioData);
            return;
        }

        // チャンクに分割してキューに追加
        const chunks = this.splitIntoChunks(audioData);
        this.audioQueue.push(...chunks);

        // 処理が停止している場合は再開
        if (!this.isProcessing) {
            this.processAudioQueue();
        }
    }

    /**
     * 音声データをチャンクに分割
     */
    private splitIntoChunks(audioData: ArrayBuffer): ArrayBuffer[] {
        const chunkSize = this.calculateChunkSize(audioData.byteLength);
        const chunks: ArrayBuffer[] = [];

        for (let offset = 0; offset < audioData.byteLength; offset += chunkSize) {
            const end = Math.min(offset + chunkSize, audioData.byteLength);
            chunks.push(audioData.slice(offset, end));
        }

        return chunks;
    }

    /**
     * チャンクサイズを計算
     */
    private calculateChunkSize(_totalSize: number): number {
        // サンプリングレート 24kHz, PCM16 (2 bytes) を想定
        const sampleRate = 24000;
        const bytesPerSample = 2;
        const bytesPerMs = (sampleRate * bytesPerSample) / 1000;
        
        return Math.floor(this.config.chunkSizeMs * bytesPerMs);
    }

    /**
     * 音声キューを処理
     */
    private async processAudioQueue(): Promise<void> {
        if (this.isProcessing || !this.streamingEnabled) {
            return;
        }

        this.isProcessing = true;

        while (this.audioQueue.length > 0 && this.streamingEnabled) {
            const chunk = this.audioQueue.shift();
            
            if (chunk && this.wsAdapter) {
                try {
                    await this.wsAdapter.sendBinary(chunk);
                } catch (error) {
                    console.error('[LatencyOptimizer] Failed to send chunk:', error);
                }
            }

            // 次のチャンクまで少し待機（バックプレッシャー対策）
            if (this.audioQueue.length > 10) {
                await this.sleep(10);
            }
        }

        this.isProcessing = false;
    }

    /**
     * 非同期関数呼び出し
     *
     * @description
     * 関数呼び出しを非同期で実行し、応答を待たずに次の処理を開始
     * 関数呼び出しの遅延を削減
     */
    async callFunctionAsync<T>(
        fn: () => Promise<T>,
        onSuccess?: (result: T) => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        if (!this.config.enableAsync) {
            // 非同期無効の場合は同期実行
            try {
                const result = await fn();
                onSuccess?.(result);
            } catch (error) {
                onError?.(error as Error);
            }
            return;
        }

        // 非同期実行（Fire and Forget）
        fn()
            .then(result => onSuccess?.(result))
            .catch(error => onError?.(error));
    }

    /**
     * バッチ処理
     *
     * @description
     * 複数の操作をバッチ化して一度に実行
     * ネットワークラウンドトリップを削減
     */
    async batchProcess<T, R>(
        items: T[],
        processor: (item: T) => Promise<R>,
        batchSize = 10
    ): Promise<R[]> {
        const results: R[] = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(item => processor(item))
            );
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * 遅延測定
     *
     * @description
     * 処理の遅延を測定
     */
    async measureLatency<T>(
        fn: () => Promise<T>
    ): Promise<{ result: T; latency: number }> {
        const start = performance.now();
        const result = await fn();
        const latency = performance.now() - start;

        console.log(`[LatencyOptimizer] Latency: ${latency.toFixed(2)}ms`);

        return { result, latency };
    }

    /**
     * スリープ
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<LatencyOptimizerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 設定を取得
     */
    getConfig(): LatencyOptimizerConfig {
        return { ...this.config };
    }

    /**
     * 統計情報を取得
     */
    getStats(): {
        queueSize: number;
        isProcessing: boolean;
        streamingEnabled: boolean;
    } {
        return {
            queueSize: this.audioQueue.length,
            isProcessing: this.isProcessing,
            streamingEnabled: this.streamingEnabled
        };
    }

    /**
     * サービスを破棄
     */
    async dispose(): Promise<void> {
        await this.stopStreaming();
        this.wsAdapter = null;
    }
}

/**
 * グローバル遅延最適化インスタンス
 */
export const globalLatencyOptimizer = new LatencyOptimizer();

