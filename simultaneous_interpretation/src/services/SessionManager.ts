/**
 * セッション管理システム
 *
 * @description
 * OpenAI Realtime API のセッション管理を行うクラス。
 * セッションの作成、更新、一時停止、再開、終了を管理。
 *
 * @features
 * - セッションライフサイクル管理
 * - セッション状態の永続化
 * - セッション設定の動的更新
 * - セッション統計の追跡
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';
import { SessionConfig } from '../types/websocket.types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * セッション状態
 */
export enum SessionState {
    IDLE = 'idle',
    CREATING = 'creating',
    ACTIVE = 'active',
    PAUSED = 'paused',
    RESUMING = 'resuming',
    TERMINATING = 'terminating',
    TERMINATED = 'terminated',
    ERROR = 'error'
}

/**
 * セッション情報
 */
export interface SessionInfo {
    /** セッション ID */
    id: string;
    /** セッション状態 */
    state: SessionState;
    /** セッション設定 */
    config: SessionConfig;
    /** 作成日時 */
    createdAt: Date;
    /** 更新日時 */
    updatedAt: Date;
    /** 一時停止日時 */
    pausedAt?: Date | undefined;
    /** 終了日時 */
    terminatedAt?: Date | undefined;
}

/**
 * セッション統計
 */
export interface SessionStats {
    /** 総セッション時間（秒） */
    totalDuration: number;
    /** アクティブ時間（秒） */
    activeDuration: number;
    /** 一時停止時間（秒） */
    pausedDuration: number;
    /** 送信メッセージ数 */
    messagesSent: number;
    /** 受信メッセージ数 */
    messagesReceived: number;
    /** エラー数 */
    errorCount: number;
}

/**
 * セッションイベントハンドラ
 */
export interface SessionEventHandlers {
    onStateChange?: (oldState: SessionState, newState: SessionState) => void;
    onCreated?: (sessionInfo: SessionInfo) => void;
    onUpdated?: (sessionInfo: SessionInfo) => void;
    onPaused?: (sessionInfo: SessionInfo) => void;
    onResumed?: (sessionInfo: SessionInfo) => void;
    onTerminated?: (sessionInfo: SessionInfo) => void;
    onError?: (error: Error) => void;
}

/**
 * セッション管理クラス
 */
export class SessionManager {
    private sessionInfo: SessionInfo | null = null;
    private stats: SessionStats;
    private eventHandlers: SessionEventHandlers = {};
    private stateChangeListeners: Array<(state: SessionState) => void> = [];

    // タイマー
    private durationTimer: NodeJS.Timeout | null = null;
    private lastActiveTime: number = 0;

    /**
     * コンストラクタ
     *
     * @param eventHandlers - イベントハンドラ
     */
    constructor(eventHandlers: SessionEventHandlers = {}) {
        this.eventHandlers = eventHandlers;
        this.stats = this.createEmptyStats();

        logger.info('SessionManager initialized');
    }

    /**
     * セッションを作成
     *
     * @param config - セッション設定
     * @returns セッション情報
     */
    public async createSession(config: SessionConfig): Promise<SessionInfo> {
        if (this.sessionInfo && this.sessionInfo.state !== SessionState.TERMINATED) {
            throw new Error('Session already exists. Terminate current session first.');
        }

        this.changeState(SessionState.CREATING);

        try {
            const sessionInfo: SessionInfo = {
                id: this.generateSessionId(),
                state: SessionState.ACTIVE,
                config: { ...config },
                createdAt: new Date(),
                updatedAt: new Date()
            };

            this.sessionInfo = sessionInfo;
            this.stats = this.createEmptyStats();
            this.lastActiveTime = Date.now();

            // 統計タイマー開始
            this.startDurationTimer();

            // 永続化
            this.persistSession();

            this.changeState(SessionState.ACTIVE);

            if (this.eventHandlers.onCreated) {
                this.eventHandlers.onCreated(sessionInfo);
            }

            logger.info('Session created', { sessionId: sessionInfo.id });

            return sessionInfo;
        } catch (error) {
            this.changeState(SessionState.ERROR);
            logger.error('Failed to create session', error);
            throw error;
        }
    }

    /**
     * セッションを更新
     *
     * @param config - 新しいセッション設定
     */
    public updateSession(config: Partial<SessionConfig>): void {
        if (!this.sessionInfo) {
            throw new Error('No active session');
        }

        if (this.sessionInfo.state !== SessionState.ACTIVE) {
            throw new Error(`Cannot update session in ${this.sessionInfo.state} state`);
        }

        // 設定を更新
        Object.assign(this.sessionInfo.config, config);
        this.sessionInfo.updatedAt = new Date();

        // 永続化
        this.persistSession();

        if (this.eventHandlers.onUpdated) {
            this.eventHandlers.onUpdated(this.sessionInfo);
        }

        logger.info('Session updated', { sessionId: this.sessionInfo.id });
    }

    /**
     * セッションを一時停止
     */
    public pauseSession(): void {
        if (!this.sessionInfo) {
            throw new Error('No active session');
        }

        if (this.sessionInfo.state !== SessionState.ACTIVE) {
            throw new Error(`Cannot pause session in ${this.sessionInfo.state} state`);
        }

        this.changeState(SessionState.PAUSED);
        this.sessionInfo.pausedAt = new Date();
        this.sessionInfo.updatedAt = new Date();

        // タイマー停止
        this.stopDurationTimer();

        // 永続化
        this.persistSession();

        if (this.eventHandlers.onPaused) {
            this.eventHandlers.onPaused(this.sessionInfo);
        }

        logger.info('Session paused', { sessionId: this.sessionInfo.id });
    }

    /**
     * セッションを再開
     */
    public resumeSession(): void {
        if (!this.sessionInfo) {
            throw new Error('No active session');
        }

        if (this.sessionInfo.state !== SessionState.PAUSED) {
            throw new Error(`Cannot resume session in ${this.sessionInfo.state} state`);
        }

        this.changeState(SessionState.RESUMING);

        // 一時停止時間を計算
        if (this.sessionInfo.pausedAt) {
            const pausedDuration = (Date.now() - this.sessionInfo.pausedAt.getTime()) / 1000;
            this.stats.pausedDuration += pausedDuration;
        }

        this.sessionInfo.pausedAt = undefined;
        this.sessionInfo.updatedAt = new Date();
        this.lastActiveTime = Date.now();

        // タイマー再開
        this.startDurationTimer();

        this.changeState(SessionState.ACTIVE);

        // 永続化
        this.persistSession();

        if (this.eventHandlers.onResumed) {
            this.eventHandlers.onResumed(this.sessionInfo);
        }

        logger.info('Session resumed', { sessionId: this.sessionInfo.id });
    }

    /**
     * セッションを終了
     */
    public terminateSession(): void {
        if (!this.sessionInfo) {
            logger.warn('No active session to terminate');
            return;
        }

        this.changeState(SessionState.TERMINATING);

        this.sessionInfo.terminatedAt = new Date();
        this.sessionInfo.updatedAt = new Date();

        // タイマー停止
        this.stopDurationTimer();

        this.changeState(SessionState.TERMINATED);

        // 永続化
        this.persistSession();

        if (this.eventHandlers.onTerminated) {
            this.eventHandlers.onTerminated(this.sessionInfo);
        }

        logger.info('Session terminated', {
            sessionId: this.sessionInfo.id,
            stats: this.stats
        });
    }

    /**
     * セッション情報を取得
     *
     * @returns セッション情報
     */
    public getSessionInfo(): SessionInfo | null {
        return this.sessionInfo ? { ...this.sessionInfo } : null;
    }

    /**
     * セッション統計を取得
     *
     * @returns セッション統計
     */
    public getStats(): SessionStats {
        return { ...this.stats };
    }

    /**
     * メッセージ送信をカウント
     */
    public incrementMessagesSent(): void {
        this.stats.messagesSent++;
    }

    /**
     * メッセージ受信をカウント
     */
    public incrementMessagesReceived(): void {
        this.stats.messagesReceived++;
    }

    /**
     * エラーをカウント
     */
    public incrementErrorCount(): void {
        this.stats.errorCount++;
    }

    /**
     * 状態変更リスナーを追加
     *
     * @param listener - リスナー関数
     */
    public addStateChangeListener(listener: (state: SessionState) => void): void {
        this.stateChangeListeners.push(listener);
    }

    /**
     * 状態変更リスナーを削除
     *
     * @param listener - リスナー関数
     */
    public removeStateChangeListener(listener: (state: SessionState) => void): void {
        const index = this.stateChangeListeners.indexOf(listener);
        if (index > -1) {
            this.stateChangeListeners.splice(index, 1);
        }
    }

    /**
     * 状態を変更
     *
     * @private
     * @param newState - 新しい状態
     */
    private changeState(newState: SessionState): void {
        const oldState = this.sessionInfo?.state ?? SessionState.IDLE;

        if (this.sessionInfo) {
            this.sessionInfo.state = newState;
        }

        // イベントハンドラ呼び出し
        if (this.eventHandlers.onStateChange) {
            this.eventHandlers.onStateChange(oldState, newState);
        }

        // リスナー通知
        this.stateChangeListeners.forEach((listener) => listener(newState));

        logger.debug('Session state changed', { oldState, newState });
    }

    /**
     * セッション ID を生成
     *
     * @private
     * @returns セッション ID
     */
    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * 空の統計を作成
     *
     * @private
     * @returns 空の統計
     */
    private createEmptyStats(): SessionStats {
        return {
            totalDuration: 0,
            activeDuration: 0,
            pausedDuration: 0,
            messagesSent: 0,
            messagesReceived: 0,
            errorCount: 0
        };
    }

    /**
     * 統計タイマーを開始
     *
     * @private
     */
    private startDurationTimer(): void {
        this.stopDurationTimer();

        this.durationTimer = setInterval(() => {
            if (this.sessionInfo && this.sessionInfo.state === SessionState.ACTIVE) {
                const now = Date.now();
                const elapsed = (now - this.lastActiveTime) / 1000;
                this.stats.activeDuration += elapsed;
                this.stats.totalDuration += elapsed;
                this.lastActiveTime = now;
            }
        }, 1000);
    }

    /**
     * 統計タイマーを停止
     *
     * @private
     */
    private stopDurationTimer(): void {
        if (this.durationTimer) {
            clearInterval(this.durationTimer);
            this.durationTimer = null;
        }
    }

    /**
     * セッションを永続化
     *
     * @private
     */
    private persistSession(): void {
        if (!this.sessionInfo) {
            return;
        }

        try {
            const data = {
                sessionInfo: this.sessionInfo,
                stats: this.stats
            };

            localStorage.setItem('voicetranslate_session', JSON.stringify(data));
            logger.debug('Session persisted');
        } catch (error) {
            logger.error('Failed to persist session', error);
        }
    }

    /**
     * セッションを復元
     *
     * @returns 復元されたセッション情報
     */
    public restoreSession(): SessionInfo | null {
        try {
            const data = localStorage.getItem('voicetranslate_session');
            if (!data) {
                return null;
            }

            const parsed = JSON.parse(data);
            this.sessionInfo = {
                ...parsed.sessionInfo,
                createdAt: new Date(parsed.sessionInfo.createdAt),
                updatedAt: new Date(parsed.sessionInfo.updatedAt),
                pausedAt: parsed.sessionInfo.pausedAt
                    ? new Date(parsed.sessionInfo.pausedAt)
                    : undefined,
                terminatedAt: parsed.sessionInfo.terminatedAt
                    ? new Date(parsed.sessionInfo.terminatedAt)
                    : undefined
            };
            this.stats = parsed.stats;

            if (this.sessionInfo) {
                logger.info('Session restored', { sessionId: this.sessionInfo.id });
            }

            return this.sessionInfo;
        } catch (error) {
            logger.error('Failed to restore session', error);
            return null;
        }
    }

    /**
     * 永続化されたセッションをクリア
     */
    public clearPersistedSession(): void {
        try {
            localStorage.removeItem('voicetranslate_session');
            logger.debug('Persisted session cleared');
        } catch (error) {
            logger.error('Failed to clear persisted session', error);
        }
    }
}
