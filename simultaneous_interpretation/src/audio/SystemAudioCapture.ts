/**
 * システム音声キャプチャ統合
 *
 * @description
 * ブラウザとElectron環境の両方でシステム音声をキャプチャ。
 * Teams/Zoom などのアプリケーション音声を取得。
 *
 * @features
 * - 環境自動検出（Browser/Electron）
 * - アプリケーション音声キャプチャ
 * - 画面共有音声キャプチャ
 * - 音声ソース選択UI
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';
import '../types/electron';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 音声ソースタイプ
 */
export type SystemAudioSourceType = 'window' | 'screen' | 'browser';

/**
 * 音声ソース情報
 */
export interface SystemAudioSource {
    /** ソース ID */
    id: string;
    /** ソース名 */
    name: string;
    /** ソースタイプ */
    type: SystemAudioSourceType;
    /** サムネイル（Base64） */
    thumbnail?: string;
}

/**
 * システム音声キャプチャ設定
 */
export interface SystemAudioCaptureConfig {
    /** サンプリングレート */
    sampleRate: number;
    /** チャンネル数 */
    channelCount: number;
    /** エコーキャンセレーション */
    echoCancellation: boolean;
    /** ノイズ抑制 */
    noiseSuppression: boolean;
    /** 自動ゲイン制御 */
    autoGainControl: boolean;
    /** 個人対話モード（エコー防止強化） */
    personalConversationMode?: boolean;
}

/**
 * システム音声キャプチャクラス
 */
export class SystemAudioCapture {
    private readonly config: SystemAudioCaptureConfig;
    private mediaStream: MediaStream | null = null;
    private readonly isElectron: boolean = false;

    /**
     * コンストラクタ
     *
     * @param config - システム音声キャプチャ設定
     */
    constructor(config: Partial<SystemAudioCaptureConfig> = {}) {
        // 個人対話モードの場合、エコーキャンセレーションを強制有効化
        const personalMode = config.personalConversationMode ?? false;

        this.config = {
            sampleRate: config.sampleRate ?? 24000,
            channelCount: config.channelCount ?? 1,
            echoCancellation: personalMode ? true : (config.echoCancellation ?? false),
            noiseSuppression: personalMode ? true : (config.noiseSuppression ?? false),
            autoGainControl: personalMode ? true : (config.autoGainControl ?? false),
            personalConversationMode: personalMode
        };

        // Electron 環境チェック
        this.isElectron = !!(globalThis as typeof globalThis & { electronAPI?: unknown })
            .electronAPI;

        logger.info('SystemAudioCapture initialized', {
            isElectron: this.isElectron,
            sampleRate: this.config.sampleRate,
            personalConversationMode: this.config.personalConversationMode,
            echoCancellation: this.config.echoCancellation
        });
    }

    /**
     * 利用可能な音声ソースを取得
     *
     * @returns 音声ソース一覧
     */
    public async getAvailableSources(): Promise<SystemAudioSource[]> {
        if (this.isElectron && globalThis.window?.electronAPI) {
            // Electron 環境
            try {
                const electronAPI = globalThis.window.electronAPI as unknown as {
                    getAudioSources: (
                        types: string[]
                    ) => Promise<
                        Array<{ id: string; name: string; type: string; thumbnail?: string }>
                    >;
                };
                const sources = await electronAPI.getAudioSources(['window', 'screen']);
                return sources.map(
                    (source: { id: string; name: string; type: string; thumbnail?: string }) => ({
                        id: source.id,
                        name: source.name,
                        type: source.type as 'window' | 'screen' | 'browser',
                        ...(source.thumbnail !== undefined && { thumbnail: source.thumbnail })
                    })
                );
            } catch (error) {
                logger.error('Failed to get Electron audio sources', error);
                return [];
            }
        }
        // ブラウザ環境
        return [
            {
                id: 'browser-display',
                name: 'Screen/Window Audio',
                type: 'browser'
            }
        ];
    }

    /**
     * 会議アプリを検出
     *
     * @returns 会議アプリソース
     */
    public async detectMeetingApps(): Promise<SystemAudioSource[]> {
        if (this.isElectron && globalThis.window?.electronAPI) {
            try {
                const electronAPI = globalThis.window.electronAPI as unknown as {
                    detectMeetingApps: () => Promise<
                        Array<{ id: string; name: string; type: string; thumbnail?: string }>
                    >;
                };
                const sources = await electronAPI.detectMeetingApps();
                return sources.map(
                    (source: { id: string; name: string; type: string; thumbnail?: string }) => ({
                        id: source.id,
                        name: source.name,
                        type: source.type as 'window' | 'screen' | 'browser',
                        ...(source.thumbnail !== undefined && { thumbnail: source.thumbnail })
                    })
                );
            } catch (error) {
                logger.error('Failed to detect meeting apps', error);
                return [];
            }
        }
        return [];
    }

    /**
     * システム音声をキャプチャ
     *
     * @param sourceId - ソース ID（Electron のみ）
     * @returns MediaStream
     */
    public async captureSystemAudio(sourceId?: string): Promise<MediaStream> {
        if (this.isElectron && sourceId) {
            // Electron 環境：desktopCapturer を使用
            return await this.captureElectronAudio(sourceId);
        } else {
            // ブラウザ環境：getDisplayMedia を使用
            return await this.captureBrowserAudio();
        }
    }

    /**
     * Electron 環境で音声をキャプチャ
     *
     * @private
     * @param sourceId - ソース ID
     * @returns MediaStream
     */
    private async captureElectronAudio(sourceId: string): Promise<MediaStream> {
        try {
            // ソース ID を検証
            if (!globalThis.window?.electronAPI) {
                throw new Error('Electron API is not available');
            }

            const electronAPI = globalThis.window.electronAPI as unknown as {
                validateSourceId: (sourceId: string) => Promise<boolean>;
            };
            const isValid = await electronAPI.validateSourceId(sourceId);
            if (!isValid) {
                throw new Error('Invalid source ID');
            }

            // getUserMedia で音声をキャプチャ
            interface ElectronMediaTrackConstraints extends MediaTrackConstraints {
                mandatory?: {
                    chromeMediaSource: string;
                    chromeMediaSourceId: string;
                };
            }

            const constraints: MediaStreamConstraints = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                } as ElectronMediaTrackConstraints,
                video: false
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            logger.info('Electron audio captured', { sourceId });

            return this.mediaStream;
        } catch (error) {
            logger.error('Failed to capture Electron audio', error);
            throw error;
        }
    }

    /**
     * ブラウザ環境で音声をキャプチャ
     *
     * @private
     * @returns MediaStream
     */
    private async captureBrowserAudio(): Promise<MediaStream> {
        try {
            const constraints: DisplayMediaStreamOptions = {
                video: false,
                audio: {
                    echoCancellation: this.config.echoCancellation,
                    noiseSuppression: this.config.noiseSuppression,
                    autoGainControl: this.config.autoGainControl,
                    sampleRate: this.config.sampleRate,
                    channelCount: this.config.channelCount
                } as MediaTrackConstraints
            };

            this.mediaStream = await navigator.mediaDevices.getDisplayMedia(constraints);

            logger.info('Browser audio captured');

            return this.mediaStream;
        } catch (error) {
            logger.error('Failed to capture browser audio', error);
            throw error;
        }
    }

    /**
     * キャプチャを停止
     */
    public stopCapture(): void {
        if (this.mediaStream) {
            for (const track of this.mediaStream.getTracks()) {
                track.stop();
            }
            this.mediaStream = null;
            logger.info('System audio capture stopped');
        }
    }

    /**
     * Electron 環境かチェック
     */
    public isElectronEnvironment(): boolean {
        return this.isElectron;
    }

    /**
     * クリーンアップ
     */
    public dispose(): void {
        this.stopCapture();
        logger.info('SystemAudioCapture disposed');
    }
}
