/**
 * パフォーマンス最適化システム
 *
 * @description
 * メモリ使用量、CPU 占有率、音声バッファを最適化するクラス。
 * GC 圧力の削減、リソース管理、パフォーマンス監視を含む。
 *
 * @features
 * - メモリ使用量監視と最適化
 * - CPU 使用率追跡
 * - 音声バッファ最適化
 * - GC 圧力削減
 * - リソースプール管理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * パフォーマンスメトリクス
 */
export interface PerformanceMetrics {
    /** メモリ使用量 (MB) */
    memoryUsage: number;
    /** CPU 使用率 (%) */
    cpuUsage: number;
    /** バッファサイズ (bytes) */
    bufferSize: number;
    /** GC 実行回数 */
    gcCount: number;
    /** 平均処理時間 (ms) */
    averageProcessingTime: number;
    /** フレームレート (fps) */
    frameRate: number;
}

/**
 * パフォーマンス設定
 */
export interface PerformanceConfig {
    /** メモリ使用量上限 (MB) */
    maxMemoryUsage: number;
    /** CPU 使用率上限 (%) */
    maxCpuUsage: number;
    /** バッファサイズ上限 (bytes) */
    maxBufferSize: number;
    /** GC 実行間隔 (ms) */
    gcInterval: number;
    /** メトリクス収集間隔 (ms) */
    metricsInterval: number;
    /** オブジェクトプールサイズ */
    poolSize: number;
}

/**
 * オブジェクトプールエントリ
 */
interface PoolEntry<T> {
    object: T;
    inUse: boolean;
    lastUsed: number;
}

/**
 * パフォーマンス最適化クラス
 */
export class PerformanceOptimizer {
    private config: Required<PerformanceConfig>;
    private metrics: PerformanceMetrics;
    private metricsHistory: PerformanceMetrics[] = [];
    private readonly historySize: number = 60; // 1 minute at 1s interval
    private metricsTimer: NodeJS.Timeout | null = null;
    private gcTimer: NodeJS.Timeout | null = null;
    private audioBufferPool: Map<number, PoolEntry<Float32Array>> = new Map();
    private processingTimes: number[] = [];
    private lastFrameTime: number = 0;
    private frameCount: number = 0;

    /**
     * コンストラクタ
     *
     * @param config - パフォーマンス設定
     */
    constructor(config: Partial<PerformanceConfig> = {}) {
        this.config = {
            maxMemoryUsage: config.maxMemoryUsage ?? 200, // 200 MB
            maxCpuUsage: config.maxCpuUsage ?? 20, // 20%
            maxBufferSize: config.maxBufferSize ?? 1024 * 1024, // 1 MB
            gcInterval: config.gcInterval ?? 30000, // 30 seconds
            metricsInterval: config.metricsInterval ?? 1000, // 1 second
            poolSize: config.poolSize ?? 10
        };

        this.metrics = this.createEmptyMetrics();

        logger.info('PerformanceOptimizer initialized', {
            maxMemoryUsage: this.config.maxMemoryUsage,
            maxCpuUsage: this.config.maxCpuUsage
        });
    }

    /**
     * 最適化を開始
     */
    public start(): void {
        // メトリクス収集開始
        this.metricsTimer = setInterval(() => {
            this.collectMetrics();
        }, this.config.metricsInterval);

        // GC スケジュール開始
        this.gcTimer = setInterval(() => {
            this.performGarbageCollection();
        }, this.config.gcInterval);

        // オブジェクトプール初期化
        this.initializeObjectPool();

        logger.info('Performance optimization started');
    }

    /**
     * 最適化を停止
     */
    public stop(): void {
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
        }

        if (this.gcTimer) {
            clearInterval(this.gcTimer);
            this.gcTimer = null;
        }

        // プールをクリア
        this.audioBufferPool.clear();

        logger.info('Performance optimization stopped');
    }

    /**
     * メトリクスを収集
     *
     * @private
     */
    private collectMetrics(): void {
        // メモリ使用量（ブラウザ環境では推定）
        const memoryUsage = this.estimateMemoryUsage();

        // CPU 使用率（処理時間から推定）
        const cpuUsage = this.estimateCpuUsage();

        // バッファサイズ
        const bufferSize = this.calculateBufferSize();

        // フレームレート
        const frameRate = this.calculateFrameRate();

        // 平均処理時間
        const averageProcessingTime = this.calculateAverageProcessingTime();

        this.metrics = {
            memoryUsage,
            cpuUsage,
            bufferSize,
            gcCount: this.metrics.gcCount,
            averageProcessingTime,
            frameRate
        };

        // 履歴に追加
        this.metricsHistory.push({ ...this.metrics });
        if (this.metricsHistory.length > this.historySize) {
            this.metricsHistory.shift();
        }

        // 警告チェック
        this.checkPerformanceWarnings();
    }

    /**
     * メモリ使用量を推定
     *
     * @private
     * @returns メモリ使用量 (MB)
     */
    private estimateMemoryUsage(): number {
        // ブラウザ環境では performance.memory を使用（Chrome のみ）
        if ('memory' in performance && performance.memory) {
            const memory = performance.memory;
            return memory.usedJSHeapSize / (1024 * 1024);
        }

        // フォールバック: プールサイズから推定
        let totalSize = 0;
        for (const entry of this.audioBufferPool.values()) {
            totalSize += entry.object.byteLength;
        }
        return totalSize / (1024 * 1024);
    }

    /**
     * CPU 使用率を推定
     *
     * @private
     * @returns CPU 使用率 (%)
     */
    private estimateCpuUsage(): number {
        if (this.processingTimes.length === 0) {
            return 0;
        }

        // 平均処理時間から CPU 使用率を推定
        const avgProcessingTime = this.calculateAverageProcessingTime();
        const interval = this.config.metricsInterval;

        // CPU 使用率 = (処理時間 / 間隔) * 100
        return Math.min(100, (avgProcessingTime / interval) * 100);
    }

    /**
     * バッファサイズを計算
     *
     * @private
     * @returns バッファサイズ (bytes)
     */
    private calculateBufferSize(): number {
        let totalSize = 0;
        for (const entry of this.audioBufferPool.values()) {
            if (entry.inUse) {
                totalSize += entry.object.byteLength;
            }
        }
        return totalSize;
    }

    /**
     * フレームレートを計算
     *
     * @private
     * @returns フレームレート (fps)
     */
    private calculateFrameRate(): number {
        const now = performance.now();
        if (this.lastFrameTime === 0) {
            this.lastFrameTime = now;
            return 0;
        }

        const elapsed = now - this.lastFrameTime;
        if (elapsed >= 1000) {
            const fps = (this.frameCount / elapsed) * 1000;
            this.frameCount = 0;
            this.lastFrameTime = now;
            return fps;
        }

        return this.metrics.frameRate;
    }

    /**
     * 平均処理時間を計算
     *
     * @private
     * @returns 平均処理時間 (ms)
     */
    private calculateAverageProcessingTime(): number {
        if (this.processingTimes.length === 0) {
            return 0;
        }

        const sum = this.processingTimes.reduce((a, b) => a + b, 0);
        return sum / this.processingTimes.length;
    }

    /**
     * パフォーマンス警告をチェック
     *
     * @private
     */
    private checkPerformanceWarnings(): void {
        if (this.metrics.memoryUsage > this.config.maxMemoryUsage) {
            logger.warn('Memory usage exceeds limit', {
                current: this.metrics.memoryUsage,
                limit: this.config.maxMemoryUsage
            });
        }

        if (this.metrics.cpuUsage > this.config.maxCpuUsage) {
            logger.warn('CPU usage exceeds limit', {
                current: this.metrics.cpuUsage,
                limit: this.config.maxCpuUsage
            });
        }

        if (this.metrics.bufferSize > this.config.maxBufferSize) {
            logger.warn('Buffer size exceeds limit', {
                current: this.metrics.bufferSize,
                limit: this.config.maxBufferSize
            });
        }
    }

    /**
     * ガベージコレクションを実行
     *
     * @private
     */
    private performGarbageCollection(): void {
        // 未使用のバッファをクリア
        const now = Date.now();
        const timeout = 60000; // 1 minute

        for (const [key, entry] of this.audioBufferPool.entries()) {
            if (!entry.inUse && now - entry.lastUsed > timeout) {
                this.audioBufferPool.delete(key);
            }
        }

        this.metrics.gcCount++;

        logger.debug('Garbage collection performed', {
            poolSize: this.audioBufferPool.size,
            gcCount: this.metrics.gcCount
        });
    }

    /**
     * オブジェクトプールを初期化
     *
     * @private
     */
    private initializeObjectPool(): void {
        // 一般的なバッファサイズでプールを初期化
        const commonSizes = [1024, 2048, 4096, 8192];

        for (const size of commonSizes) {
            for (let i = 0; i < this.config.poolSize / commonSizes.length; i++) {
                const buffer = new Float32Array(size);
                this.audioBufferPool.set(Date.now() + i, {
                    object: buffer,
                    inUse: false,
                    lastUsed: Date.now()
                });
            }
        }

        logger.debug('Object pool initialized', {
            poolSize: this.audioBufferPool.size
        });
    }

    /**
     * バッファを取得（プールから）
     *
     * @param size - バッファサイズ
     * @returns Float32Array
     */
    public acquireBuffer(size: number): Float32Array {
        // プールから適切なサイズのバッファを探す
        for (const entry of this.audioBufferPool.values()) {
            if (!entry.inUse && entry.object.length >= size) {
                entry.inUse = true;
                entry.lastUsed = Date.now();
                return entry.object.subarray(0, size);
            }
        }

        // プールに適切なバッファがない場合は新規作成
        const buffer = new Float32Array(size);
        this.audioBufferPool.set(Date.now(), {
            object: buffer,
            inUse: true,
            lastUsed: Date.now()
        });

        return buffer;
    }

    /**
     * バッファを解放（プールに戻す）
     *
     * @param buffer - Float32Array
     */
    public releaseBuffer(buffer: Float32Array): void {
        for (const entry of this.audioBufferPool.values()) {
            if (entry.object === buffer || entry.object.buffer === buffer.buffer) {
                entry.inUse = false;
                entry.lastUsed = Date.now();
                return;
            }
        }
    }

    /**
     * 処理時間を記録
     *
     * @param time - 処理時間 (ms)
     */
    public recordProcessingTime(time: number): void {
        this.processingTimes.push(time);

        // 最新 100 件のみ保持
        if (this.processingTimes.length > 100) {
            this.processingTimes.shift();
        }

        this.frameCount++;
    }

    /**
     * メトリクスを取得
     *
     * @returns パフォーマンスメトリクス
     */
    public getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    /**
     * メトリクス履歴を取得
     *
     * @returns メトリクス履歴
     */
    public getMetricsHistory(): PerformanceMetrics[] {
        return [...this.metricsHistory];
    }

    /**
     * パフォーマンスが最適かチェック
     *
     * @returns 最適か
     */
    public isPerformanceOptimal(): boolean {
        return (
            this.metrics.memoryUsage <= this.config.maxMemoryUsage &&
            this.metrics.cpuUsage <= this.config.maxCpuUsage &&
            this.metrics.bufferSize <= this.config.maxBufferSize
        );
    }

    /**
     * 空のメトリクスを作成
     *
     * @private
     * @returns 空のメトリクス
     */
    private createEmptyMetrics(): PerformanceMetrics {
        return {
            memoryUsage: 0,
            cpuUsage: 0,
            bufferSize: 0,
            gcCount: 0,
            averageProcessingTime: 0,
            frameRate: 0
        };
    }

    /**
     * メトリクスをリセット
     */
    public resetMetrics(): void {
        this.metrics = this.createEmptyMetrics();
        this.metricsHistory = [];
        this.processingTimes = [];
        this.frameCount = 0;
        this.lastFrameTime = 0;

        logger.info('Performance metrics reset');
    }
}
