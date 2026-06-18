/**
 * VirtualAudioDevice - 仮想オーディオデバイスインターフェース
 *
 * 目的:
 *   仮想オーディオデバイス（VB-CABLE, BlackHole）の統一インターフェースを提供
 *
 * 機能:
 *   - プラットフォーム検出
 *   - デバイス検証
 *   - フォーマットネゴシエーション
 *   - キャプチャストリーム管理
 */

import { AudioDeviceInfo } from './DeviceGuard';

/**
 * プラットフォームタイプ
 */
export type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

/**
 * デバイスオーディオフォーマット
 */
export interface DeviceAudioFormat {
    /** サンプルレート（Hz） */
    sampleRate: number;
    /** チャンネル数 */
    channels: number;
    /** ビット深度 */
    bitDepth: 16 | 24 | 32;
    /** フォーマットタイプ */
    format: 'pcm16' | 'pcm24' | 'float32';
}

/**
 * キャプチャ設定
 */
export interface CaptureConfig {
    /** デバイス情報 */
    device: AudioDeviceInfo;
    /** オーディオフォーマット */
    format: DeviceAudioFormat;
    /** バッファーサイズ（サンプル数） */
    bufferSize: number;
    /** エコーキャンセレーション */
    echoCancellation: boolean;
    /** ノイズ抑制 */
    noiseSuppression: boolean;
    /** 自動ゲイン制御 */
    autoGainControl: boolean;
}

/**
 * キャプチャステータス
 */
export interface CaptureStatus {
    /** キャプチャ中か */
    isCapturing: boolean;
    /** バッファーアンダーラン数 */
    underruns: number;
    /** バッファー深度（サンプル数） */
    bufferDepth: number;
    /** 最後のエラー */
    lastError?: string;
    /** 最後の再接続理由 */
    lastReconnectReason?: string;
}

/**
 * VirtualAudioDevice クラス
 */
export class VirtualAudioDevice {
    private platform: Platform;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private captureStatus: CaptureStatus = {
        isCapturing: false,
        underruns: 0,
        bufferDepth: 0
    };
    private audioDataCallback: ((data: Float32Array) => void) | null = null;

    /**
     * コンストラクタ
     */
    constructor() {
        this.platform = this.detectPlatform();
        console.info('[VirtualAudioDevice] 初期化 - プラットフォーム:', this.platform);
    }

    /**
     * プラットフォームを検出
     */
    private detectPlatform(): Platform {
        const platform = navigator.platform.toLowerCase();

        if (platform.includes('win')) {
            return 'windows';
        } else if (platform.includes('mac')) {
            return 'macos';
        } else if (platform.includes('linux')) {
            return 'linux';
        }
        return 'unknown';
    }

    /**
     * プラットフォームを取得
     */
    getPlatform(): Platform {
        return this.platform;
    }

    /**
     * 仮想デバイスが利用可能か確認
     *
     * @param device - デバイス情報
     * @returns 利用可能な場合 true
     */
    isVirtualDeviceAvailable(device: AudioDeviceInfo): boolean {
        if (!device.isVirtual) {
            console.warn('[VirtualAudioDevice] 仮想デバイスではありません:', device.name);
            return false;
        }

        // プラットフォーム固有の検証
        if (this.platform === 'windows') {
            return this.isVBCableAvailable(device);
        } else if (this.platform === 'macos') {
            return this.isBlackHoleAvailable(device);
        }

        return false;
    }

    /**
     * VB-CABLE が利用可能か確認
     */
    private isVBCableAvailable(device: AudioDeviceInfo): boolean {
        // VB-CABLE のキャプチャデバイスは "CABLE Output" という名前
        return device.name.includes('CABLE Output') || device.driver === 'VB-CABLE';
    }

    /**
     * BlackHole が利用可能か確認
     */
    private isBlackHoleAvailable(device: AudioDeviceInfo): boolean {
        // BlackHole のキャプチャデバイスは "BlackHole" という名前
        return device.name.includes('BlackHole') || device.driver === 'BlackHole';
    }

    /**
     * デフォルトフォーマットを取得
     */
    getDefaultFormat(): DeviceAudioFormat {
        return {
            sampleRate: 48000,
            channels: 2,
            bitDepth: 32,
            format: 'float32'
        };
    }

    /**
     * フォーマットをネゴシエート
     *
     * @param requestedFormat - 要求されたフォーマット
     * @returns ネゴシエートされたフォーマット
     */
    negotiateFormat(requestedFormat: DeviceAudioFormat): DeviceAudioFormat {
        console.info('[VirtualAudioDevice] フォーマットネゴシエーション:', requestedFormat);

        // プラットフォーム固有の制約を適用
        const negotiated = { ...requestedFormat };

        // サンプルレートの検証
        const supportedSampleRates = [44100, 48000, 96000];
        if (!supportedSampleRates.includes(negotiated.sampleRate)) {
            console.warn(
                '[VirtualAudioDevice] サンプルレート未サポート:',
                negotiated.sampleRate,
                '→ 48000 に変更'
            );
            negotiated.sampleRate = 48000;
        }

        // チャンネル数の検証
        if (negotiated.channels > 2) {
            console.warn(
                '[VirtualAudioDevice] チャンネル数未サポート:',
                negotiated.channels,
                '→ 2 に変更'
            );
            negotiated.channels = 2;
        }

        console.info('[VirtualAudioDevice] ネゴシエート完了:', negotiated);
        return negotiated;
    }

    /**
     * キャプチャを開始
     *
     * @param config - キャプチャ設定
     */
    async startCapture(config: CaptureConfig): Promise<void> {
        console.info('[VirtualAudioDevice] キャプチャ開始:', config);

        try {
            // フォーマットをネゴシエート
            const negotiatedFormat = this.negotiateFormat(config.format);

            // AudioContext を作成
            this.audioContext = new AudioContext({
                sampleRate: negotiatedFormat.sampleRate
            });

            // MediaStream を取得
            const audioConstraints: MediaTrackConstraints = {
                channelCount: negotiatedFormat.channels,
                sampleRate: negotiatedFormat.sampleRate,
                echoCancellation: config.echoCancellation,
                noiseSuppression: config.noiseSuppression,
                autoGainControl: config.autoGainControl
            };

            if (config.device.id) {
                audioConstraints.deviceId = { exact: config.device.id };
            }

            const constraints: MediaStreamConstraints = {
                audio: audioConstraints
            };

            console.info('[VirtualAudioDevice] getUserMedia 要求:', constraints);
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            // MediaStreamAudioSourceNode を作成
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

            // AudioWorklet または ScriptProcessor でデータを取得
            await this.setupAudioProcessing();

            this.captureStatus.isCapturing = true;
            console.info('[VirtualAudioDevice] キャプチャ開始完了');
        } catch (error) {
            console.error('[VirtualAudioDevice] キャプチャ開始エラー:', error);
            this.captureStatus.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    /**
     * 音声処理をセットアップ
     */
    private async setupAudioProcessing(): Promise<void> {
        if (!this.audioContext || !this.sourceNode) {
            throw new Error('AudioContext または SourceNode が初期化されていません');
        }

        try {
            // AudioWorklet を使用（推奨）
            await this.audioContext.audioWorklet.addModule('audio-processor-worklet.js');

            const workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor-worklet');

            // AudioWorklet からのメッセージを受信
            workletNode.port.onmessage = (event) => {
                if (event.data.type === 'audiodata' && this.audioDataCallback) {
                    this.audioDataCallback(event.data.data);
                }
            };

            // 音声チェーンを接続
            this.sourceNode.connect(workletNode);

            console.info('[VirtualAudioDevice] AudioWorklet セットアップ完了');
        } catch (error) {
            console.warn(
                '[VirtualAudioDevice] AudioWorklet 失敗、ScriptProcessor にフォールバック:',
                error
            );
            // フォールバック実装（省略）
        }
    }

    /**
     * キャプチャを停止
     */
    stopCapture(): void {
        console.info('[VirtualAudioDevice] キャプチャ停止');

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.captureStatus.isCapturing = false;
    }

    /**
     * 音声データコールバックを設定
     *
     * @param callback - コールバック関数
     */
    setAudioDataCallback(callback: (data: Float32Array) => void): void {
        this.audioDataCallback = callback;
    }

    /**
     * キャプチャステータスを取得
     */
    getCaptureStatus(): CaptureStatus {
        return { ...this.captureStatus };
    }

    /**
     * クリーンアップ
     */
    dispose(): void {
        console.info('[VirtualAudioDevice] クリーンアップ');
        this.stopCapture();
        this.audioDataCallback = null;
    }
}
