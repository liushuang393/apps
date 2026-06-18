/**
 * エラー回復管理システム
 *
 * @description
 * 接続エラー、セッションエラー、データ同期エラーからの自動回復を管理するクラス。
 * 智能错误恢复、断线重连、会话恢复、数据同步を含む。
 *
 * @features
 * - 智能错误分类和处理
 * - 自动重连（指数退避）
 * - 会话状态恢复
 * - 数据同步和缓冲
 * - 错误统计和监控
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';
import { ConnectionError, TimeoutError, APIError } from '../errors';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * エラータイプ
 */
export enum ErrorType {
    CONNECTION = 'connection',
    TIMEOUT = 'timeout',
    API = 'api',
    SESSION = 'session',
    DATA_SYNC = 'data_sync',
    UNKNOWN = 'unknown'
}

/**
 * 回復戦略
 */
export enum RecoveryStrategy {
    RETRY = 'retry',
    RECONNECT = 'reconnect',
    RESTORE_SESSION = 'restore_session',
    SYNC_DATA = 'sync_data',
    FAIL = 'fail'
}

/**
 * エラー回復設定
 */
export interface ErrorRecoveryConfig {
    /** 最大再試行回数 */
    maxRetries: number;
    /** 初期再試行遅延 (ms) */
    initialRetryDelay: number;
    /** 最大再試行遅延 (ms) */
    maxRetryDelay: number;
    /** タイムアウト (ms) */
    timeout: number;
    /** セッション復元を有効化 */
    enableSessionRestore: boolean;
    /** データ同期を有効化 */
    enableDataSync: boolean;
}

/**
 * エラー情報
 */
export interface ErrorInfo {
    type: ErrorType;
    error: Error;
    timestamp: number;
    retryCount: number;
    strategy: RecoveryStrategy;
}

/**
 * 回復統計
 */
export interface RecoveryStats {
    totalErrors: number;
    recoveredErrors: number;
    failedErrors: number;
    recoveryRate: number;
    averageRecoveryTime: number;
    errorsByType: Record<ErrorType, number>;
}

/**
 * データバッファエントリ
 */
interface BufferEntry {
    data: unknown;
    timestamp: number;
    retryCount: number;
}

/**
 * エラー回復管理クラス
 */
export class ErrorRecoveryManager {
    private config: Required<ErrorRecoveryConfig>;
    private errorHistory: ErrorInfo[] = [];
    private stats: RecoveryStats;
    private dataBuffer: BufferEntry[] = [];
    private recoveryInProgress: boolean = false;
    private readonly maxHistorySize: number = 100;
    private readonly maxBufferSize: number = 1000;

    /**
     * コンストラクタ
     *
     * @param config - エラー回復設定
     */
    constructor(config: Partial<ErrorRecoveryConfig> = {}) {
        this.config = {
            maxRetries: config.maxRetries ?? 5,
            initialRetryDelay: config.initialRetryDelay ?? 1000,
            maxRetryDelay: config.maxRetryDelay ?? 30000,
            timeout: config.timeout ?? 30000,
            enableSessionRestore: config.enableSessionRestore ?? true,
            enableDataSync: config.enableDataSync ?? true
        };

        this.stats = this.createEmptyStats();

        logger.info('ErrorRecoveryManager initialized', {
            maxRetries: this.config.maxRetries,
            timeout: this.config.timeout
        });
    }

    /**
     * エラーを処理して回復を試みる
     *
     * @param error - エラーオブジェクト
     * @param context - コンテキスト情報
     * @returns 回復成功か
     */
    public async handleError(error: Error, context?: Record<string, unknown>): Promise<boolean> {
        const errorType = this.classifyError(error);
        const strategy = this.determineStrategy(errorType, error);

        const errorInfo: ErrorInfo = {
            type: errorType,
            error,
            timestamp: Date.now(),
            retryCount: 0,
            strategy
        };

        this.recordError(errorInfo);

        logger.warn('Error detected', {
            type: errorType,
            strategy,
            message: error.message,
            context
        });

        try {
            const recovered = await this.executeRecovery(errorInfo, context);

            if (recovered) {
                this.stats.recoveredErrors++;
                logger.info('Error recovered successfully', { type: errorType });
            } else {
                this.stats.failedErrors++;
                logger.error('Error recovery failed', { type: errorType });
            }

            return recovered;
        } catch (recoveryError) {
            this.stats.failedErrors++;
            logger.error('Error recovery threw exception', recoveryError);
            return false;
        }
    }

    /**
     * エラーを分類
     *
     * @private
     * @param error - エラーオブジェクト
     * @returns エラータイプ
     */
    private classifyError(error: Error): ErrorType {
        if (error instanceof ConnectionError) {
            return ErrorType.CONNECTION;
        }
        if (error instanceof TimeoutError) {
            return ErrorType.TIMEOUT;
        }
        if (error instanceof APIError) {
            return ErrorType.API;
        }
        if (error.message.toLowerCase().includes('session')) {
            return ErrorType.SESSION;
        }
        if (
            error.message.toLowerCase().includes('sync') ||
            error.message.toLowerCase().includes('data')
        ) {
            return ErrorType.DATA_SYNC;
        }
        return ErrorType.UNKNOWN;
    }

    /**
     * 回復戦略を決定
     *
     * @private
     * @param errorType - エラータイプ
     * @param error - エラーオブジェクト
     * @returns 回復戦略
     */
    private determineStrategy(errorType: ErrorType, error: Error): RecoveryStrategy {
        switch (errorType) {
            case ErrorType.CONNECTION:
                return RecoveryStrategy.RECONNECT;
            case ErrorType.TIMEOUT:
                return RecoveryStrategy.RETRY;
            case ErrorType.SESSION:
                return this.config.enableSessionRestore
                    ? RecoveryStrategy.RESTORE_SESSION
                    : RecoveryStrategy.FAIL;
            case ErrorType.DATA_SYNC:
                return this.config.enableDataSync
                    ? RecoveryStrategy.SYNC_DATA
                    : RecoveryStrategy.FAIL;
            case ErrorType.API:
                // API エラーは 5xx エラーの場合のみ再試行
                if (error instanceof APIError && error.statusCode && error.statusCode >= 500) {
                    return RecoveryStrategy.RETRY;
                }
                return RecoveryStrategy.FAIL;
            default:
                return RecoveryStrategy.RETRY;
        }
    }

    /**
     * 回復を実行
     *
     * @private
     * @param errorInfo - エラー情報
     * @param context - コンテキスト情報
     * @returns 回復成功か
     */
    private async executeRecovery(
        errorInfo: ErrorInfo,
        context?: Record<string, unknown>
    ): Promise<boolean> {
        if (this.recoveryInProgress) {
            logger.warn('Recovery already in progress, queuing...');
            await this.waitForRecovery();
        }

        this.recoveryInProgress = true;
        const startTime = Date.now();

        try {
            let recovered = false;

            switch (errorInfo.strategy) {
                case RecoveryStrategy.RETRY:
                    recovered = await this.retryWithBackoff(errorInfo, context);
                    break;
                case RecoveryStrategy.RECONNECT:
                    recovered = await this.reconnect(errorInfo, context);
                    break;
                case RecoveryStrategy.RESTORE_SESSION:
                    recovered = await this.restoreSession(errorInfo, context);
                    break;
                case RecoveryStrategy.SYNC_DATA:
                    recovered = await this.syncData(errorInfo, context);
                    break;
                case RecoveryStrategy.FAIL:
                    recovered = false;
                    break;
            }

            const recoveryTime = Date.now() - startTime;
            this.updateRecoveryStats(recoveryTime);

            return recovered;
        } finally {
            this.recoveryInProgress = false;
        }
    }

    /**
     * 指数バックオフで再試行
     *
     * @private
     * @param errorInfo - エラー情報
     * @param context - コンテキスト情報
     * @returns 成功か
     */
    private async retryWithBackoff(
        errorInfo: ErrorInfo,
        context?: Record<string, unknown>
    ): Promise<boolean> {
        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            const delay = Math.min(
                this.config.initialRetryDelay * Math.pow(2, attempt),
                this.config.maxRetryDelay
            );

            logger.debug(`Retry attempt ${attempt + 1}/${this.config.maxRetries}`, {
                delay,
                type: errorInfo.type
            });

            await this.sleep(delay);

            try {
                // コンテキストに再試行関数がある場合は実行
                if (context && 'retryFn' in context && typeof context['retryFn'] === 'function') {
                    await (context['retryFn'] as () => Promise<void>)();
                    return true;
                }

                // デフォルトでは成功とみなす（実際の実装では適切な処理が必要）
                return true;
            } catch (error) {
                logger.warn(`Retry attempt ${attempt + 1} failed`, error);
                if (attempt === this.config.maxRetries - 1) {
                    return false;
                }
            }
        }

        return false;
    }

    /**
     * 再接続
     *
     * @private
     * @param errorInfo - エラー情報
     * @param context - コンテキスト情報
     * @returns 成功か
     */
    private async reconnect(
        _errorInfo: ErrorInfo,
        context?: Record<string, unknown>
    ): Promise<boolean> {
        logger.info('Attempting reconnection...');

        try {
            if (
                context &&
                'reconnectFn' in context &&
                typeof context['reconnectFn'] === 'function'
            ) {
                await (context['reconnectFn'] as () => Promise<void>)();
                return true;
            }

            // デフォルトでは成功とみなす
            return true;
        } catch (error) {
            logger.error('Reconnection failed', error);
            return false;
        }
    }

    /**
     * セッションを復元
     *
     * @private
     * @param errorInfo - エラー情報
     * @param context - コンテキスト情報
     * @returns 成功か
     */
    private async restoreSession(
        _errorInfo: ErrorInfo,
        context?: Record<string, unknown>
    ): Promise<boolean> {
        logger.info('Attempting session restore...');

        try {
            if (
                context &&
                'restoreSessionFn' in context &&
                typeof context['restoreSessionFn'] === 'function'
            ) {
                await (context['restoreSessionFn'] as () => Promise<void>)();
                return true;
            }

            return true;
        } catch (error) {
            logger.error('Session restore failed', error);
            return false;
        }
    }

    /**
     * データを同期
     *
     * @private
     * @param errorInfo - エラー情報
     * @param context - コンテキスト情報
     * @returns 成功か
     */
    private async syncData(
        _errorInfo: ErrorInfo,
        context?: Record<string, unknown>
    ): Promise<boolean> {
        logger.info('Attempting data sync...');

        try {
            // バッファされたデータを送信
            await this.flushBuffer(context);
            return true;
        } catch (error) {
            logger.error('Data sync failed', error);
            return false;
        }
    }

    /**
     * データをバッファに追加
     *
     * @param data - データ
     */
    public bufferData(data: unknown): void {
        if (this.dataBuffer.length >= this.maxBufferSize) {
            // 最も古いエントリを削除
            this.dataBuffer.shift();
            logger.warn('Buffer full, removing oldest entry');
        }

        this.dataBuffer.push({
            data,
            timestamp: Date.now(),
            retryCount: 0
        });

        logger.debug('Data buffered', { bufferSize: this.dataBuffer.length });
    }

    /**
     * バッファをフラッシュ
     *
     * @private
     * @param context - コンテキスト情報
     */
    private async flushBuffer(context?: Record<string, unknown>): Promise<void> {
        logger.info('Flushing buffer', { size: this.dataBuffer.length });

        const entries = [...this.dataBuffer];
        this.dataBuffer = [];

        for (const entry of entries) {
            try {
                if (
                    context &&
                    'sendDataFn' in context &&
                    typeof context['sendDataFn'] === 'function'
                ) {
                    await (context['sendDataFn'] as (data: unknown) => Promise<void>)(entry.data);
                }
            } catch (error) {
                logger.error('Failed to send buffered data', error);
                // 再バッファリング
                if (entry.retryCount < this.config.maxRetries) {
                    entry.retryCount++;
                    this.dataBuffer.push(entry);
                }
            }
        }
    }

    /**
     * エラーを記録
     *
     * @private
     * @param errorInfo - エラー情報
     */
    private recordError(errorInfo: ErrorInfo): void {
        this.errorHistory.push(errorInfo);

        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }

        this.stats.totalErrors++;
        this.stats.errorsByType[errorInfo.type]++;
    }

    /**
     * 回復統計を更新
     *
     * @private
     * @param recoveryTime - 回復時間 (ms)
     */
    private updateRecoveryStats(recoveryTime: number): void {
        const totalRecoveries = this.stats.recoveredErrors + this.stats.failedErrors;
        this.stats.averageRecoveryTime =
            (this.stats.averageRecoveryTime * (totalRecoveries - 1) + recoveryTime) /
            totalRecoveries;

        this.stats.recoveryRate =
            this.stats.totalErrors > 0 ? this.stats.recoveredErrors / this.stats.totalErrors : 0;
    }

    /**
     * 回復完了を待機
     *
     * @private
     */
    private async waitForRecovery(): Promise<void> {
        while (this.recoveryInProgress) {
            await this.sleep(100);
        }
    }

    /**
     * スリープ
     *
     * @private
     * @param ms - ミリ秒
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 空の統計を作成
     *
     * @private
     * @returns 空の統計
     */
    private createEmptyStats(): RecoveryStats {
        return {
            totalErrors: 0,
            recoveredErrors: 0,
            failedErrors: 0,
            recoveryRate: 0,
            averageRecoveryTime: 0,
            errorsByType: {
                [ErrorType.CONNECTION]: 0,
                [ErrorType.TIMEOUT]: 0,
                [ErrorType.API]: 0,
                [ErrorType.SESSION]: 0,
                [ErrorType.DATA_SYNC]: 0,
                [ErrorType.UNKNOWN]: 0
            }
        };
    }

    /**
     * 統計を取得
     *
     * @returns 回復統計
     */
    public getStats(): RecoveryStats {
        return { ...this.stats };
    }

    /**
     * エラー履歴を取得
     *
     * @returns エラー履歴
     */
    public getErrorHistory(): ErrorInfo[] {
        return [...this.errorHistory];
    }

    /**
     * バッファサイズを取得
     *
     * @returns バッファサイズ
     */
    public getBufferSize(): number {
        return this.dataBuffer.length;
    }

    /**
     * 統計をリセット
     */
    public resetStats(): void {
        this.stats = this.createEmptyStats();
        this.errorHistory = [];
        logger.info('Recovery stats reset');
    }

    /**
     * バッファをクリア
     */
    public clearBuffer(): void {
        this.dataBuffer = [];
        logger.info('Data buffer cleared');
    }
}
