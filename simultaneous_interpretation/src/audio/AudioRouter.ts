/**
 * 音声ルーティングシステム
 *
 * @description
 * 複数の音声ソースを管理し、ミキシング、ルーティングを行うクラス。
 * マイク入力とシステム音声を統合して処理。
 *
 * @features
 * - 複数音声ソースの管理
 * - 音声ミキシング
 * - ボリューム制御
 * - 音声ルーティング
 * - リアルタイム処理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 音声ソース
 */
export interface AudioSource {
    /** ソース ID */
    id: string;
    /** ソース名 */
    name: string;
    /** MediaStream */
    stream: MediaStream;
    /** ボリューム (0.0 - 1.0) */
    volume: number;
    /** ミュート状態 */
    muted: boolean;
    /** 有効状態 */
    enabled: boolean;
}

/**
 * 音声ルーティング設定
 */
export interface AudioRoutingConfig {
    /** サンプリングレート */
    sampleRate: number;
    /** バッファサイズ */
    bufferSize: number;
    /** チャンネル数 */
    channelCount: number;
}

/**
 * 音声ルーティングクラス
 */
export class AudioRouter {
    private config: AudioRoutingConfig;
    private audioContext: AudioContext | null = null;
    private sources: Map<string, AudioSource> = new Map();
    private sourceNodes: Map<string, MediaStreamAudioSourceNode> = new Map();
    private gainNodes: Map<string, GainNode> = new Map();
    private mixerNode: GainNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    private audioCallback: ((audioData: Float32Array) => void) | null = null;
    private isActive: boolean = false;

    /**
     * コンストラクタ
     *
     * @param config - 音声ルーティング設定
     */
    constructor(config: Partial<AudioRoutingConfig> = {}) {
        this.config = {
            sampleRate: config.sampleRate ?? 24000,
            bufferSize: config.bufferSize ?? 4096,
            channelCount: config.channelCount ?? 1
        };

        logger.info('AudioRouter initialized', {
            sampleRate: this.config.sampleRate,
            bufferSize: this.config.bufferSize
        });
    }

    /**
     * 音声ルーティングを開始
     *
     * @param callback - 音声データコールバック
     */
    public async start(callback: (audioData: Float32Array) => void): Promise<void> {
        if (this.isActive) {
            logger.warn('AudioRouter is already active');
            return;
        }

        this.audioCallback = callback;

        // AudioContext 作成
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('AudioContext is not supported');
        }
        this.audioContext = new AudioContextClass({
            sampleRate: this.config.sampleRate
        });

        // ミキサーノード作成
        this.mixerNode = this.audioContext.createGain();
        this.mixerNode.gain.value = 1.0;

        // プロセッサーノード作成
        this.processorNode = this.audioContext.createScriptProcessor(
            this.config.bufferSize,
            this.config.channelCount,
            this.config.channelCount
        );

        this.processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
            this.processAudio(event);
        };

        // ノード接続
        this.mixerNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);

        this.isActive = true;

        logger.info('AudioRouter started');
    }

    /**
     * 音声ルーティングを停止
     */
    public stop(): void {
        if (!this.isActive) {
            return;
        }

        // 全ソースを削除
        for (const sourceId of this.sources.keys()) {
            this.removeSource(sourceId);
        }

        // ノードを切断
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }

        if (this.mixerNode) {
            this.mixerNode.disconnect();
            this.mixerNode = null;
        }

        // AudioContext を閉じる
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isActive = false;

        logger.info('AudioRouter stopped');
    }

    /**
     * 音声ソースを追加
     *
     * @param id - ソース ID
     * @param name - ソース名
     * @param stream - MediaStream
     * @param volume - ボリューム (0.0 - 1.0)
     */
    public addSource(id: string, name: string, stream: MediaStream, volume: number = 1.0): void {
        if (!this.audioContext || !this.mixerNode) {
            logger.error('AudioRouter is not started');
            return;
        }

        if (this.sources.has(id)) {
            logger.warn('Source already exists', { id });
            return;
        }

        // ソース情報を保存
        const source: AudioSource = {
            id,
            name,
            stream,
            volume,
            muted: false,
            enabled: true
        };

        this.sources.set(id, source);

        // AudioNode を作成
        const sourceNode = this.audioContext.createMediaStreamSource(stream);
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = volume;

        // ノード接続
        sourceNode.connect(gainNode);
        gainNode.connect(this.mixerNode);

        this.sourceNodes.set(id, sourceNode);
        this.gainNodes.set(id, gainNode);

        logger.info('Audio source added', { id, name, volume });
    }

    /**
     * 音声ソースを削除
     *
     * @param id - ソース ID
     */
    public removeSource(id: string): void {
        const source = this.sources.get(id);
        if (!source) {
            logger.warn('Source not found', { id });
            return;
        }

        // ノードを切断
        const sourceNode = this.sourceNodes.get(id);
        const gainNode = this.gainNodes.get(id);

        if (sourceNode) {
            sourceNode.disconnect();
            this.sourceNodes.delete(id);
        }

        if (gainNode) {
            gainNode.disconnect();
            this.gainNodes.delete(id);
        }

        // ストリームを停止
        source.stream.getTracks().forEach((track) => track.stop());

        this.sources.delete(id);

        logger.info('Audio source removed', { id });
    }

    /**
     * ソースのボリュームを設定
     *
     * @param id - ソース ID
     * @param volume - ボリューム (0.0 - 1.0)
     */
    public setSourceVolume(id: string, volume: number): void {
        const source = this.sources.get(id);
        const gainNode = this.gainNodes.get(id);

        if (!source || !gainNode) {
            logger.warn('Source not found', { id });
            return;
        }

        source.volume = Math.max(0, Math.min(1, volume));
        gainNode.gain.value = source.muted ? 0 : source.volume;

        logger.debug('Source volume changed', { id, volume: source.volume });
    }

    /**
     * ソースをミュート/ミュート解除
     *
     * @param id - ソース ID
     * @param muted - ミュート状態
     */
    public setSourceMuted(id: string, muted: boolean): void {
        const source = this.sources.get(id);
        const gainNode = this.gainNodes.get(id);

        if (!source || !gainNode) {
            logger.warn('Source not found', { id });
            return;
        }

        source.muted = muted;
        gainNode.gain.value = muted ? 0 : source.volume;

        logger.info('Source mute changed', { id, muted });
    }

    /**
     * ソースを有効/無効化
     *
     * @param id - ソース ID
     * @param enabled - 有効状態
     */
    public setSourceEnabled(id: string, enabled: boolean): void {
        const source = this.sources.get(id);

        if (!source) {
            logger.warn('Source not found', { id });
            return;
        }

        source.enabled = enabled;

        // トラックを有効/無効化
        source.stream.getAudioTracks().forEach((track) => {
            track.enabled = enabled;
        });

        logger.info('Source enabled changed', { id, enabled });
    }

    /**
     * 全ソースを取得
     */
    public getSources(): AudioSource[] {
        return Array.from(this.sources.values());
    }

    /**
     * ソースを取得
     *
     * @param id - ソース ID
     */
    public getSource(id: string): AudioSource | undefined {
        return this.sources.get(id);
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

        const inputData = event.inputBuffer.getChannelData(0);

        // コールバックを呼び出し
        this.audioCallback(inputData);
    }

    /**
     * アクティブ状態を取得
     */
    public isRouterActive(): boolean {
        return this.isActive;
    }

    /**
     * クリーンアップ
     */
    public dispose(): void {
        this.stop();
        logger.info('AudioRouter disposed');
    }
}
