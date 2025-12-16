/**
 * ノイズサプレッション
 *
 * @description
 * Web Audio APIのフィルターを使用してノイズを抑制
 * ハイパスフィルターで低周波ノイズを除去
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import { defaultLogger } from '../utils/Logger';

export interface NoiseSuppressionConfig {
    /** ハイパスフィルターの周波数 (Hz) */
    highpassFreq: number;
    /** ローパスフィルターの周波数 (Hz) */
    lowpassFreq: number;
    /** ゲイン調整 */
    gain: number;
    /** 有効化 */
    enabled: boolean;
    /** DynamicsCompressor有効化 */
    compressorEnabled: boolean;
    /** Compressor threshold (dB) */
    compressorThreshold: number;
    /** Compressor ratio */
    compressorRatio: number;
    /** Compressor attack (秒) */
    compressorAttack: number;
    /** Compressor release (秒) */
    compressorRelease: number;
}

/**
 * NoiseSuppression クラス
 *
 * Web Audio API を使用したノイズ抑制
 */
export class NoiseSuppression {
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private highpassFilter: BiquadFilterNode | null = null;
    private lowpassFilter: BiquadFilterNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private gainNode: GainNode | null = null;
    private destination: MediaStreamAudioDestinationNode | null = null;
    private config: NoiseSuppressionConfig;

    /**
     * コンストラクタ
     *
     * @param config 設定
     */
    constructor(config?: Partial<NoiseSuppressionConfig>) {
        this.config = {
            highpassFreq: config?.highpassFreq ?? 100, // 100Hz
            lowpassFreq: config?.lowpassFreq ?? 8000, // 8kHz
            gain: config?.gain ?? 1,
            enabled: config?.enabled ?? true,
            compressorEnabled: config?.compressorEnabled ?? true,
            compressorThreshold: config?.compressorThreshold ?? -24, // -24dB
            compressorRatio: config?.compressorRatio ?? 12, // 12:1
            compressorAttack: config?.compressorAttack ?? 0.003, // 3ms
            compressorRelease: config?.compressorRelease ?? 0.25 // 250ms
        };
    }

    /**
     * ノイズサプレッションを適用
     *
     * @param stream MediaStream
     * @param audioContext AudioContext
     * @returns 処理済みMediaStreamDestinationNode
     */
    apply(stream: MediaStream, audioContext: AudioContext): MediaStreamAudioDestinationNode {
        // ソースノードを作成
        this.sourceNode = audioContext.createMediaStreamSource(stream);

        if (!this.config.enabled) {
            // 無効の場合はパススルー
            this.destination = audioContext.createMediaStreamDestination();
            this.sourceNode.connect(this.destination);
            return this.destination;
        }

        // ハイパスフィルター（低周波ノイズ除去）
        this.highpassFilter = audioContext.createBiquadFilter();
        this.highpassFilter.type = 'highpass';
        this.highpassFilter.frequency.value = this.config.highpassFreq;
        this.highpassFilter.Q.value = 1;

        // ローパスフィルター（高周波ノイズ除去）
        this.lowpassFilter = audioContext.createBiquadFilter();
        this.lowpassFilter.type = 'lowpass';
        this.lowpassFilter.frequency.value = this.config.lowpassFreq;
        this.lowpassFilter.Q.value = 1;

        // DynamicsCompressor（音量正規化）
        // 目的: 音量レベルを一定に保ち、過度な音量変動を抑制
        // 仕様: threshold=-24dB, ratio=12:1, attack=3ms, release=250ms
        if (this.config.compressorEnabled) {
            this.compressor = audioContext.createDynamicsCompressor();
            this.compressor.threshold.value = this.config.compressorThreshold;
            this.compressor.ratio.value = this.config.compressorRatio;
            this.compressor.attack.value = this.config.compressorAttack;
            this.compressor.release.value = this.config.compressorRelease;
        }

        // ゲインノード
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = this.config.gain;

        // 接続: Source → Highpass → Lowpass → [Compressor] → Gain → Destination
        this.destination = audioContext.createMediaStreamDestination();

        let currentNode: AudioNode = this.sourceNode;
        currentNode = currentNode.connect(this.highpassFilter);
        currentNode = currentNode.connect(this.lowpassFilter);

        if (this.compressor) {
            currentNode = currentNode.connect(this.compressor);
        }

        currentNode.connect(this.gainNode).connect(this.destination);

        defaultLogger.debug('[NoiseSuppression] Applied:', {
            ...this.config,
            compressorActive: !!this.compressor
        });

        return this.destination;
    }

    /**
     * 設定を更新
     *
     * @param config 新しい設定
     */
    updateConfig(config: Partial<NoiseSuppressionConfig>): void {
        this.config = { ...this.config, ...config };

        // フィルター更新
        if (this.highpassFilter && config.highpassFreq !== undefined) {
            this.highpassFilter.frequency.value = config.highpassFreq;
        }

        if (this.lowpassFilter && config.lowpassFreq !== undefined) {
            this.lowpassFilter.frequency.value = config.lowpassFreq;
        }

        if (this.gainNode && config.gain !== undefined) {
            this.gainNode.gain.value = config.gain;
        }
    }

    /**
     * リソースを解放
     */
    dispose(): void {
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.highpassFilter) {
            this.highpassFilter.disconnect();
            this.highpassFilter = null;
        }

        if (this.lowpassFilter) {
            this.lowpassFilter.disconnect();
            this.lowpassFilter = null;
        }

        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
    }
}
