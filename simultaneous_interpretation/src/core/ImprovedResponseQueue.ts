/**
 * ImprovedResponseQueue.ts
 *
 * 目的: 改善されたレスポンスキュー実装
 *
 * 機能:
 *   - ResponseStateManager と連携した厳格な状態管理
 *   - 並行制御の強化（isProcessing フラグ）
 *   - タイムアウト処理の改善
 *   - エラーハンドリングの強化
 *
 * 改善点:
 *   - ✅ 状態チェックの二重化（enqueue時 + processNext時）
 *   - ✅ setTimeout(0) による非同期化（競合回避）
 *   - ✅ isProcessing フラグによる多重実行防止
 *   - ✅ エラー時の状態復旧処理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { ResponseStateManager, ResponseState } from './ResponseStateManager';

/**
 * レスポンスリクエスト
 */
export interface ResponseRequest {
    /** モダリティ（'text', 'audio'） */
    modalities: string[];

    /** 指示文 */
    instructions: string;

    /** タイムスタンプ */
    timestamp?: number;

    /** リクエストID */
    requestId?: string;
}

/**
 * キューアイテム（内部使用）
 */
interface QueueItem {
    /** リクエスト */
    request: ResponseRequest;

    /** Promise resolve 関数 */
    resolve: (responseId: string) => void;

    /** Promise reject 関数 */
    reject: (error: Error) => void;

    /** タイムスタンプ */
    timestamp: number;

    /** リクエストID */
    requestId: string;
}

/**
 * キュー統計情報
 */
export interface QueueStats {
    /** ペンディングリクエスト数 */
    pendingCount: number;

    /** 処理中フラグ */
    isProcessing: boolean;

    /** 完了リクエスト数 */
    completedCount: number;

    /** 失敗リクエスト数 */
    failedCount: number;

    /** タイムアウトリクエスト数 */
    timeoutCount: number;
}

/**
 * キュー設定
 */
export interface QueueConfig {
    /** タイムアウト時間（ミリ秒） */
    timeout: number;

    /** デバッグモード */
    debugMode: boolean;

    /** 次のリクエスト処理前の遅延（ミリ秒） */
    processingDelay: number;
}

/**
 * 改善版レスポンスキュー
 *
 * 目的:
 *   ResponseStateManager と連携し、競合条件を防止しながら
 *   レスポンスリクエストを管理する
 */
export class ImprovedResponseQueue {
    /** ペンディングキュー */
    private pendingQueue: QueueItem[] = [];

    /** 状態マネージャー */
    private stateManager: ResponseStateManager;

    /** 処理中フラグ（多重実行防止） */
    private isProcessing = false;

    /** 統計情報 */
    private stats = {
        completed: 0,
        failed: 0,
        timeout: 0
    };

    /** 設定 */
    private config: QueueConfig;

    /** タイムアウトタイマー */
    private timeoutTimer: number | null = null;

    /** WebSocket 送信関数 */
    private sendFunction: ((message: { type: string; response: ResponseRequest }) => void) | null =
        null;

    /**
     * コンストラクタ
     *
     * @param stateManager - 状態マネージャー
     * @param config - キュー設定
     */
    constructor(stateManager: ResponseStateManager, config?: Partial<QueueConfig>) {
        this.stateManager = stateManager;
        this.config = {
            timeout: config?.timeout ?? 30000,
            debugMode: config?.debugMode ?? false,
            processingDelay: config?.processingDelay ?? 100
        };
    }

    /**
     * WebSocket 送信関数を設定
     *
     * @param sendFn - 送信関数
     */
    setSendFunction(sendFn: (message: { type: string; response: ResponseRequest }) => void): void {
        this.sendFunction = sendFn;
    }

    /**
     * リクエストをキューに追加
     *
     * @param request - レスポンスリクエスト
     * @returns レスポンスIDの Promise
     * @throws Error - レスポンス作成不可の場合
     */
    async enqueue(request: ResponseRequest): Promise<string> {
        // ✅ 状態チェック: 新しいレスポンスを作成できるか
        if (!this.stateManager.canCreateResponse()) {
            const currentState = this.stateManager.getState();
            const activeId = this.stateManager.getActiveResponseId();

            const error = new Error(
                `Cannot create response in state '${currentState}'. ` +
                    `Active response: ${activeId ?? 'none'}`
            );

            if (this.config.debugMode) {
                console.warn('[ImprovedResponseQueue] enqueue rejected:', {
                    state: currentState,
                    activeId,
                    pendingCount: this.pendingQueue.length
                });
            }

            throw error;
        }

        return new Promise((resolve, reject) => {
            const item: QueueItem = {
                request,
                resolve,
                reject,
                timestamp: Date.now(),
                requestId: this.generateRequestId()
            };

            this.pendingQueue.push(item);

            if (this.config.debugMode) {
                console.info('[ImprovedResponseQueue] Enqueued request:', {
                    requestId: item.requestId,
                    pendingCount: this.pendingQueue.length,
                    state: this.stateManager.getState()
                });
            }

            // ✅ 非同期で処理開始（競合回避のため setTimeout(0) を使用）
            setTimeout(() => this.processNext(), 0);
        });
    }

    /**
     * 次のリクエストを処理
     */
    private async processNext(): Promise<void> {
        // ✅ 処理中フラグチェック（多重実行防止）
        if (this.isProcessing) {
            if (this.config.debugMode) {
                console.info('[ImprovedResponseQueue] Already processing, skipping');
            }
            return;
        }

        // ✅ 状態チェック（再確認）
        if (!this.stateManager.canCreateResponse()) {
            if (this.config.debugMode) {
                console.info('[ImprovedResponseQueue] Cannot process: response active', {
                    state: this.stateManager.getState(),
                    activeId: this.stateManager.getActiveResponseId()
                });
            }
            return;
        }

        // ✅ キューが空なら終了
        const item = this.pendingQueue.shift();
        if (!item) {
            return;
        }

        this.isProcessing = true;

        try {
            if (this.config.debugMode) {
                console.info('[ImprovedResponseQueue] Processing request:', {
                    requestId: item.requestId,
                    state: this.stateManager.getState()
                });
            }

            // ✅ 状態遷移: RESPONSE_PENDING
            this.stateManager.transition(ResponseState.RESPONSE_PENDING);

            // リクエスト送信
            await this.sendRequest(item);

            // ✅ タイムアウトタイマー開始
            this.startTimeoutTimer(item);

            // 成功時は resolve しない（response.created で resolve する）
            // item.resolve() は response.created イベントで実行
        } catch (error) {
            // エラー時
            console.error('[ImprovedResponseQueue] Failed to send request:', error);

            this.stats.failed++;

            // ✅ 状態を IDLE に戻す
            try {
                this.stateManager.transition(ResponseState.IDLE);
            } catch (transitionError) {
                console.error(
                    '[ImprovedResponseQueue] Failed to transition to IDLE:',
                    transitionError
                );
                // 強制リセット
                this.stateManager.reset();
            }

            // reject
            item.reject(error as Error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * リクエストを送信
     *
     * @param item - キューアイテム
     * @returns レスポンスID（仮）
     */
    private async sendRequest(item: QueueItem): Promise<string> {
        if (!this.sendFunction) {
            throw new Error('[ImprovedResponseQueue] Send function not configured');
        }

        // WebSocket メッセージ送信
        this.sendFunction({
            type: 'response.create',
            response: item.request
        });

        // 仮のレスポンスID（実際のIDは response.created で取得）
        return item.requestId;
    }

    /**
     * レスポンス作成通知を処理
     *
     * @param responseId - レスポンスID
     */
    handleResponseCreated(responseId: string): void {
        // タイムアウトタイマーをクリア
        this.clearTimeoutTimer();

        // 統計更新
        this.stats.completed++;

        if (this.config.debugMode) {
            console.info('[ImprovedResponseQueue] Response created:', {
                responseId,
                stats: this.getStats()
            });
        }

        // 次のリクエストは response.done で処理
    }

    /**
     * レスポンス完了通知を処理
     *
     * @param responseId - レスポンスID
     */
    handleResponseDone(responseId: string): void {
        if (this.config.debugMode) {
            console.info('[ImprovedResponseQueue] Response done:', {
                responseId,
                pendingCount: this.pendingQueue.length
            });
        }

        // ✅ 次のリクエストを処理（遅延を入れて状態安定化）
        setTimeout(() => {
            this.processNext();
        }, this.config.processingDelay);
    }

    /**
     * エラー処理
     *
     * @param error - エラー
     * @param code - エラーコード
     */
    handleError(error: Error, code?: string): void {
        console.error('[ImprovedResponseQueue] Error:', error);

        // タイムアウトタイマーをクリア
        this.clearTimeoutTimer();

        // active response エラーの場合
        const isActiveResponseError =
            code === 'conversation_already_has_active_response' ||
            error.message.includes('conversation_already_has_active_response') ||
            error.message.includes('active response in progress');

        if (isActiveResponseError) {
            console.warn(
                '[ImprovedResponseQueue] Active response error - state conflict detected',
                {
                    code: code ?? 'N/A',
                    state: this.stateManager.getState(),
                    activeId: this.stateManager.getActiveResponseId()
                }
            );

            this.stats.failed++;

            // 状態を強制リセット
            this.stateManager.reset();
        } else {
            // ✅ 普通のエラーでも状態をリセット
            this.stats.failed++;
            this.stateManager.reset();
        }

        // ✅ 次のリクエストを処理（エラー後も継続）
        setTimeout(() => {
            this.processNext();
        }, this.config.processingDelay);
    }

    /**
     * タイムアウトタイマーを開始
     *
     * @param item - キューアイテム
     */
    private startTimeoutTimer(item: QueueItem): void {
        this.clearTimeoutTimer();

        this.timeoutTimer = window.setTimeout(() => {
            console.warn('[ImprovedResponseQueue] Request timeout:', {
                requestId: item.requestId,
                elapsed: Date.now() - item.timestamp
            });

            this.stats.timeout++;

            // reject
            item.reject(new Error('Request timeout'));

            // 状態を IDLE に戻す
            try {
                this.stateManager.transition(ResponseState.IDLE);
            } catch (error) {
                console.error('[ImprovedResponseQueue] Failed to transition to IDLE:', error);
                this.stateManager.reset();
            }

            // 次のリクエストを処理
            this.processNext();
        }, this.config.timeout);
    }

    /**
     * タイムアウトタイマーをクリア
     */
    private clearTimeoutTimer(): void {
        if (this.timeoutTimer !== null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    /**
     * 統計情報を取得
     *
     * @returns 統計情報
     */
    getStats(): QueueStats {
        return {
            pendingCount: this.pendingQueue.length,
            isProcessing: this.isProcessing,
            completedCount: this.stats.completed,
            failedCount: this.stats.failed,
            timeoutCount: this.stats.timeout
        };
    }

    /**
     * キューをクリア
     */
    clear(): void {
        console.warn('[ImprovedResponseQueue] Clearing queue:', {
            pendingCount: this.pendingQueue.length
        });

        // すべてのペンディングリクエストを reject
        this.pendingQueue.forEach((item) => {
            item.reject(new Error('Queue cleared'));
        });

        this.pendingQueue = [];
        this.clearTimeoutTimer();
        this.isProcessing = false;
    }

    /**
     * リクエストIDを生成
     *
     * @returns リクエストID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * デバッグ情報を取得
     *
     * @returns デバッグ情報
     */
    getDebugInfo(): {
        stats: QueueStats;
        config: QueueConfig;
        stateInfo: ReturnType<ResponseStateManager['getDebugInfo']>;
    } {
        return {
            stats: this.getStats(),
            config: this.config,
            stateInfo: this.stateManager.getDebugInfo()
        };
    }
}
