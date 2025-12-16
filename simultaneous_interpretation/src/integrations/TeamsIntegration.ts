/**
 * Microsoft Teams 統合
 *
 * @description
 * Microsoft Teams との統合を提供。
 * 会議状態の監視、音声キャプチャ、参加者情報取得。
 *
 * @features
 * - Teams 会議検出
 * - 会議状態監視
 * - 参加者情報取得
 * - 自動音声キャプチャ
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import {
    MeetingIntegration,
    MeetingState,
    MeetingInfo,
    MeetingIntegrationConfig
} from './MeetingIntegration';
import { SystemAudioCapture } from '../audio/SystemAudioCapture';
import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Teams 統合クラス
 */
export class TeamsIntegration extends MeetingIntegration {
    private audioCapture: SystemAudioCapture;
    private teamsWindowId: string | null = null;

    /**
     * コンストラクタ
     *
     * @param config - 会議統合設定
     */
    constructor(config: Partial<MeetingIntegrationConfig> = {}) {
        super(config);

        this.audioCapture = new SystemAudioCapture();

        logger.info('TeamsIntegration initialized');
    }

    /**
     * Teams に接続
     */
    public async connect(): Promise<void> {
        try {
            this.setState(MeetingState.CONNECTING);

            // Teams ウィンドウを検出
            await this.detectTeamsWindow();

            if (!this.teamsWindowId) {
                throw new Error('Teams window not found');
            }

            this.setState(MeetingState.CONNECTED);

            // ポーリング開始
            this.startPolling();

            // 自動音声キャプチャ
            if (this.config.autoCapture) {
                await this.startAudioCapture();
            }

            logger.info('Connected to Teams');
        } catch (error) {
            this.setState(MeetingState.ERROR);
            logger.error('Failed to connect to Teams', error);
            throw error;
        }
    }

    /**
     * Teams から切断
     */
    public async disconnect(): Promise<void> {
        try {
            this.stopPolling();
            this.stopAudioCapture();

            this.teamsWindowId = null;
            this.meetingInfo = null;

            this.setState(MeetingState.DISCONNECTED);

            logger.info('Disconnected from Teams');
        } catch (error) {
            logger.error('Failed to disconnect from Teams', error);
            throw error;
        }
    }

    /**
     * Teams ウィンドウを検出
     *
     * @private
     */
    private async detectTeamsWindow(): Promise<void> {
        const meetingApps = await this.audioCapture.detectMeetingApps();

        const teamsApp = meetingApps.find((app) => app.name.toLowerCase().includes('teams'));

        if (teamsApp) {
            this.teamsWindowId = teamsApp.id;
            logger.info('Teams window detected', { id: teamsApp.id });
        } else {
            logger.warn('Teams window not found');
        }
    }

    /**
     * 音声キャプチャを開始
     *
     * @private
     */
    private async startAudioCapture(): Promise<void> {
        if (!this.teamsWindowId) {
            logger.warn('Cannot start audio capture: Teams window not found');
            return;
        }

        try {
            const stream = await this.audioCapture.captureSystemAudio(this.teamsWindowId);

            this.emit('audio-captured', stream);

            logger.info('Teams audio capture started');
        } catch (error) {
            logger.error('Failed to start audio capture', error);
        }
    }

    /**
     * 音声キャプチャを停止
     *
     * @private
     */
    private stopAudioCapture(): void {
        this.audioCapture.stopCapture();
        logger.info('Teams audio capture stopped');
    }

    /**
     * 会議情報を取得
     *
     * @protected
     */
    protected async fetchMeetingInfo(): Promise<MeetingInfo | null> {
        // 実際の実装では Teams API を使用
        // ここではモック実装

        if (!this.teamsWindowId) {
            return null;
        }

        // Teams ウィンドウが存在するかチェック
        const sources = await this.audioCapture.getAvailableSources();
        const teamsWindow = sources.find((s) => s.id === this.teamsWindowId);

        if (!teamsWindow) {
            return null;
        }

        // モック会議情報
        return {
            id: 'teams-meeting-1',
            name: 'Teams Meeting',
            startTime: new Date(),
            participantCount: 1,
            participants: [
                {
                    id: 'user-1',
                    name: 'Current User',
                    isMuted: false,
                    isVideoOn: true,
                    isSpeaking: false
                }
            ]
        };
    }

    /**
     * クリーンアップ
     */
    public override dispose(): void {
        this.stopAudioCapture();
        this.audioCapture.dispose();
        super.dispose();
        logger.info('TeamsIntegration disposed');
    }
}
