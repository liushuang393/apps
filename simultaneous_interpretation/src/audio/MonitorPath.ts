/**
 * MonitorPath - モニターオーディオパス制御
 *
 * 目的:
 *   キャプチャした音声を物理出力デバイスに送信するモニターパスを制御
 *   ミュート/アンミュートはモニターパスのみを制御し、キャプチャパスには影響しない
 *
 * 機能:
 *   - モニターパスの有効化/無効化
 *   - 物理出力デバイスの選択
 *   - ゲイン制御
 *   - ミュート/アンミュート
 */

import { AudioDeviceInfo } from './DeviceGuard';

type SinkableAudioElement = HTMLAudioElement & {
    setSinkId: (sinkId: string) => Promise<void>;
};

const isSinkableAudioElement = (element: HTMLAudioElement): element is SinkableAudioElement => {
    return typeof (element as SinkableAudioElement).setSinkId === 'function';
};

/**
 * モニターモード
 */
export type MonitorMode = 'silent' | 'monitor';

/**
 * モニター設定
 */
export interface MonitorConfig {
    /** モニターモード */
    mode: MonitorMode;
    /** 出力デバイス */
    outputDevice: AudioDeviceInfo | null;
    /** ゲイン（0.0 - 1.0） */
    gain: number;
    /** ミュート */
    muted: boolean;
}

/**
 * MonitorPath クラス
 */
export class MonitorPath {
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private gainNode: GainNode | null = null;
    private destinationNode: MediaStreamAudioDestinationNode | null = null;
    private outputStream: MediaStream | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private config: MonitorConfig = {
        mode: 'silent',
        outputDevice: null,
        gain: 1.0,
        muted: false
    };

    /**
     * コンストラクタ
     */
    constructor() {
        console.info('[MonitorPath] 初期化');
    }

    /**
     * モニターパスをセットアップ
     *
     * @param audioContext - AudioContext
     * @param sourceNode - ソースノード
     */
    setup(audioContext: AudioContext, sourceNode: MediaStreamAudioSourceNode): void {
        console.info('[MonitorPath] セットアップ');

        this.audioContext = audioContext;
        this.sourceNode = sourceNode;

        // GainNode を作成
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value =
            this.config.mode === 'monitor' && !this.config.muted ? this.config.gain : 0.0;

        // MediaStreamAudioDestinationNode を作成
        this.destinationNode = this.audioContext.createMediaStreamDestination();

        // 音声チェーンを接続: source → gain → destination
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.destinationNode);

        // 出力ストリームを取得
        this.outputStream = this.destinationNode.stream;

        console.info('[MonitorPath] セットアップ完了');
    }

    /**
     * モニターモードを設定
     *
     * @param mode - モニターモード
     */
    setMode(mode: MonitorMode): void {
        console.info('[MonitorPath] モード変更:', this.config.mode, '→', mode);

        this.config.mode = mode;
        this.updateGain();

        if (mode === 'monitor') {
            this.enableMonitor();
        } else {
            this.disableMonitor();
        }
    }

    /**
     * モニターを有効化
     */
    private enableMonitor(): void {
        console.info('[MonitorPath] モニター有効化');

        if (!this.outputStream) {
            console.warn('[MonitorPath] 出力ストリームが初期化されていません');
            return;
        }

        // HTMLAudioElement を作成して出力デバイスに接続
        if (!this.audioElement) {
            this.audioElement = new Audio();
            this.audioElement.srcObject = this.outputStream;
            this.audioElement.autoplay = true;
        }

        // 出力デバイスを設定
        if (
            this.config.outputDevice &&
            this.audioElement &&
            isSinkableAudioElement(this.audioElement)
        ) {
            this.audioElement
                .setSinkId(this.config.outputDevice.id)
                .then(() => {
                    console.info(
                        '[MonitorPath] 出力デバイス設定完了:',
                        this.config.outputDevice?.name
                    );
                })
                .catch((error: Error) => {
                    console.error('[MonitorPath] 出力デバイス設定エラー:', error);
                });
        }

        this.updateGain();
    }

    /**
     * モニターを無効化
     */
    private disableMonitor(): void {
        console.info('[MonitorPath] モニター無効化');

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.srcObject = null;
            this.audioElement = null;
        }

        this.updateGain();
    }

    /**
     * 出力デバイスを設定
     *
     * @param device - 出力デバイス
     */
    setOutputDevice(device: AudioDeviceInfo): void {
        console.info('[MonitorPath] 出力デバイス設定:', device.name);

        this.config.outputDevice = device;

        // モニターモードの場合、デバイスを切り替え
        if (
            this.config.mode === 'monitor' &&
            this.audioElement &&
            isSinkableAudioElement(this.audioElement)
        ) {
            this.audioElement
                .setSinkId(device.id)
                .then(() => {
                    console.info('[MonitorPath] 出力デバイス切り替え完了:', device.name);
                })
                .catch((error: Error) => {
                    console.error('[MonitorPath] 出力デバイス切り替えエラー:', error);
                });
        }
    }

    /**
     * ゲインを設定
     *
     * @param gain - ゲイン（0.0 - 1.0）
     */
    setGain(gain: number): void {
        console.info('[MonitorPath] ゲイン設定:', gain);

        this.config.gain = Math.max(0.0, Math.min(1.0, gain));
        this.updateGain();
    }

    /**
     * ミュート/アンミュート
     *
     * @param muted - ミュート状態
     */
    setMuted(muted: boolean): void {
        console.info('[MonitorPath] ミュート:', muted);

        this.config.muted = muted;
        this.updateGain();
    }

    /**
     * ゲインを更新
     */
    private updateGain(): void {
        if (!this.gainNode) {
            return;
        }

        // モニターモードかつミュートでない場合のみゲインを適用
        const targetGain =
            this.config.mode === 'monitor' && !this.config.muted ? this.config.gain : 0.0;

        // スムーズにゲインを変更（クリック音防止）
        const currentTime = this.audioContext?.currentTime || 0;
        this.gainNode.gain.setTargetAtTime(targetGain, currentTime, 0.01);

        console.info('[MonitorPath] ゲイン更新:', targetGain);
    }

    /**
     * モニター設定を取得
     */
    getConfig(): MonitorConfig {
        return { ...this.config };
    }

    /**
     * モニターモードを取得
     */
    getMode(): MonitorMode {
        return this.config.mode;
    }

    /**
     * ミュート状態を取得
     */
    isMuted(): boolean {
        return this.config.muted;
    }

    /**
     * モニター中か確認
     */
    isMonitoring(): boolean {
        return this.config.mode === 'monitor' && !this.config.muted;
    }

    /**
     * クリーンアップ
     */
    dispose(): void {
        console.info('[MonitorPath] クリーンアップ');

        this.disableMonitor();

        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }

        if (this.destinationNode) {
            this.destinationNode = null;
        }

        this.sourceNode = null;
        this.audioContext = null;
        this.outputStream = null;
    }
}
