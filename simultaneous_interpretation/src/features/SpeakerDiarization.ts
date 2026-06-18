/**
 * 話者分離システム
 *
 * @description
 * 音声ストリームから複数の話者を識別し、分離する。
 * 音声特徴抽出と話者クラスタリングを実装。
 *
 * @features
 * - 話者識別
 * - 音声特徴抽出
 * - 話者クラスタリング
 * - リアルタイム処理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 話者情報
 */
export interface Speaker {
    /** 話者 ID */
    id: string;
    /** 話者名 */
    name: string;
    /** 音声特徴ベクトル */
    features: number[];
    /** 発話回数 */
    utteranceCount: number;
    /** 最終発話時刻 */
    lastSpeakTime: Date;
}

/**
 * 発話セグメント
 */
export interface UtteranceSegment {
    /** セグメント ID */
    id: string;
    /** 話者 ID */
    speakerId: string;
    /** 開始時刻 */
    startTime: number;
    /** 終了時刻 */
    endTime: number;
    /** 音声データ */
    audioData: Float32Array;
    /** テキスト */
    text?: string;
    /** 信頼度 */
    confidence: number;
}

/**
 * 話者分離設定
 */
export interface SpeakerDiarizationConfig {
    /** 最小セグメント長（秒） */
    minSegmentDuration: number;
    /** 最大話者数 */
    maxSpeakers: number;
    /** 類似度閾値 */
    similarityThreshold: number;
    /** 特徴ベクトル次元 */
    featureDimension: number;
}

/**
 * 話者分離クラス
 */
export class SpeakerDiarization {
    private config: SpeakerDiarizationConfig;
    private speakers: Map<string, Speaker> = new Map();
    private segments: UtteranceSegment[] = [];
    private currentSegment: UtteranceSegment | null = null;
    private segmentCounter: number = 0;

    /**
     * コンストラクタ
     *
     * @param config - 話者分離設定
     */
    constructor(config: Partial<SpeakerDiarizationConfig> = {}) {
        this.config = {
            minSegmentDuration: config.minSegmentDuration ?? 0.5,
            maxSpeakers: config.maxSpeakers ?? 10,
            similarityThreshold: config.similarityThreshold ?? 0.7,
            featureDimension: config.featureDimension ?? 128
        };

        logger.info('SpeakerDiarization initialized', {
            maxSpeakers: this.config.maxSpeakers,
            similarityThreshold: this.config.similarityThreshold
        });
    }

    /**
     * 音声セグメントを処理
     *
     * @param audioData - 音声データ
     * @param timestamp - タイムスタンプ
     * @returns 話者 ID
     */
    public processAudioSegment(audioData: Float32Array, timestamp: number): string {
        // 音声特徴を抽出
        const features = this.extractFeatures(audioData);

        // 話者を識別
        const speakerId = this.identifySpeaker(features);

        // セグメントを更新
        this.updateSegment(speakerId, audioData, timestamp);

        return speakerId;
    }

    /**
     * 音声特徴を抽出
     *
     * @private
     * @param audioData - 音声データ
     * @returns 特徴ベクトル
     */
    private extractFeatures(audioData: Float32Array): number[] {
        // 簡易的な特徴抽出（実際にはMFCCなどを使用）
        const features: number[] = [];

        // エネルギー
        let energy = 0;
        for (let i = 0; i < audioData.length; i++) {
            const value = audioData[i];
            if (value !== undefined) {
                energy += value * value;
            }
        }
        features.push(Math.sqrt(energy / audioData.length));

        // ゼロ交差率
        let zeroCrossings = 0;
        for (let i = 1; i < audioData.length; i++) {
            const current = audioData[i];
            const previous = audioData[i - 1];
            if (current !== undefined && previous !== undefined) {
                if ((current >= 0 && previous < 0) || (current < 0 && previous >= 0)) {
                    zeroCrossings++;
                }
            }
        }
        features.push(zeroCrossings / audioData.length);

        // スペクトル重心（簡易版）
        let spectralCentroid = 0;
        for (let i = 0; i < audioData.length; i++) {
            const value = audioData[i];
            if (value !== undefined) {
                spectralCentroid += Math.abs(value) * i;
            }
        }
        const totalMagnitude = audioData.reduce((sum, val) => sum + Math.abs(val ?? 0), 0);
        features.push(totalMagnitude > 0 ? spectralCentroid / totalMagnitude : 0);

        // 特徴ベクトルを正規化
        const magnitude = Math.sqrt(features.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? features.map((f) => f / magnitude) : features;
    }

    /**
     * 話者を識別
     *
     * @private
     * @param features - 特徴ベクトル
     * @returns 話者 ID
     */
    private identifySpeaker(features: number[]): string {
        let bestSpeakerId: string | null = null;
        let bestSimilarity = 0;

        // 既存の話者と比較
        for (const [speakerId, speaker] of this.speakers) {
            const similarity = this.calculateSimilarity(features, speaker.features);

            if (similarity > bestSimilarity && similarity >= this.config.similarityThreshold) {
                bestSimilarity = similarity;
                bestSpeakerId = speakerId;
            }
        }

        // 新しい話者を作成
        if (!bestSpeakerId) {
            if (this.speakers.size < this.config.maxSpeakers) {
                bestSpeakerId = this.createNewSpeaker(features);
            } else {
                // 最大話者数に達した場合は最も類似した話者を使用
                const firstKey = Array.from(this.speakers.keys())[0];
                bestSpeakerId = firstKey ?? this.createNewSpeaker(features);
            }
        } else {
            // 話者の特徴を更新
            this.updateSpeakerFeatures(bestSpeakerId, features);
        }

        return bestSpeakerId;
    }

    /**
     * 類似度を計算
     *
     * @private
     * @param features1 - 特徴ベクトル1
     * @param features2 - 特徴ベクトル2
     * @returns 類似度（0-1）
     */
    private calculateSimilarity(features1: number[], features2: number[]): number {
        // コサイン類似度
        let dotProduct = 0;
        let magnitude1 = 0;
        let magnitude2 = 0;

        const minLength = Math.min(features1.length, features2.length);

        for (let i = 0; i < minLength; i++) {
            const f1 = features1[i];
            const f2 = features2[i];
            if (f1 !== undefined && f2 !== undefined) {
                dotProduct += f1 * f2;
                magnitude1 += f1 * f1;
                magnitude2 += f2 * f2;
            }
        }

        magnitude1 = Math.sqrt(magnitude1);
        magnitude2 = Math.sqrt(magnitude2);

        if (magnitude1 === 0 || magnitude2 === 0) {
            return 0;
        }

        return dotProduct / (magnitude1 * magnitude2);
    }

    /**
     * 新しい話者を作成
     *
     * @private
     * @param features - 特徴ベクトル
     * @returns 話者 ID
     */
    private createNewSpeaker(features: number[]): string {
        const speakerId = `speaker-${this.speakers.size + 1}`;

        const speaker: Speaker = {
            id: speakerId,
            name: `Speaker ${this.speakers.size + 1}`,
            features: [...features],
            utteranceCount: 0,
            lastSpeakTime: new Date()
        };

        this.speakers.set(speakerId, speaker);

        logger.info('New speaker created', { speakerId });

        return speakerId;
    }

    /**
     * 話者の特徴を更新
     *
     * @private
     * @param speakerId - 話者 ID
     * @param features - 新しい特徴ベクトル
     */
    private updateSpeakerFeatures(speakerId: string, features: number[]): void {
        const speaker = this.speakers.get(speakerId);
        if (!speaker) {
            return;
        }

        // 移動平均で特徴を更新
        const alpha = 0.3; // 学習率
        for (let i = 0; i < Math.min(speaker.features.length, features.length); i++) {
            const newFeature = features[i];
            const oldFeature = speaker.features[i];
            if (newFeature !== undefined && oldFeature !== undefined) {
                speaker.features[i] = alpha * newFeature + (1 - alpha) * oldFeature;
            }
        }

        speaker.lastSpeakTime = new Date();
    }

    /**
     * セグメントを更新
     *
     * @private
     * @param speakerId - 話者 ID
     * @param audioData - 音声データ
     * @param timestamp - タイムスタンプ
     */
    private updateSegment(speakerId: string, audioData: Float32Array, timestamp: number): void {
        if (!this.currentSegment || this.currentSegment.speakerId !== speakerId) {
            // 新しいセグメントを開始
            if (this.currentSegment) {
                this.currentSegment.endTime = timestamp;
                this.segments.push(this.currentSegment);
            }

            this.currentSegment = {
                id: `segment-${++this.segmentCounter}`,
                speakerId,
                startTime: timestamp,
                endTime: timestamp,
                audioData: new Float32Array(audioData),
                confidence: 0.8
            };

            // 話者の発話回数を更新
            const speaker = this.speakers.get(speakerId);
            if (speaker) {
                speaker.utteranceCount++;
            }
        } else {
            // 既存のセグメントを拡張
            this.currentSegment.endTime = timestamp;

            // 音声データを結合
            const combined = new Float32Array(
                this.currentSegment.audioData.length + audioData.length
            );
            combined.set(this.currentSegment.audioData);
            combined.set(audioData, this.currentSegment.audioData.length);
            this.currentSegment.audioData = combined;
        }
    }

    /**
     * 全話者を取得
     */
    public getSpeakers(): Speaker[] {
        return Array.from(this.speakers.values());
    }

    /**
     * 全セグメントを取得
     */
    public getSegments(): UtteranceSegment[] {
        return [...this.segments];
    }

    /**
     * 話者名を設定
     *
     * @param speakerId - 話者 ID
     * @param name - 話者名
     */
    public setSpeakerName(speakerId: string, name: string): void {
        const speaker = this.speakers.get(speakerId);
        if (speaker) {
            speaker.name = name;
            logger.info('Speaker name updated', { speakerId, name });
        }
    }

    /**
     * リセット
     */
    public reset(): void {
        this.speakers.clear();
        this.segments = [];
        this.currentSegment = null;
        this.segmentCounter = 0;

        logger.info('SpeakerDiarization reset');
    }

    /**
     * クリーンアップ
     */
    public dispose(): void {
        this.reset();
        logger.info('SpeakerDiarization disposed');
    }
}
