/**
 * 音声処理パイプライン
 *
 * @description
 * 高品質な音声処理を実現するパイプラインクラス。
 * ノイズ抑制、エコーキャンセル、自動ゲイン制御、音質最適化を含む。
 *
 * @features
 * - 高度なノイズ抑制
 * - エコーキャンセレーション
 * - 自動ゲイン制御 (AGC)
 * - ダイナミックレンジ圧縮
 * - 音質モニタリング
 * - バッファ管理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 音声処理設定インターフェース
 */
export interface AudioProcessingConfig {
    /** サンプリングレート (Hz) */
    sampleRate: number;
    /** チャンネル数 */
    channelCount: number;
    /** バッファサイズ */
    bufferSize: number;
    /** エコーキャンセレーション有効化 */
    echoCancellation: boolean;
    /** ノイズ抑制有効化 */
    noiseSuppression: boolean;
    /** 自動ゲイン制御有効化 */
    autoGainControl: boolean;
    /** ノイズゲート閾値 */
    noiseGateThreshold: number;
    /** コンプレッサー閾値 (dB) */
    compressorThreshold: number;
    /** コンプレッサー比率 */
    compressorRatio: number;
}

/**
 * 音声品質メトリクスインターフェース
 */
export interface AudioQualityMetrics {
    /** RMS レベル */
    rmsLevel: number;
    /** ピークレベル */
    peakLevel: number;
    /** クリッピング検出 */
    isClipping: boolean;
    /** SNR (Signal-to-Noise Ratio) */
    snr?: number;
    /** 処理レイテンシ (ms) */
    latency: number;
}

/**
 * 音声処理パイプラインクラス
 */
export class AudioProcessingPipeline {
    private readonly config: Required<AudioProcessingConfig>;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;

    // 音声処理ノード
    private noiseGateNode: GainNode | null = null;
    private compressorNode: DynamicsCompressorNode | null = null;
    private gainNode: GainNode | null = null;

    // 状態
    private isActive: boolean = false;
    private audioCallback: ((audioData: Float32Array) => void) | null = null;

    // メトリクス
    private readonly peakHistory: number[] = [];
    private readonly peakHistorySize: number = 100;

    /**
     * コンストラクタ
     *
     * @param config - 音声処理設定
     */
    constructor(config: Partial<AudioProcessingConfig> = {}) {
        this.config = {
            sampleRate: config.sampleRate ?? 24000,
            channelCount: config.channelCount ?? 1,
            bufferSize: config.bufferSize ?? 4096,
            echoCancellation: config.echoCancellation ?? true,
            noiseSuppression: config.noiseSuppression ?? true,
            autoGainControl: config.autoGainControl ?? true,
            noiseGateThreshold: config.noiseGateThreshold ?? 0.01,
            compressorThreshold: config.compressorThreshold ?? -24,
            compressorRatio: config.compressorRatio ?? 12
        };

        logger.info('AudioProcessingPipeline initialized', {
            sampleRate: this.config.sampleRate,
            bufferSize: this.config.bufferSize
        });
    }

    /**
     * 音声処理を開始
     *
     * @param callback - 音声データコールバック
     * @returns Promise<void>
     */
    public async start(callback: (audioData: Float32Array) => void): Promise<void> {
        if (this.isActive) {
            logger.warn('AudioProcessingPipeline already active');
            return;
        }

        this.audioCallback = callback;

        try {
            // マイクアクセス取得
            const constraints: MediaStreamConstraints = {
                audio: {
                    channelCount: this.config.channelCount,
                    sampleRate: this.config.sampleRate,
                    echoCancellation: this.config.echoCancellation,
                    noiseSuppression: this.config.noiseSuppression,
                    autoGainControl: this.config.autoGainControl
                } as MediaTrackConstraints
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            // AudioContext 作成
            const AudioContextClass =
                globalThis.AudioContext ||
                (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
                    .webkitAudioContext;
            if (!AudioContextClass) {
                throw new Error('AudioContext is not supported');
            }
            this.audioContext = new AudioContextClass({
                sampleRate: this.config.sampleRate
            });

            // ソースノード作成
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

            // 処理ノード作成
            this.createProcessingNodes();

            // ノード接続
            this.connectNodes();

            this.isActive = true;
            logger.info('AudioProcessingPipeline started');
        } catch (error) {
            logger.error('Failed to start AudioProcessingPipeline', error);
            throw error;
        }
    }

    /**
     * 音声処理を停止
     */
    public stop(): void {
        if (!this.isActive) {
            return;
        }

        // ノード切断
        this.disconnectNodes();

        // メディアストリーム停止
        if (this.mediaStream) {
            for (const track of this.mediaStream.getTracks()) {
                track.stop();
            }
            this.mediaStream = null;
        }

        // AudioContext クローズ
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isActive = false;
        this.audioCallback = null;

        logger.info('AudioProcessingPipeline stopped');
    }

    /**
     * 処理ノードを作成
     *
     * @private
     */
    private async createProcessingNodes(): Promise<void> {
        if (!this.audioContext) {
            throw new Error('AudioContext not initialized');
        }

        // ノイズゲート（GainNode で実装）
        this.noiseGateNode = this.audioContext.createGain();
        this.noiseGateNode.gain.value = 1;

        // コンプレッサー
        this.compressorNode = this.audioContext.createDynamicsCompressor();
        this.compressorNode.threshold.value = this.config.compressorThreshold;
        this.compressorNode.knee.value = 30;
        this.compressorNode.ratio.value = this.config.compressorRatio;
        this.compressorNode.attack.value = 0.003;
        this.compressorNode.release.value = 0.25;

        // ゲインノード
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1;

        // AudioWorklet を優先使用、フォールバックで ScriptProcessorNode
        try {
            await this.setupAudioWorklet();
        } catch (error) {
            logger.warn('AudioWorklet setup failed, falling back to ScriptProcessorNode', error);
            this.setupScriptProcessor();
        }
    }

    /**
     * AudioWorklet をセットアップ（推奨）
     *
     * @private
     */
    private async setupAudioWorklet(): Promise<void> {
        if (!this.audioContext) {
            throw new Error('AudioContext not initialized');
        }

        // AudioWorklet モジュールをロード
        await this.audioContext.audioWorklet.addModule('audio-processor-worklet.js');

        // AudioWorkletNode を作成
        this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor-worklet');

        // メッセージハンドラーを設定
        this.workletNode.port.onmessage = (event) => {
            if (event.data.type === 'audiodata' && this.audioCallback) {
                const audioData = event.data.data as Float32Array;
                this.processAudioData(audioData);
            }
        };

        logger.info('AudioWorklet setup completed');
    }

    /**
     * ScriptProcessorNode をセットアップ（フォールバック）
     *
     * @private
     */
    private setupScriptProcessor(): void {
        if (!this.audioContext) {
            throw new Error('AudioContext not initialized');
        }

        // プロセッサーノード
        this.processorNode = this.audioContext.createScriptProcessor(
            this.config.bufferSize,
            this.config.channelCount,
            this.config.channelCount
        );

        this.processorNode.onaudioprocess = (event) => {
            this.processAudio(event);
        };

        logger.info('ScriptProcessorNode setup completed (fallback)');
    }

    /**
     * ノードを接続
     *
     * @private
     */
    private connectNodes(): void {
        if (
            !this.sourceNode ||
            !this.noiseGateNode ||
            !this.compressorNode ||
            !this.gainNode ||
            !this.audioContext
        ) {
            throw new Error('Audio nodes not initialized');
        }

        // AudioWorklet または ScriptProcessorNode のいずれかが必要
        if (!this.workletNode && !this.processorNode) {
            throw new Error('Neither AudioWorkletNode nor ScriptProcessorNode initialized');
        }

        // 接続チェーン: Source -> NoiseGate -> Compressor -> Gain -> Processor/Worklet -> Destination
        this.sourceNode.connect(this.noiseGateNode);
        this.noiseGateNode.connect(this.compressorNode);
        this.compressorNode.connect(this.gainNode);

        if (this.workletNode) {
            // AudioWorklet を使用
            this.gainNode.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);
        } else if (this.processorNode) {
            // ScriptProcessorNode を使用（フォールバック）
            this.gainNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);
        }
    }

    /**
     * ノードを切断
     *
     * @private
     */
    private disconnectNodes(): void {
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        if (this.noiseGateNode) {
            this.noiseGateNode.disconnect();
            this.noiseGateNode = null;
        }
        if (this.compressorNode) {
            this.compressorNode.disconnect();
            this.compressorNode = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }
    }

    /**
     * 音声データを処理（AudioWorklet用）
     *
     * @private
     * @param audioData - 音声データ
     */
    private processAudioData(audioData: Float32Array): void {
        if (!this.isActive || !this.audioCallback) {
            return;
        }

        const startTime = performance.now();

        // ノイズゲート適用
        const gatedData = this.applyNoiseGate(audioData);

        // メトリクス計算
        this.calculateMetrics(gatedData, startTime);

        // コールバック呼び出し
        this.audioCallback(gatedData);
    }

    /**
     * 音声データを処理
     *
     * @private
     * @param event - AudioProcessingEvent
     */
    private processAudio(event: AudioProcessingEvent): void {
        if (!this.isActive || !this.audioCallback) {
            return;
        }

        const startTime = performance.now();
        const inputData = event.inputBuffer.getChannelData(0);

        // ノイズゲート適用
        const gatedData = this.applyNoiseGate(inputData);

        // メトリクス計算
        this.calculateMetrics(gatedData, startTime);

        // コールバック呼び出し
        this.audioCallback(gatedData);
    }

    /**
     * ノイズゲートを適用
     *
     * @private
     * @param audioData - 音声データ
     * @returns ゲート適用後の音声データ
     */
    private applyNoiseGate(audioData: Float32Array): Float32Array {
        const output = new Float32Array(audioData.length);
        const threshold = this.config.noiseGateThreshold;

        for (let i = 0; i < audioData.length; i++) {
            const sample = audioData[i];
            if (sample === undefined) {
                continue;
            }

            const magnitude = Math.abs(sample);

            if (magnitude > threshold) {
                output[i] = sample;
            } else {
                output[i] = 0;
            }
        }

        return output;
    }

    /**
     * 音質メトリクスを計算
     *
     * @private
     * @param audioData - 音声データ
     * @param startTime - 処理開始時刻
     * @returns 音質メトリクス
     */
    private calculateMetrics(audioData: Float32Array, startTime: number): AudioQualityMetrics {
        // RMS レベル計算
        let sumSquares = 0;
        let peak = 0;

        for (const value of audioData) {
            if (value === undefined) {
                continue;
            }

            const sample = Math.abs(value);
            sumSquares += sample * sample;
            peak = Math.max(peak, sample);
        }

        const rmsLevel = Math.sqrt(sumSquares / audioData.length);

        // ピーク履歴更新
        this.peakHistory.push(peak);
        if (this.peakHistory.length > this.peakHistorySize) {
            this.peakHistory.shift();
        }

        // クリッピング検出
        const isClipping = peak > 0.99;

        // レイテンシ計算
        const latency = performance.now() - startTime;

        return {
            rmsLevel,
            peakLevel: peak,
            isClipping,
            latency
        };
    }

    /**
     * 設定を更新
     *
     * @param config - 新しい設定
     */
    public updateConfig(config: Partial<AudioProcessingConfig>): void {
        Object.assign(this.config, config);

        // コンプレッサー設定更新
        if (this.compressorNode) {
            if (config.compressorThreshold !== undefined) {
                this.compressorNode.threshold.value = config.compressorThreshold;
            }
            if (config.compressorRatio !== undefined) {
                this.compressorNode.ratio.value = config.compressorRatio;
            }
        }

        logger.info('AudioProcessingPipeline config updated', config);
    }

    /**
     * アクティブ状態を取得
     *
     * @returns アクティブ状態
     */
    public isProcessing(): boolean {
        return this.isActive;
    }
}
