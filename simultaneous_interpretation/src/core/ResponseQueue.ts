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

/**
 * ResponseQueue設定オプション
 */
export interface ResponseQueueOptions {
    /** 最大キューサイズ */
    maxQueueSize?: number;
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
    /** 未送信キュー数 */
    pendingCount: number;
    /** 処理中キュー数 */
    processingCount: number;
}

/**
 * WebSocketメッセージ送信関数の型
 */
export type SendMessageFunction = (message: any) => void;

/**
 * ResponseQueue クラス
 * 
 * OpenAI Realtime APIのレスポンス管理を行うキュー。
 * 並発制御により、conversation_already_has_active_response エラーを防止します。
 */
export class ResponseQueue<T = any> {
    /** WebSocketメッセージ送信関数 */
    private sendMessage: SendMessageFunction;
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
    constructor(sendMessageFn: SendMessageFunction, options: ResponseQueueOptions = {}) {
        this.sendMessage = sendMessageFn;
        this.config = {
            maxQueueSize: options.maxQueueSize || 10,
            debugMode: options.debugMode !== undefined ? options.debugMode : false
        };

        // 生産者・消費者キュー
        this.pendingQueue = [];    // 未送信のリクエスト（生産者が追加）
        this.processingQueue = []; // 処理中のリクエスト（消費者が処理）

        // 統計情報
        this.stats = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0
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
                console.warn('[ResponseQueue] 並発リクエストを拒否:', {
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
                timestamp: Date.now()
            };

            this.pendingQueue.push(item);
            this.stats.totalRequests++;

            if (this.config.debugMode) {
                console.log('[ResponseQueue] 生産:', {
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
                console.log('[ResponseQueue] 処理中のリクエストがあるため待機:', {
                    processing: this.processingQueue.length
                });
            }
            return;
        }

        // 未送信キューが空の場合は何もしない
        if (this.pendingQueue.length === 0) {
            if (this.config.debugMode) {
                console.log('[ResponseQueue] 未送信キューが空です');
            }
            return;
        }

        // 未送信キューから取り出す
        const item = this.pendingQueue.shift();
        if (!item) return;

        // ✅ 重要: 処理中キューに追加してから送信
        // これにより、sendMessage()が同期的に実行されても、
        // 次のenqueue()呼び出しで processingQueue.length > 0 が検出される
        this.processingQueue.push(item);

        if (this.config.debugMode) {
            console.log('[ResponseQueue] 消費開始:', {
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length,
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
                console.log('[ResponseQueue] リクエスト送信完了:', {
                    processing: this.processingQueue.length
                });
            }
        } catch (error) {
            console.error('[ResponseQueue] 送信失敗:', error);
            // 処理中キューから削除
            this.processingQueue.shift();
            if (item.reject) {
                item.reject(error as Error);
            }
            this.stats.failedRequests++;
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
            console.log('[ResponseQueue] レスポンス作成:', responseId);
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
            console.log('[ResponseQueue] 消費完了:', responseId);
        }

        // 処理中キューから取り出す
        const item = this.processingQueue.shift();

        if (item) {
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
        console.error('[ResponseQueue] Error:', error);

        const errorCode = code || '';
        const errorMessage = error.message || '';
        const isActiveResponseError =
            errorCode === 'conversation_already_has_active_response' ||
            errorMessage.includes('conversation_already_has_active_response') ||
            errorMessage.includes('active response in progress');

        if (isActiveResponseError) {
            console.warn('[ResponseQueue] Active response still in progress; waiting for response.done.', {
                code: errorCode || 'N/A',
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length
            });

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
            console.log('[ResponseQueue] キューをクリア');
        }

        // すべてのリクエストを拒否
        [...this.pendingQueue, ...this.processingQueue].forEach(item => {
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

