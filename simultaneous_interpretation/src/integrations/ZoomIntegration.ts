/**
 * Zoom 統合
 *
 * @description
 * Zoom との統合を提供。
 * 会議状態の監視、音声キャプチャ、参加者情報取得。
 *
 * @features
 * - Zoom 会議検出
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
 * Zoom 統合クラス
 */
export class ZoomIntegration extends MeetingIntegration {
    private audioCapture: SystemAudioCapture;
    private zoomWindowId: string | null = null;

    /**
     * コンストラクタ
     *
     * @param config - 会議統合設定
     */
    constructor(config: Partial<MeetingIntegrationConfig> = {}) {
        super(config);

        this.audioCapture = new SystemAudioCapture();

        logger.info('ZoomIntegration initialized');
    }

    /**
     * Zoom に接続
     */
    public async connect(): Promise<void> {
        try {
            this.setState(MeetingState.CONNECTING);

            // Zoom ウィンドウを検出
            await this.detectZoomWindow();

            if (!this.zoomWindowId) {
                throw new Error('Zoom window not found');
            }

            this.setState(MeetingState.CONNECTED);

            // ポーリング開始
            this.startPolling();

            // 自動音声キャプチャ
            if (this.config.autoCapture) {
                await this.startAudioCapture();
            }

            logger.info('Connected to Zoom');
        } catch (error) {
            this.setState(MeetingState.ERROR);
            logger.error('Failed to connect to Zoom', error);
            throw error;
        }
    }

    /**
     * Zoom から切断
     */
    public async disconnect(): Promise<void> {
        try {
            this.stopPolling();
            this.stopAudioCapture();

            this.zoomWindowId = null;
            this.meetingInfo = null;

            this.setState(MeetingState.DISCONNECTED);

            logger.info('Disconnected from Zoom');
        } catch (error) {
            logger.error('Failed to disconnect from Zoom', error);
            throw error;
        }
    }

    /**
     * Zoom ウィンドウを検出
     *
     * @private
     */
    private async detectZoomWindow(): Promise<void> {
        const meetingApps = await this.audioCapture.detectMeetingApps();

        const zoomApp = meetingApps.find((app) => app.name.toLowerCase().includes('zoom'));

        if (zoomApp) {
            this.zoomWindowId = zoomApp.id;
            logger.info('Zoom window detected', { id: zoomApp.id });
        } else {
            logger.warn('Zoom window not found');
        }
    }

    /**
     * 音声キャプチャを開始
     *
     * @private
     */
    private async startAudioCapture(): Promise<void> {
        if (!this.zoomWindowId) {
            logger.warn('Cannot start audio capture: Zoom window not found');
            return;
        }

        try {
            const stream = await this.audioCapture.captureSystemAudio(this.zoomWindowId);

            this.emit('audio-captured', stream);

            logger.info('Zoom audio capture started');
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
        logger.info('Zoom audio capture stopped');
    }

    /**
     * 会議情報を取得
     *
     * @protected
     */
    protected async fetchMeetingInfo(): Promise<MeetingInfo | null> {
        // 実際の実装では Zoom API を使用
        // ここではモック実装

        if (!this.zoomWindowId) {
            return null;
        }

        // Zoom ウィンドウが存在するかチェック
        const sources = await this.audioCapture.getAvailableSources();
        const zoomWindow = sources.find((s) => s.id === this.zoomWindowId);

        if (!zoomWindow) {
            return null;
        }

        // モック会議情報
        return {
            id: 'zoom-meeting-1',
            name: 'Zoom Meeting',
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
        logger.info('ZoomIntegration disposed');
    }
}
