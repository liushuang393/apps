/**
 * ResponseQueue - 生産者・消費者パターンによるキュー管理
 *
 * 設計思想:
 *   - 生産者: enqueue()でリクエストをキューに追加（来たら入れるだけ）
 *   - 消費者: handleResponseDone()で消費完了を通知（完了したら次を処理）
 *   - フラグ不要: キューの状態のみで制御
 *
 * 使用方法:
 *   queue.enqueue(request);              // 生産者: リクエストを追加
 *   queue.handleResponseDone(id);        // 消費者: 処理完了を通知
 */

import { defaultLogger } from '../utils/Logger';

/**
 * ResponseQueue設定オプション
 */
export interface ResponseQueueOptions {
    /** 最大キューサイズ */
    maxQueueSize?: number;
    /** タイムアウト時間 (ms) */
    timeout?: number;
    /** 最大リトライ回数 */
    maxRetries?: number;
    /** リトライ基本遅延 (ms) */
    retryBaseDelay?: number;
    /** デバッグモード */
    debugMode?: boolean;
}

/**
 * キューアイテム
 */
interface QueueItem<T> {
    /** リクエストオブジェクト */
    request: T;
    /** Promise resolve関数 */
    resolve: (value: string) => void;
    /** Promise reject関数 */
    reject: (reason: Error) => void;
    /** タイムスタンプ */
    timestamp: number;
    /** リトライ回数 */
    retryCount: number;
    /** タイムアウトタイマーID */
    timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * 統計情報
 */
export interface QueueStats {
    /** 総リクエスト数 */
    totalRequests: number;
    /** 完了リクエスト数 */
    completedRequests: number;
    /** 失敗リクエスト数 */
    failedRequests: number;
    /** リトライ回数 */
    retriedRequests: number;
    /** タイムアウト回数 */
    timeoutRequests: number;
    /** 未送信キュー数 */
    pendingCount: number;
    /** 処理中キュー数 */
    processingCount: number;
}

/**
 * WebSocketメッセージ送信関数の型
 */
export interface ResponseCreateMessage<T> {
    type: 'response.create';
    response: T;
}

export type SendMessageFunction<T> = (message: ResponseCreateMessage<T>) => void;

/**
 * ResponseQueue クラス
 *
 * OpenAI Realtime APIのレスポンス管理を行うキュー。
 * 並発制御により、conversation_already_has_active_response エラーを防止します。
 */
export class ResponseQueue<T = unknown> {
    /** WebSocketメッセージ送信関数 */
    private sendMessage: SendMessageFunction<T>;
    /** 設定 */
    private config: Required<ResponseQueueOptions>;
    /** 未送信のリクエスト（生産者が追加） */
    private pendingQueue: QueueItem<T>[];
    /** 処理中のリクエスト（消費者が処理） */
    private processingQueue: QueueItem<T>[];
    /** 統計情報 */
    private stats: Omit<QueueStats, 'pendingCount' | 'processingCount'>;

    /**
     * コンストラクタ
     *
     * @param sendMessageFn - WebSocketメッセージ送信関数
     * @param options - 設定オプション
     */
    constructor(sendMessageFn: SendMessageFunction<T>, options: ResponseQueueOptions = {}) {
        this.sendMessage = sendMessageFn;
        this.config = {
            maxQueueSize: options.maxQueueSize || 10,
            timeout: options.timeout || 30000, // 30秒
            maxRetries: options.maxRetries || 2,
            retryBaseDelay: options.retryBaseDelay || 1000, // 1秒
            debugMode: options.debugMode !== undefined ? options.debugMode : false
        };

        // 生産者・消費者キュー
        this.pendingQueue = []; // 未送信のリクエスト（生産者が追加）
        this.processingQueue = []; // 処理中のリクエスト（消費者が処理）

        // 統計情報
        this.stats = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0,
            retriedRequests: 0,
            timeoutRequests: 0
        };
    }

    /**
     * リクエストをキューに追加（生産者）
     *
     * 目的:
     *   リクエストが来たらキューに入れるだけ
     *   フラグチェック不要
     *
     * @param request - リクエストオブジェクト
     * @returns Promise<string> - レスポンスID
     */
    enqueue(request: T): Promise<string> {
        return new Promise((resolve, reject) => {
            // ✅ 並発制御: 処理中のリクエストがある場合は即座に拒否
            if (this.processingQueue.length > 0) {
                const error = new Error('Previous response is still in progress');
                defaultLogger.warn('[ResponseQueue] 並発リクエストを拒否:', {
                    processing: this.processingQueue.length,
                    pending: this.pendingQueue.length
                });
                reject(error);
                return;
            }

            // キューが満杯かチェック
            const totalInQueue = this.pendingQueue.length + this.processingQueue.length;
            if (totalInQueue >= this.config.maxQueueSize) {
                reject(new Error('Queue is full'));
                return;
            }

            // キューに追加（生産）
            const item: QueueItem<T> = {
                request: request,
                resolve: resolve,
                reject: reject,
                timestamp: Date.now(),
                retryCount: 0
            };

            this.pendingQueue.push(item);
            this.stats.totalRequests++;

            if (this.config.debugMode) {
                defaultLogger.debug('[ResponseQueue] 生産:', {
                    pending: this.pendingQueue.length,
                    processing: this.processingQueue.length
                });
            }

            // 消費開始
            this.consume();
        });
    }

    /**
     * キューから消費（消費者）
     *
     * 目的:
     *   未送信キューから取り出してAPIに送信
     *   処理中キューに移動
     */
    private consume(): void {
        // 処理中が既にある場合は何もしない（1つずつ処理）
        if (this.processingQueue.length > 0) {
            if (this.config.debugMode) {
                defaultLogger.debug('[ResponseQueue] 処理中のリクエストがあるため待機:', {
                    processing: this.processingQueue.length
                });
            }
            return;
        }

        // 未送信キューが空の場合は何もしない
        if (this.pendingQueue.length === 0) {
            if (this.config.debugMode) {
                defaultLogger.debug('[ResponseQueue] 未送信キューが空です');
            }
            return;
        }

        // 未送信キューから取り出す
        const item = this.pendingQueue.shift();
        if (!item) {
            return;
        }

        // ✅ 重要: 処理中キューに追加してから送信
        // これにより、sendMessage()が同期的に実行されても、
        // 次のenqueue()呼び出しで processingQueue.length > 0 が検出される
        this.processingQueue.push(item);

        // タイムアウトタイマーを設定
        item.timeoutId = setTimeout(() => {
            this.handleTimeout(item);
        }, this.config.timeout);

        if (this.config.debugMode) {
            defaultLogger.debug('[ResponseQueue] 消費開始:', {
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length,
                retryCount: item.retryCount,
                timestamp: Date.now()
            });
        }

        try {
            // ✅ APIにリクエスト送信（同期実行）
            // この時点で processingQueue.length = 1 なので、
            // 新しいenqueue()は consume()をスキップする
            this.sendMessage({
                type: 'response.create',
                response: item.request
            });

            if (this.config.debugMode) {
                defaultLogger.debug('[ResponseQueue] リクエスト送信完了:', {
                    processing: this.processingQueue.length
                });
            }
        } catch (error) {
            defaultLogger.error('[ResponseQueue] 送信失敗:', error);
            // タイムアウトタイマーをクリア
            if (item.timeoutId) {
                clearTimeout(item.timeoutId);
            }
            // 処理中キューから削除
            this.processingQueue.shift();
            // リトライまたは失敗
            this.retryOrFail(item, error as Error);
        }
    }

    /**
     * タイムアウト処理
     */
    private handleTimeout(item: QueueItem<T>): void {
        const error = new Error(
            `Request timeout after ${this.config.timeout}ms (retry: ${item.retryCount}/${this.config.maxRetries})`
        );

        this.stats.timeoutRequests++;

        if (this.config.debugMode) {
            console.warn('[ResponseQueue] タイムアウト:', error.message);
        }

        // アイテムを処理キューから削除
        const index = this.processingQueue.indexOf(item);
        if (index !== -1) {
            this.processingQueue.splice(index, 1);
        }

        // リトライまたは失敗
        this.retryOrFail(item, error);
    }

    /**
     * リトライまたは失敗
     */
    private retryOrFail(item: QueueItem<T>, error: Error): void {
        if (item.retryCount < this.config.maxRetries) {
            // リトライ
            item.retryCount++;
            this.stats.retriedRequests++;

            // エクスポネンシャルバックオフ: 1s, 2s, 4s...
            const delay = this.config.retryBaseDelay * Math.pow(2, item.retryCount - 1);

            if (this.config.debugMode) {
                defaultLogger.debug('[ResponseQueue] リトライスケジュール:', {
                    retryCount: item.retryCount,
                    delay: `${delay}ms`,
                    error: error.message
                });
            }

            // 遅延後にキューに再追加
            setTimeout(() => {
                this.pendingQueue.unshift(item); // 優先的に処理
                this.consume();
            }, delay);
        } else {
            // 最大リトライ回数に達した
            if (item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;

            if (this.config.debugMode) {
                defaultLogger.error('[ResponseQueue] 最大リトライ回数到達:', error);
            }

            // 次を消費
            this.consume();
        }
    }

    /**
     * response.createdイベント処理
     *
     * @param responseId - レスポンスID
     */
    handleResponseCreated(responseId: string): void {
        if (this.config.debugMode) {
            defaultLogger.debug('[ResponseQueue] レスポンス作成:', responseId);
        }
    }

    /**
     * response.doneイベント処理（消費完了）
     *
     * 目的:
     *   処理中キューから削除
     *   次のリクエストを消費
     *
     * @param responseId - レスポンスID
     */
    handleResponseDone(responseId: string): void {
        if (this.config.debugMode) {
            defaultLogger.debug('[ResponseQueue] 消費完了:', responseId);
        }

        // 処理中キューから取り出す
        const item = this.processingQueue.shift();

        if (item) {
            // タイムアウトタイマーをクリア
            if (item.timeoutId) {
                clearTimeout(item.timeoutId);
            }

            // 完了通知
            if (item.resolve) {
                item.resolve(responseId);
            }
            this.stats.completedRequests++;
        }

        // 次を消費
        this.consume();
    }

    /**
     * エラー処理
     *
     * @param error - エラーオブジェクト
     */
    handleError(error: Error, code?: string): void {
        defaultLogger.error('[ResponseQueue] Error:', error);

        const errorCode = code || '';
        const errorMessage = error.message || '';
        const isActiveResponseError =
            errorCode === 'conversation_already_has_active_response' ||
            errorMessage.includes('conversation_already_has_active_response') ||
            errorMessage.includes('active response in progress');

        if (isActiveResponseError) {
            defaultLogger.warn(
                '[ResponseQueue] Active response still in progress; waiting for response.done.',
                {
                    code: errorCode || 'N/A',
                    pending: this.pendingQueue.length,
                    processing: this.processingQueue.length
                }
            );

            const item = this.processingQueue.shift();
            if (item && item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;

            return;
        }

        const item = this.processingQueue.shift();

        if (item) {
            if (item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;
        }

        this.consume();
    }

    /**
     * キューをクリア
     */
    clear(): void {
        if (this.config.debugMode) {
            defaultLogger.debug('[ResponseQueue] キューをクリア');
        }

        // すべてのリクエストを拒否＋タイムアウトタイマーをクリア
        [...this.pendingQueue, ...this.processingQueue].forEach((item) => {
            if (item.timeoutId) {
                clearTimeout(item.timeoutId);
            }
            if (item.reject) {
                item.reject(new Error('Queue cleared'));
            }
        });

        this.pendingQueue = [];
        this.processingQueue = [];
    }

    /**
     * 統計情報を取得
     *
     * @returns 統計情報
     */
    getStats(): QueueStats {
        return {
            ...this.stats,
            pendingCount: this.pendingQueue.length,
            processingCount: this.processingQueue.length
        };
    }

    /**
     * ステータスを取得（互換性のため）
     *
     * @returns ステータス情報
     */
    getStatus(): QueueStats {
        return this.getStats();
    }
}
