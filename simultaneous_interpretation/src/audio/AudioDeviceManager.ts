/**
 * 音声デバイス管理システム
 *
 * @description
 * システム音声デバイスの列挙、選択、管理を行うクラス。
 * マイク入力とシステム音声（ループバック）の両方をサポート。
 *
 * @features
 * - 音声デバイスの列挙
 * - デバイスの選択と切り替え
 * - システム音声キャプチャ（ループバック）
 * - デバイス変更の監視
 * - 音声レベルモニタリング
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 音声デバイス情報
 */
export interface AudioDeviceInfo {
    /** デバイス ID */
    deviceId: string;
    /** デバイス名 */
    label: string;
    /** デバイス種類 */
    kind: 'audioinput' | 'audiooutput';
    /** グループ ID */
    groupId: string;
    /** デフォルトデバイスか */
    isDefault: boolean;
}

/**
 * 音声キャプチャ設定
 */
export interface AudioCaptureConfig {
    /** デバイス ID */
    deviceId?: string;
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
    /** システム音声をキャプチャ */
    captureSystemAudio: boolean;
}

/**
 * 音声デバイス管理クラス
 */
export class AudioDeviceManager {
    private inputDevices: AudioDeviceInfo[] = [];
    private outputDevices: AudioDeviceInfo[] = [];
    private selectedInputDevice: AudioDeviceInfo | null = null;
    private selectedOutputDevice: AudioDeviceInfo | null = null;
    private mediaStream: MediaStream | null = null;
    private systemAudioStream: MediaStream | null = null;
    private deviceChangeCallback: (() => void) | null = null;

    /**
     * コンストラクタ
     */
    constructor() {
        logger.info('AudioDeviceManager initialized');
    }

    /**
     * 初期化
     */
    public async initialize(): Promise<void> {
        // デバイス列挙
        await this.enumerateDevices();

        // デバイス変更の監視
        navigator.mediaDevices.addEventListener('devicechange', () => {
            this.handleDeviceChange();
        });

        logger.info('AudioDeviceManager ready', {
            inputDevices: this.inputDevices.length,
            outputDevices: this.outputDevices.length
        });
    }

    /**
     * デバイスを列挙
     */
    public async enumerateDevices(): Promise<void> {
        try {
            // マイク権限を要求（デバイス名を取得するため）
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach((track) => track.stop());

            // デバイス一覧を取得
            const devices = await navigator.mediaDevices.enumerateDevices();

            this.inputDevices = [];
            this.outputDevices = [];

            for (const device of devices) {
                if (device.kind === 'audioinput') {
                    this.inputDevices.push({
                        deviceId: device.deviceId,
                        label: device.label || `Microphone ${this.inputDevices.length + 1}`,
                        kind: device.kind,
                        groupId: device.groupId,
                        isDefault: device.deviceId === 'default'
                    });
                } else if (device.kind === 'audiooutput') {
                    this.outputDevices.push({
                        deviceId: device.deviceId,
                        label: device.label || `Speaker ${this.outputDevices.length + 1}`,
                        kind: device.kind,
                        groupId: device.groupId,
                        isDefault: device.deviceId === 'default'
                    });
                }
            }

            logger.info('Devices enumerated', {
                inputDevices: this.inputDevices.length,
                outputDevices: this.outputDevices.length
            });
        } catch (error) {
            logger.error('Failed to enumerate devices', error);
            throw error;
        }
    }

    /**
     * 入力デバイス一覧を取得
     */
    public getInputDevices(): AudioDeviceInfo[] {
        return [...this.inputDevices];
    }

    /**
     * 出力デバイス一覧を取得
     */
    public getOutputDevices(): AudioDeviceInfo[] {
        return [...this.outputDevices];
    }

    /**
     * 入力デバイスを選択
     */
    public selectInputDevice(deviceId: string): void {
        const device = this.inputDevices.find((d) => d.deviceId === deviceId);
        if (device) {
            this.selectedInputDevice = device;
            logger.info('Input device selected', { label: device.label });
        } else {
            logger.warn('Input device not found', { deviceId });
        }
    }

    /**
     * 出力デバイスを選択
     */
    public selectOutputDevice(deviceId: string): void {
        const device = this.outputDevices.find((d) => d.deviceId === deviceId);
        if (device) {
            this.selectedOutputDevice = device;
            logger.info('Output device selected', { label: device.label });
        } else {
            logger.warn('Output device not found', { deviceId });
        }
    }

    /**
     * 選択された入力デバイスを取得
     */
    public getSelectedInputDevice(): AudioDeviceInfo | null {
        return this.selectedInputDevice;
    }

    /**
     * 選択された出力デバイスを取得
     */
    public getSelectedOutputDevice(): AudioDeviceInfo | null {
        return this.selectedOutputDevice;
    }

    /**
     * マイク音声をキャプチャ
     */
    public async captureMicrophone(config: Partial<AudioCaptureConfig> = {}): Promise<MediaStream> {
        const fullConfig: AudioCaptureConfig = {
            ...(this.selectedInputDevice?.deviceId && {
                deviceId: this.selectedInputDevice.deviceId
            }),
            sampleRate: config.sampleRate ?? 24000,
            channelCount: config.channelCount ?? 1,
            echoCancellation: config.echoCancellation ?? true,
            noiseSuppression: config.noiseSuppression ?? true,
            autoGainControl: config.autoGainControl ?? true,
            captureSystemAudio: config.captureSystemAudio ?? false
        };

        try {
            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: fullConfig.deviceId ? { exact: fullConfig.deviceId } : undefined,
                    sampleRate: fullConfig.sampleRate,
                    channelCount: fullConfig.channelCount,
                    echoCancellation: fullConfig.echoCancellation,
                    noiseSuppression: fullConfig.noiseSuppression,
                    autoGainControl: fullConfig.autoGainControl
                } as MediaTrackConstraints
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            logger.info('Microphone captured', {
                deviceId: fullConfig.deviceId,
                sampleRate: fullConfig.sampleRate
            });

            return this.mediaStream;
        } catch (error) {
            logger.error('Failed to capture microphone', error);
            throw error;
        }
    }

    /**
     * システム音声をキャプチャ（Electron 環境のみ）
     */
    public async captureSystemAudio(): Promise<MediaStream | null> {
        // Electron 環境チェック
        if (!window.electronAPI) {
            logger.warn('System audio capture requires Electron environment');
            return null;
        }

        try {
            // desktopCapturer を使用してシステム音声をキャプチャ
            // これは Electron の main プロセスで実装する必要がある
            logger.info('System audio capture requested');

            // ブラウザ環境では getDisplayMedia を使用
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                } as MediaTrackConstraints
            });

            this.systemAudioStream = stream;

            logger.info('System audio captured');

            return stream;
        } catch (error) {
            logger.error('Failed to capture system audio', error);
            return null;
        }
    }

    /**
     * 音声キャプチャを停止
     */
    public stopCapture(): void {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
            logger.info('Microphone capture stopped');
        }

        if (this.systemAudioStream) {
            this.systemAudioStream.getTracks().forEach((track) => track.stop());
            this.systemAudioStream = null;
            logger.info('System audio capture stopped');
        }
    }

    /**
     * デバイス変更コールバックを設定
     */
    public onDeviceChange(callback: () => void): void {
        this.deviceChangeCallback = callback;
    }

    /**
     * デバイス変更を処理
     */
    private async handleDeviceChange(): Promise<void> {
        logger.info('Device change detected');

        // デバイス一覧を再取得
        await this.enumerateDevices();

        // コールバックを呼び出し
        if (this.deviceChangeCallback) {
            this.deviceChangeCallback();
        }
    }

    /**
     * クリーンアップ
     */
    public dispose(): void {
        this.stopCapture();
        navigator.mediaDevices.removeEventListener('devicechange', () => {
            this.handleDeviceChange();
        });
        logger.info('AudioDeviceManager disposed');
    }
}
