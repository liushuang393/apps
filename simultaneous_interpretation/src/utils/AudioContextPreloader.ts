/**
 * AudioContextPreloader.ts
 *
 * 目的: AudioContextの事前初期化によるアプリケーション起動時間の短縮
 *
 * 機能:
 *   - AudioContext事前作成
 *   - メディアストリーム事前取得
 *   - 音声処理ノード事前初期化
 *   - ユーザーインタラクション前の準備
 *
 * 使用方法:
 *   const preloader = AudioContextPreloader.getInstance();
 *   await preloader.preload();
 *   const audioContext = preloader.getAudioContext();
 *
 * 注意:
 *   - ブラウザのAutoplay Policyにより、ユーザーインタラクション後に再開が必要な場合あり
 *   - メモリ使用量に注意
 */

import { defaultLogger } from './Logger';

/**
 * AudioContextPreloader クラス
 *
 * 目的: AudioContextの事前初期化を管理（シングルトン）
 */
export class AudioContextPreloader {
    private static instance: AudioContextPreloader | null = null;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private isPreloaded: boolean = false;
    private preloadStartTime: number = 0;

    /**
     * プライベートコンストラクタ（シングルトンパターン）
     */
    private constructor() {
        // シングルトン
    }

    /**
     * インスタンス取得
     *
     * @returns AudioContextPreloaderインスタンス
     */
    static getInstance(): AudioContextPreloader {
        if (!AudioContextPreloader.instance) {
            AudioContextPreloader.instance = new AudioContextPreloader();
        }
        return AudioContextPreloader.instance;
    }

    /**
     * 事前初期化実行
     *
     * 目的: AudioContextとメディアストリームを事前に準備
     *
     * @returns Promise<void>
     */
    async preload(): Promise<void> {
        if (this.isPreloaded) {
            defaultLogger.debug('[AudioContextPreloader] 既に初期化済み');
            return;
        }

        this.preloadStartTime = performance.now();
        defaultLogger.info('[AudioContextPreloader] 事前初期化開始');

        try {
            // 1. AudioContext作成
            await this.createAudioContext();

            // 2. メディアストリーム取得（マイク権限要求）
            await this.acquireMediaStream();

            // 3. 音声処理ノード事前作成
            await this.createAudioNodes();

            this.isPreloaded = true;

            const preloadTime = performance.now() - this.preloadStartTime;
            defaultLogger.info('[AudioContextPreloader] 事前初期化完了', {
                preloadTime: `${preloadTime.toFixed(2)}ms`
            });
        } catch (error) {
            defaultLogger.error('[AudioContextPreloader] 事前初期化失敗:', error);
            throw error;
        }
    }

    /**
     * AudioContext作成
     *
     * 目的: AudioContextを事前に作成し、suspended状態を解除
     */
    private async createAudioContext(): Promise<void> {
        if (this.audioContext) {
            defaultLogger.debug('[AudioContextPreloader] AudioContext既存');
            return;
        }

        // AudioContext作成
        this.audioContext = new AudioContext({
            sampleRate: 48000, // 48kHz
            latencyHint: 'interactive' // 低遅延モード
        });

        defaultLogger.info('[AudioContextPreloader] AudioContext作成完了', {
            sampleRate: this.audioContext.sampleRate,
            state: this.audioContext.state
        });

        // suspended状態の場合は再開を試みる
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                defaultLogger.info('[AudioContextPreloader] AudioContext再開成功');
            } catch (error) {
                defaultLogger.warn(
                    '[AudioContextPreloader] AudioContext再開失敗（ユーザーインタラクション後に再試行）:',
                    error
                );
            }
        }
    }

    /**
     * メディアストリーム取得
     *
     * 目的: マイク権限を事前に取得し、メディアストリームを準備
     */
    private async acquireMediaStream(): Promise<void> {
        if (this.mediaStream) {
            defaultLogger.debug('[AudioContextPreloader] MediaStream既存');
            return;
        }

        try {
            // マイク権限要求
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 48000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: false, // 独自実装を使用
                    autoGainControl: false // 独自実装を使用
                }
            });

            defaultLogger.info('[AudioContextPreloader] MediaStream取得完了', {
                tracks: this.mediaStream.getTracks().length
            });
        } catch (error) {
            defaultLogger.error('[AudioContextPreloader] MediaStream取得失敗:', error);
            throw error;
        }
    }

    /**
     * 音声処理ノード事前作成
     *
     * 目的: よく使用される音声処理ノードを事前に作成
     */
    private async createAudioNodes(): Promise<void> {
        if (!this.audioContext) {
            throw new Error('AudioContext未初期化');
        }

        // よく使用されるノードを事前作成（メモリに保持）
        const gainNode = this.audioContext.createGain();
        const analyserNode = this.audioContext.createAnalyser();
        const biquadFilter = this.audioContext.createBiquadFilter();

        // 設定
        gainNode.gain.value = 1;
        analyserNode.fftSize = 2048;
        biquadFilter.type = 'lowpass';
        biquadFilter.frequency.value = 8000;

        defaultLogger.debug('[AudioContextPreloader] 音声処理ノード事前作成完了');

        // ノードは使用されるまでメモリに保持される
        // GCされないように参照を保持する必要はない（AudioContextが保持）
    }

    /**
     * AudioContext取得
     *
     * @returns AudioContext | null
     */
    getAudioContext(): AudioContext | null {
        return this.audioContext;
    }

    /**
     * MediaStream取得
     *
     * @returns MediaStream | null
     */
    getMediaStream(): MediaStream | null {
        return this.mediaStream;
    }

    /**
     * 初期化済みかどうか
     *
     * @returns boolean
     */
    isInitialized(): boolean {
        return this.isPreloaded;
    }

    /**
     * AudioContextを再開
     *
     * 目的: ユーザーインタラクション後にsuspended状態を解除
     *
     * @returns Promise<void>
     */
    async resume(): Promise<void> {
        if (!this.audioContext) {
            throw new Error('AudioContext未初期化');
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            defaultLogger.info('[AudioContextPreloader] AudioContext再開完了');
        }
    }

    /**
     * クリーンアップ
     *
     * 目的: リソースを解放
     */
    async cleanup(): Promise<void> {
        defaultLogger.info('[AudioContextPreloader] クリーンアップ開始');

        // MediaStreamを停止
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
        }

        // AudioContextをクローズ
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        this.isPreloaded = false;

        defaultLogger.info('[AudioContextPreloader] クリーンアップ完了');
    }

    /**
     * パフォーマンス統計取得
     *
     * @returns パフォーマンス統計
     */
    getPerformanceStats(): {
        isPreloaded: boolean;
        audioContextState: string | null;
        mediaStreamActive: boolean;
        preloadTime: number;
    } {
        return {
            isPreloaded: this.isPreloaded,
            audioContextState: this.audioContext?.state ?? null,
            mediaStreamActive: this.mediaStream?.active ?? false,
            preloadTime: this.preloadStartTime > 0 ? performance.now() - this.preloadStartTime : 0
        };
    }
}

/**
 * グローバルプリローダーインスタンス
 *
 * 使用例:
 *   import { preloadAudioContext } from './utils/AudioContextPreloader';
 *   await preloadAudioContext();
 */
export async function preloadAudioContext(): Promise<void> {
    const preloader = AudioContextPreloader.getInstance();
    await preloader.preload();
}

/**
 * AudioContext取得ヘルパー
 *
 * @returns AudioContext | null
 */
export function getPreloadedAudioContext(): AudioContext | null {
    const preloader = AudioContextPreloader.getInstance();
    return preloader.getAudioContext();
}

/**
 * MediaStream取得ヘルパー
 *
 * @returns MediaStream | null
 */
export function getPreloadedMediaStream(): MediaStream | null {
    const preloader = AudioContextPreloader.getInstance();
    return preloader.getMediaStream();
}
