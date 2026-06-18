/**
 * ResponseStateManager.ts
 *
 * 目的: レスポンス状態管理（ステートマシン実装）
 *
 * 機能:
 *   - OpenAI Realtime API のレスポンス状態を厳格に管理
 *   - 状態遷移の妥当性チェック
 *   - 競合条件の防止
 *
 * 注意:
 *   - OpenAI Realtime API は同時に1つのレスポンスしか処理できない
 *   - すべての状態遷移は isValidTransition() で検証される
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * レスポンス状態
 *
 * 状態遷移フロー:
 *   IDLE → BUFFERING → COMMITTED → PENDING → ACTIVE → COMPLETING → IDLE
 */
export enum ResponseState {
    /** 空閑状態（新しいレスポンス作成可能） */
    IDLE = 'idle',

    /** 音声バッファリング中 */
    AUDIO_BUFFERING = 'buffering',

    /** 音声バッファコミット済み */
    AUDIO_COMMITTED = 'committed',

    /** レスポンス作成リクエスト送信済み */
    RESPONSE_PENDING = 'pending',

    /** レスポンス処理中（OpenAI処理中） */
    RESPONSE_ACTIVE = 'active',

    /** レスポンス完了処理中 */
    RESPONSE_COMPLETING = 'completing'
}

/**
 * 状態遷移イベント
 */
export interface StateTransitionEvent {
    /** 遷移前の状態 */
    from: ResponseState;

    /** 遷移後の状態 */
    to: ResponseState;

    /** レスポンスID */
    responseId?: string;

    /** タイムスタンプ */
    timestamp: number;
}

/**
 * 状態遷移リスナー
 */
export type StateTransitionListener = (event: StateTransitionEvent) => void;

/**
 * レスポンス状態マネージャー
 *
 * 目的: レスポンスの状態を厳格に管理し、競合を防止
 */
export class ResponseStateManager {
    /** 現在の状態 */
    private state: ResponseState = ResponseState.IDLE;

    /** 現在処理中のレスポンスID */
    private activeResponseId: string | null = null;

    /** 状態遷移履歴（デバッグ用） */
    private transitionHistory: StateTransitionEvent[] = [];

    /** 状態遷移リスナー */
    private listeners: StateTransitionListener[] = [];

    /** 履歴の最大保持数 */
    private readonly maxHistorySize = 50;

    /**
     * 有効な状態遷移のマップ
     */
    private readonly validTransitions: Record<ResponseState, ResponseState[]> = {
        [ResponseState.IDLE]: [
            ResponseState.AUDIO_BUFFERING,
            ResponseState.RESPONSE_PENDING // ✅ 音声バッファなしの直接リクエスト
        ],

        [ResponseState.AUDIO_BUFFERING]: [
            ResponseState.AUDIO_COMMITTED,
            ResponseState.IDLE // キャンセル時
        ],

        [ResponseState.AUDIO_COMMITTED]: [
            ResponseState.RESPONSE_PENDING,
            ResponseState.IDLE // エラー時
        ],

        [ResponseState.RESPONSE_PENDING]: [
            ResponseState.RESPONSE_ACTIVE,
            ResponseState.IDLE // エラー時
        ],

        [ResponseState.RESPONSE_ACTIVE]: [ResponseState.RESPONSE_COMPLETING],

        [ResponseState.RESPONSE_COMPLETING]: [ResponseState.IDLE]
    };

    /**
     * 新しいレスポンスを作成できるか判定
     *
     * @returns true: 作成可能、false: 作成不可
     */
    canCreateResponse(): boolean {
        return this.state === ResponseState.IDLE || this.state === ResponseState.AUDIO_BUFFERING;
    }

    /**
     * 状態遷移を実行
     *
     * @param newState - 新しい状態
     * @param responseId - レスポンスID（オプショナル）
     * @throws Error - 不正な状態遷移の場合
     */
    transition(newState: ResponseState, responseId?: string): void {
        // 状態遷移の妥当性チェック
        if (!this.isValidTransition(this.state, newState)) {
            throw new Error(
                `[ResponseStateManager] Invalid state transition: ${this.state} → ${newState}`
            );
        }

        const event: StateTransitionEvent = {
            from: this.state,
            to: newState,
            ...(responseId ? { responseId } : {}),
            timestamp: Date.now()
        };

        // 状態を更新
        this.state = newState;

        // レスポンスIDを更新
        if (newState === ResponseState.RESPONSE_ACTIVE && responseId) {
            this.activeResponseId = responseId;
        } else if (newState === ResponseState.IDLE) {
            this.activeResponseId = null;
        }

        // 履歴に記録
        this.addToHistory(event);

        // リスナーに通知
        this.notifyListeners(event);

        // ログ出力
        console.info(`[State] ${event.from} → ${event.to}`, {
            responseId: responseId ?? 'N/A',
            timestamp: event.timestamp
        });
    }

    /**
     * 状態遷移が有効かチェック
     *
     * @param from - 遷移元の状態
     * @param to - 遷移先の状態
     * @returns true: 有効、false: 無効
     */
    private isValidTransition(from: ResponseState, to: ResponseState): boolean {
        const allowedTransitions = this.validTransitions[from];
        return allowedTransitions?.includes(to) ?? false;
    }

    /**
     * 現在の状態を取得
     *
     * @returns 現在の状態
     */
    getState(): ResponseState {
        return this.state;
    }

    /**
     * 現在処理中のレスポンスIDを取得
     *
     * @returns レスポンスID（処理中でない場合はnull）
     */
    getActiveResponseId(): string | null {
        return this.activeResponseId;
    }

    /**
     * 状態が特定の状態かチェック
     *
     * @param state - チェックする状態
     * @returns true: 一致、false: 不一致
     */
    isInState(state: ResponseState): boolean {
        return this.state === state;
    }

    /**
     * レスポンスが処理中かチェック
     *
     * @returns true: 処理中、false: 処理中でない
     */
    isProcessing(): boolean {
        return (
            this.state === ResponseState.RESPONSE_PENDING ||
            this.state === ResponseState.RESPONSE_ACTIVE ||
            this.state === ResponseState.RESPONSE_COMPLETING
        );
    }

    /**
     * 状態遷移リスナーを追加
     *
     * @param listener - リスナー関数
     */
    addListener(listener: StateTransitionListener): void {
        this.listeners.push(listener);
    }

    /**
     * 状態遷移リスナーを削除
     *
     * @param listener - リスナー関数
     */
    removeListener(listener: StateTransitionListener): void {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * すべてのリスナーに通知
     *
     * @param event - 状態遷移イベント
     */
    private notifyListeners(event: StateTransitionEvent): void {
        this.listeners.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.error('[ResponseStateManager] Listener error:', error);
            }
        });
    }

    /**
     * 履歴に追加
     *
     * @param event - 状態遷移イベント
     */
    private addToHistory(event: StateTransitionEvent): void {
        this.transitionHistory.push(event);

        // 履歴サイズを制限
        if (this.transitionHistory.length > this.maxHistorySize) {
            this.transitionHistory.shift();
        }
    }

    /**
     * 状態遷移履歴を取得
     *
     * @param count - 取得する履歴数（デフォルト: 10）
     * @returns 状態遷移履歴
     */
    getHistory(count = 10): StateTransitionEvent[] {
        return this.transitionHistory.slice(-count);
    }

    /**
     * 状態をリセット（エラーリカバリー用）
     *
     * 注意: この操作は慎重に使用すること
     */
    reset(): void {
        console.warn('[ResponseStateManager] Resetting state to IDLE');

        const event: StateTransitionEvent = {
            from: this.state,
            to: ResponseState.IDLE,
            timestamp: Date.now()
        };

        this.state = ResponseState.IDLE;
        this.activeResponseId = null;

        this.addToHistory(event);
        this.notifyListeners(event);
    }

    /**
     * デバッグ情報を取得
     *
     * @returns デバッグ情報
     */
    getDebugInfo(): {
        state: ResponseState;
        activeResponseId: string | null;
        isProcessing: boolean;
        canCreateResponse: boolean;
        historyCount: number;
        listenerCount: number;
    } {
        return {
            state: this.state,
            activeResponseId: this.activeResponseId,
            isProcessing: this.isProcessing(),
            canCreateResponse: this.canCreateResponse(),
            historyCount: this.transitionHistory.length,
            listenerCount: this.listeners.length
        };
    }
}
