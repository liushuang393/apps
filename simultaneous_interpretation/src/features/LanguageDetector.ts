/**
 * 自動言語検出システム
 *
 * @description
 * 音声やテキストから言語を自動検出する。
 * 複数の検出手法を組み合わせて精度を向上。
 *
 * @features
 * - テキストベース言語検出
 * - 音声特徴ベース言語検出
 * - 信頼度スコア
 * - 複数言語対応
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 言語検出結果
 */
export interface LanguageDetectionResult {
    /** 言語コード */
    language: string;
    /** 信頼度（0-1） */
    confidence: number;
    /** 検出方法 */
    method: 'text' | 'audio' | 'hybrid';
}

/**
 * 言語統計
 */
interface LanguageStats {
    /** 言語コード */
    language: string;
    /** 出現回数 */
    count: number;
    /** 累積信頼度 */
    totalConfidence: number;
}

/**
 * 言語検出設定
 */
export interface LanguageDetectorConfig {
    /** デフォルト言語 */
    defaultLanguage: string;
    /** 最小信頼度閾値 */
    minConfidence: number;
    /** 履歴サイズ */
    historySize: number;
}

/**
 * 言語検出クラス
 */
export class LanguageDetector {
    private config: LanguageDetectorConfig;
    private detectionHistory: LanguageDetectionResult[] = [];
    private languageStats: Map<string, LanguageStats> = new Map();

    // 言語パターン（簡易版）
    private readonly languagePatterns: Map<string, RegExp[]> = new Map([
        [
            'ja',
            [
                /[\u3040-\u309F]/, // ひらがな
                /[\u30A0-\u30FF]/, // カタカナ
                /[\u4E00-\u9FAF]/ // 漢字
            ]
        ],
        [
            'en',
            [
                /\b(the|is|are|was|were|have|has|had|do|does|did)\b/i,
                /\b(and|or|but|if|when|where|what|who|how)\b/i
            ]
        ],
        [
            'zh',
            [
                /[\u4E00-\u9FFF]/, // 中国語簡体字・繁体字
                /[\u3400-\u4DBF]/ // CJK拡張A
            ]
        ],
        [
            'ko',
            [
                /[\uAC00-\uD7AF]/, // ハングル
                /[\u1100-\u11FF]/ // ハングル字母
            ]
        ],
        [
            'es',
            [/\b(el|la|los|las|un|una|de|del|al)\b/i, /\b(es|son|está|están|hay|tiene|tienen)\b/i]
        ],
        ['fr', [/\b(le|la|les|un|une|de|du|des|au|aux)\b/i, /\b(est|sont|a|ont|fait|font)\b/i]],
        [
            'de',
            [
                /\b(der|die|das|den|dem|des|ein|eine|einen|einem)\b/i,
                /\b(ist|sind|hat|haben|wird|werden)\b/i
            ]
        ]
    ]);

    /**
     * コンストラクタ
     *
     * @param config - 言語検出設定
     */
    constructor(config: Partial<LanguageDetectorConfig> = {}) {
        this.config = {
            defaultLanguage: config.defaultLanguage ?? 'en',
            minConfidence: config.minConfidence ?? 0.5,
            historySize: config.historySize ?? 10
        };

        logger.info('LanguageDetector initialized', {
            defaultLanguage: this.config.defaultLanguage
        });
    }

    /**
     * テキストから言語を検出
     *
     * @param text - テキスト
     * @returns 検出結果
     */
    public detectFromText(text: string): LanguageDetectionResult {
        if (!text || text.trim().length === 0) {
            return {
                language: this.config.defaultLanguage,
                confidence: 0,
                method: 'text'
            };
        }

        const scores: Map<string, number> = new Map();

        // 各言語のパターンマッチング
        for (const [language, patterns] of this.languagePatterns) {
            let score = 0;

            for (const pattern of patterns) {
                const matches = text.match(pattern);
                if (matches) {
                    score += matches.length;
                }
            }

            if (score > 0) {
                scores.set(language, score);
            }
        }

        // 最高スコアの言語を選択
        let bestLanguage = this.config.defaultLanguage;
        let bestScore = 0;

        for (const [language, score] of scores) {
            if (score > bestScore) {
                bestScore = score;
                bestLanguage = language;
            }
        }

        // 信頼度を計算
        const totalScore = Array.from(scores.values()).reduce((sum, s) => sum + s, 0);
        const confidence = totalScore > 0 ? bestScore / totalScore : 0;

        const result: LanguageDetectionResult = {
            language: bestLanguage,
            confidence,
            method: 'text'
        };

        this.updateHistory(result);

        return result;
    }

    /**
     * 音声データから言語を検出
     *
     * @param audioData - 音声データ
     * @returns 検出結果
     */
    public detectFromAudio(audioData: Float32Array): LanguageDetectionResult {
        // 簡易的な音声特徴ベース検出
        // 実際にはより高度な音響モデルを使用

        // エネルギーとピッチの特徴を抽出
        const energy = this.calculateEnergy(audioData);
        const pitch = this.estimatePitch(audioData);

        // 簡易的な言語推定（実際にはMLモデルを使用）
        let language = this.config.defaultLanguage;
        let confidence = 0.3;

        // 高エネルギー・高ピッチ → 日本語の可能性
        if (energy > 0.5 && pitch > 200) {
            language = 'ja';
            confidence = 0.6;
        }
        // 低エネルギー・低ピッチ → 英語の可能性
        else if (energy < 0.3 && pitch < 150) {
            language = 'en';
            confidence = 0.6;
        }

        const result: LanguageDetectionResult = {
            language,
            confidence,
            method: 'audio'
        };

        this.updateHistory(result);

        return result;
    }

    /**
     * ハイブリッド検出
     *
     * @param text - テキスト
     * @param audioData - 音声データ
     * @returns 検出結果
     */
    public detectHybrid(text: string, audioData: Float32Array): LanguageDetectionResult {
        const textResult = this.detectFromText(text);
        const audioResult = this.detectFromAudio(audioData);

        // 両方の結果を組み合わせ
        if (textResult.language === audioResult.language) {
            return {
                language: textResult.language,
                confidence: Math.max(textResult.confidence, audioResult.confidence),
                method: 'hybrid'
            };
        }

        // 信頼度が高い方を選択
        if (textResult.confidence > audioResult.confidence) {
            return { ...textResult, method: 'hybrid' };
        } else {
            return { ...audioResult, method: 'hybrid' };
        }
    }

    /**
     * 履歴から最も可能性の高い言語を取得
     */
    public getMostLikelyLanguage(): string {
        if (this.detectionHistory.length === 0) {
            return this.config.defaultLanguage;
        }

        // 統計を更新
        this.updateLanguageStats();

        // 最も出現回数が多く、信頼度が高い言語を選択
        let bestLanguage = this.config.defaultLanguage;
        let bestScore = 0;

        for (const [language, stats] of this.languageStats) {
            const score = stats.count * (stats.totalConfidence / stats.count);
            if (score > bestScore) {
                bestScore = score;
                bestLanguage = language;
            }
        }

        return bestLanguage;
    }

    /**
     * エネルギーを計算
     *
     * @private
     * @param audioData - 音声データ
     * @returns エネルギー
     */
    private calculateEnergy(audioData: Float32Array): number {
        let energy = 0;
        for (let i = 0; i < audioData.length; i++) {
            const value = audioData[i];
            if (value !== undefined) {
                energy += value * value;
            }
        }
        return Math.sqrt(energy / audioData.length);
    }

    /**
     * ピッチを推定
     *
     * @private
     * @param audioData - 音声データ
     * @returns ピッチ（Hz）
     */
    private estimatePitch(audioData: Float32Array): number {
        // 簡易的な自己相関法
        const sampleRate = 24000;
        const minPeriod = Math.floor(sampleRate / 500); // 500 Hz
        const maxPeriod = Math.floor(sampleRate / 50); // 50 Hz

        let bestPeriod = minPeriod;
        let bestCorrelation = 0;

        for (let period = minPeriod; period <= maxPeriod; period++) {
            let correlation = 0;
            const samples = Math.min(audioData.length - period, 1000);

            for (let i = 0; i < samples; i++) {
                const value1 = audioData[i];
                const value2 = audioData[i + period];
                if (value1 !== undefined && value2 !== undefined) {
                    correlation += value1 * value2;
                }
            }

            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestPeriod = period;
            }
        }

        return sampleRate / bestPeriod;
    }

    /**
     * 履歴を更新
     *
     * @private
     * @param result - 検出結果
     */
    private updateHistory(result: LanguageDetectionResult): void {
        this.detectionHistory.push(result);

        // 履歴サイズを制限
        if (this.detectionHistory.length > this.config.historySize) {
            this.detectionHistory.shift();
        }
    }

    /**
     * 言語統計を更新
     *
     * @private
     */
    private updateLanguageStats(): void {
        this.languageStats.clear();

        for (const result of this.detectionHistory) {
            if (result.confidence < this.config.minConfidence) {
                continue;
            }

            const stats = this.languageStats.get(result.language) || {
                language: result.language,
                count: 0,
                totalConfidence: 0
            };

            stats.count++;
            stats.totalConfidence += result.confidence;

            this.languageStats.set(result.language, stats);
        }
    }

    /**
     * リセット
     */
    public reset(): void {
        this.detectionHistory = [];
        this.languageStats.clear();

        logger.info('LanguageDetector reset');
    }

    /**
     * クリーンアップ
     */
    public dispose(): void {
        this.reset();
        logger.info('LanguageDetector disposed');
    }
}
