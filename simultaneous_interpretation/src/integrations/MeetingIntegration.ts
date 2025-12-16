/**
 * 会議統合基底クラス
 *
 * @description
 * Teams/Zoom などの会議アプリケーション統合の基底クラス。
 * 会議状態の監視、音声キャプチャ、自動制御を提供。
 *
 * @features
 * - 会議状態監視
 * - 音声キャプチャ自動化
 * - 参加者情報取得
 * - イベント通知
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';
import { EventEmitter } from 'events';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 会議状態
 */
export enum MeetingState {
    /** 未接続 */
    DISCONNECTED = 'disconnected',
    /** 接続中 */
    CONNECTING = 'connecting',
    /** 接続済み */
    CONNECTED = 'connected',
    /** 会議中 */
    IN_MEETING = 'in_meeting',
    /** エラー */
    ERROR = 'error'
}

/**
 * 参加者情報
 */
export interface Participant {
    /** 参加者 ID */
    id: string;
    /** 参加者名 */
    name: string;
    /** ミュート状態 */
    isMuted: boolean;
    /** ビデオ状態 */
    isVideoOn: boolean;
    /** 発言中 */
    isSpeaking: boolean;
}

/**
 * 会議情報
 */
export interface MeetingInfo {
    /** 会議 ID */
    id: string;
    /** 会議名 */
    name: string;
    /** 開始時刻 */
    startTime: Date;
    /** 参加者数 */
    participantCount: number;
    /** 参加者一覧 */
    participants: Participant[];
}

/**
 * 会議統合設定
 */
export interface MeetingIntegrationConfig {
    /** 自動接続 */
    autoConnect: boolean;
    /** 自動音声キャプチャ */
    autoCapture: boolean;
    /** ポーリング間隔（ミリ秒） */
    pollingInterval: number;
}

/**
 * 会議統合基底クラス
 */
export abstract class MeetingIntegration extends EventEmitter {
    protected config: MeetingIntegrationConfig;
    protected state: MeetingState = MeetingState.DISCONNECTED;
    protected meetingInfo: MeetingInfo | null = null;
    protected pollingTimer: NodeJS.Timeout | null = null;

    /**
     * コンストラクタ
     *
     * @param config - 会議統合設定
     */
    constructor(config: Partial<MeetingIntegrationConfig> = {}) {
        super();

        this.config = {
            autoConnect: config.autoConnect ?? false,
            autoCapture: config.autoCapture ?? true,
            pollingInterval: config.pollingInterval ?? 5000
        };

        logger.info('MeetingIntegration initialized', {
            autoConnect: this.config.autoConnect,
            autoCapture: this.config.autoCapture
        });
    }

    /**
     * 会議に接続
     *
     * @abstract
     */
    public abstract connect(): Promise<void>;

    /**
     * 会議から切断
     *
     * @abstract
     */
    public abstract disconnect(): Promise<void>;

    /**
     * 会議情報を取得
     *
     * @abstract
     */
    protected abstract fetchMeetingInfo(): Promise<MeetingInfo | null>;

    /**
     * 会議状態を取得
     */
    public getState(): MeetingState {
        return this.state;
    }

    /**
     * 会議情報を取得
     */
    public getMeetingInfo(): MeetingInfo | null {
        return this.meetingInfo;
    }

    /**
     * 会議中かチェック
     */
    public isInMeeting(): boolean {
        return this.state === MeetingState.IN_MEETING;
    }

    /**
     * 状態を設定
     *
     * @protected
     * @param newState - 新しい状態
     */
    protected setState(newState: MeetingState): void {
        const oldState = this.state;
        this.state = newState;

        if (oldState !== newState) {
            logger.info('Meeting state changed', {
                from: oldState,
                to: newState
            });

            this.emit('state-changed', {
                oldState,
                newState
            });
        }
    }

    /**
     * ポーリングを開始
     *
     * @protected
     */
    protected startPolling(): void {
        if (this.pollingTimer) {
            return;
        }

        this.pollingTimer = setInterval(async () => {
            await this.poll();
        }, this.config.pollingInterval);

        logger.info('Polling started', {
            interval: this.config.pollingInterval
        });
    }

    /**
     * ポーリングを停止
     *
     * @protected
     */
    protected stopPolling(): void {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
            logger.info('Polling stopped');
        }
    }

    /**
     * ポーリング処理
     *
     * @protected
     */
    protected async poll(): Promise<void> {
        try {
            const info = await this.fetchMeetingInfo();

            if (info) {
                const oldInfo = this.meetingInfo;
                this.meetingInfo = info;

                // 会議状態を更新
                if (this.state !== MeetingState.IN_MEETING) {
                    this.setState(MeetingState.IN_MEETING);
                }

                // 会議情報が変更された場合
                if (!oldInfo || oldInfo.id !== info.id) {
                    this.emit('meeting-joined', info);
                }

                // 参加者が変更された場合
                if (oldInfo && oldInfo.participantCount !== info.participantCount) {
                    this.emit('participants-changed', info.participants);
                }
            } else {
                // 会議が終了した場合
                if (this.meetingInfo) {
                    this.emit('meeting-left', this.meetingInfo);
                    this.meetingInfo = null;
                }

                if (this.state === MeetingState.IN_MEETING) {
                    this.setState(MeetingState.CONNECTED);
                }
            }
        } catch (error) {
            logger.error('Polling error', error);
            this.emit('error', error);
        }
    }

    /**
     * クリーンアップ
     */
    public dispose(): void {
        this.stopPolling();
        this.removeAllListeners();
        logger.info('MeetingIntegration disposed');
    }
}
