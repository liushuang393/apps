/**
 * 翻訳品質管理システム
 *
 * @description
 * リアルタイム翻訳の品質とレイテンシを最適化するクラス。
 * 翻訳キャッシュ、品質評価、API 呼び出し最適化を含む。
 *
 * @features
 * - 翻訳結果のキャッシング
 * - 翻訳品質スコアリング
 * - レイテンシ追跡と最適化
 * - API 呼び出し戦略の最適化
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { Logger, LogLevel } from '../utils/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 翻訳結果インターフェース
 */
export interface TranslationResult {
    /** 元のテキスト */
    sourceText: string;
    /** 翻訳されたテキスト */
    translatedText: string;
    /** ソース言語 */
    sourceLang: string;
    /** ターゲット言語 */
    targetLang: string;
    /** 品質スコア (0-1) */
    qualityScore?: number;
    /** レイテンシ (ms) */
    latency: number;
    /** タイムスタンプ */
    timestamp: number;
    /** キャッシュヒット */
    cached: boolean;
}

/**
 * 翻訳キャッシュエントリ
 */
interface CacheEntry {
    translatedText: string;
    qualityScore: number;
    timestamp: number;
    hitCount: number;
}

/**
 * 翻訳統計
 */
export interface TranslationStats {
    /** 総翻訳数 */
    totalTranslations: number;
    /** キャッシュヒット数 */
    cacheHits: number;
    /** キャッシュミス数 */
    cacheMisses: number;
    /** キャッシュヒット率 */
    cacheHitRate: number;
    /** 平均レイテンシ (ms) */
    averageLatency: number;
    /** 平均品質スコア */
    averageQuality: number;
    /** 最小レイテンシ (ms) */
    minLatency: number;
    /** 最大レイテンシ (ms) */
    maxLatency: number;
}

/**
 * 翻訳品質管理設定
 */
export interface TranslationQualityConfig {
    /** キャッシュサイズ */
    cacheSize: number;
    /** キャッシュ有効期限 (ms) */
    cacheTTL: number;
    /** 品質スコア閾値 */
    qualityThreshold: number;
    /** レイテンシ目標 (ms) */
    latencyTarget: number;
    /** 類似度閾値（キャッシュマッチング用） */
    similarityThreshold: number;
}

/**
 * 翻訳品質管理クラス
 */
export class TranslationQualityManager {
    private config: Required<TranslationQualityConfig>;
    private cache: Map<string, CacheEntry> = new Map();
    private stats: TranslationStats;
    private latencyHistory: number[] = [];
    private qualityHistory: number[] = [];
    private readonly historySize: number = 100;

    /**
     * コンストラクタ
     *
     * @param config - 翻訳品質管理設定
     */
    constructor(config: Partial<TranslationQualityConfig> = {}) {
        this.config = {
            cacheSize: config.cacheSize ?? 1000,
            cacheTTL: config.cacheTTL ?? 3600000, // 1 hour
            qualityThreshold: config.qualityThreshold ?? 0.7,
            latencyTarget: config.latencyTarget ?? 500,
            similarityThreshold: config.similarityThreshold ?? 0.9
        };

        this.stats = this.createEmptyStats();

        logger.info('TranslationQualityManager initialized', {
            cacheSize: this.config.cacheSize,
            latencyTarget: this.config.latencyTarget
        });
    }

    /**
     * 翻訳を処理
     *
     * @param sourceText - 元のテキスト
     * @param sourceLang - ソース言語
     * @param targetLang - ターゲット言語
     * @param translationFn - 翻訳関数
     * @returns 翻訳結果
     */
    public async translate(
        sourceText: string,
        sourceLang: string,
        targetLang: string,
        translationFn: (text: string) => Promise<string>
    ): Promise<TranslationResult> {
        const startTime = performance.now();

        // キャッシュチェック
        const cacheKey = this.generateCacheKey(sourceText, sourceLang, targetLang);
        const cached = this.getFromCache(cacheKey);

        let translatedText: string;
        let fromCache = false;
        let qualityScore: number;

        if (cached) {
            translatedText = cached.translatedText;
            qualityScore = cached.qualityScore;
            fromCache = true;
            this.stats.cacheHits++;
            cached.hitCount++;
            logger.debug('Cache hit', { sourceText: sourceText.substring(0, 50) });
        } else {
            // 翻訳実行
            translatedText = await translationFn(sourceText);
            this.stats.cacheMisses++;

            // 品質評価
            qualityScore = this.evaluateQuality(sourceText, translatedText);

            // キャッシュに保存
            this.addToCache(cacheKey, translatedText, qualityScore);

            logger.debug('Translation performed', {
                sourceText: sourceText.substring(0, 50),
                qualityScore
            });
        }

        const latency = performance.now() - startTime;

        // 統計更新
        this.updateStats(latency, qualityScore);

        const result: TranslationResult = {
            sourceText,
            translatedText,
            sourceLang,
            targetLang,
            qualityScore,
            latency,
            timestamp: Date.now(),
            cached: fromCache
        };

        return result;
    }

    /**
     * 翻訳品質を評価
     *
     * @private
     * @param sourceText - 元のテキスト
     * @param translatedText - 翻訳されたテキスト
     * @returns 品質スコア (0-1)
     */
    private evaluateQuality(sourceText: string, translatedText: string): number {
        // 簡易的な品質評価
        // 実際のプロダクションでは、より高度な評価アルゴリズムを使用

        let score = 1.0;

        // 長さチェック（極端に短い/長い翻訳は品質が低い可能性）
        const lengthRatio = translatedText.length / sourceText.length;
        if (lengthRatio < 0.3 || lengthRatio > 3.0) {
            score -= 0.2;
        }

        // 空白チェック
        if (translatedText.trim().length === 0) {
            score = 0;
        }

        // 繰り返しチェック
        if (this.hasExcessiveRepetition(translatedText)) {
            score -= 0.3;
        }

        // 特殊文字の過剰使用チェック
        const specialCharRatio =
            (translatedText.match(/[^\w\s]/g) || []).length / translatedText.length;
        if (specialCharRatio > 0.3) {
            score -= 0.2;
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * 過剰な繰り返しをチェック
     *
     * @private
     * @param text - テキスト
     * @returns 過剰な繰り返しがあるか
     */
    private hasExcessiveRepetition(text: string): boolean {
        const words = text.split(/\s+/);
        if (words.length < 3) {
            return false;
        }

        // 連続する同じ単語をチェック
        let maxRepeat = 1;
        let currentRepeat = 1;

        for (let i = 1; i < words.length; i++) {
            if (words[i] === words[i - 1]) {
                currentRepeat++;
                maxRepeat = Math.max(maxRepeat, currentRepeat);
            } else {
                currentRepeat = 1;
            }
        }

        return maxRepeat > 3;
    }

    /**
     * キャッシュキーを生成
     *
     * @private
     * @param sourceText - 元のテキスト
     * @param sourceLang - ソース言語
     * @param targetLang - ターゲット言語
     * @returns キャッシュキー
     */
    private generateCacheKey(sourceText: string, sourceLang: string, targetLang: string): string {
        const normalized = sourceText.toLowerCase().trim();
        return `${sourceLang}:${targetLang}:${normalized}`;
    }

    /**
     * キャッシュから取得
     *
     * @private
     * @param key - キャッシュキー
     * @returns キャッシュエントリ
     */
    private getFromCache(key: string): CacheEntry | null {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        // TTL チェック
        const age = Date.now() - entry.timestamp;
        if (age > this.config.cacheTTL) {
            this.cache.delete(key);
            return null;
        }

        return entry;
    }

    /**
     * キャッシュに追加
     *
     * @private
     * @param key - キャッシュキー
     * @param translatedText - 翻訳されたテキスト
     * @param qualityScore - 品質スコア
     */
    private addToCache(key: string, translatedText: string, qualityScore: number): void {
        // キャッシュサイズチェック
        if (this.cache.size >= this.config.cacheSize) {
            this.evictOldestEntry();
        }

        const entry: CacheEntry = {
            translatedText,
            qualityScore,
            timestamp: Date.now(),
            hitCount: 0
        };

        this.cache.set(key, entry);
    }

    /**
     * 最も古いエントリを削除
     *
     * @private
     */
    private evictOldestEntry(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /**
     * 統計を更新
     *
     * @private
     * @param latency - レイテンシ
     * @param qualityScore - 品質スコア
     */
    private updateStats(latency: number, qualityScore: number): void {
        this.stats.totalTranslations++;

        // レイテンシ履歴
        this.latencyHistory.push(latency);
        if (this.latencyHistory.length > this.historySize) {
            this.latencyHistory.shift();
        }

        // 品質履歴
        if (qualityScore > 0) {
            this.qualityHistory.push(qualityScore);
            if (this.qualityHistory.length > this.historySize) {
                this.qualityHistory.shift();
            }
        }

        // 統計計算
        this.stats.averageLatency = this.calculateAverage(this.latencyHistory);
        this.stats.averageQuality = this.calculateAverage(this.qualityHistory);
        this.stats.minLatency = Math.min(...this.latencyHistory);
        this.stats.maxLatency = Math.max(...this.latencyHistory);
        this.stats.cacheHitRate =
            this.stats.totalTranslations > 0
                ? this.stats.cacheHits / this.stats.totalTranslations
                : 0;
    }

    /**
     * 平均を計算
     *
     * @private
     * @param values - 値の配列
     * @returns 平均値
     */
    private calculateAverage(values: number[]): number {
        if (values.length === 0) {
            return 0;
        }
        const sum = values.reduce((a, b) => a + b, 0);
        return sum / values.length;
    }

    /**
     * 空の統計を作成
     *
     * @private
     * @returns 空の統計
     */
    private createEmptyStats(): TranslationStats {
        return {
            totalTranslations: 0,
            cacheHits: 0,
            cacheMisses: 0,
            cacheHitRate: 0,
            averageLatency: 0,
            averageQuality: 0,
            minLatency: 0,
            maxLatency: 0
        };
    }

    /**
     * 統計を取得
     *
     * @returns 翻訳統計
     */
    public getStats(): TranslationStats {
        return { ...this.stats };
    }

    /**
     * キャッシュをクリア
     */
    public clearCache(): void {
        this.cache.clear();
        logger.info('Translation cache cleared');
    }

    /**
     * 統計をリセット
     */
    public resetStats(): void {
        this.stats = this.createEmptyStats();
        this.latencyHistory = [];
        this.qualityHistory = [];
        logger.info('Translation stats reset');
    }

    /**
     * レイテンシが目標を満たしているかチェック
     *
     * @returns レイテンシが目標以下か
     */
    public isLatencyOptimal(): boolean {
        return this.stats.averageLatency <= this.config.latencyTarget;
    }

    /**
     * 品質が閾値を満たしているかチェック
     *
     * @returns 品質が閾値以上か
     */
    public isQualityAcceptable(): boolean {
        return this.stats.averageQuality >= this.config.qualityThreshold;
    }
}

/**
 * 翻訳指示生成器
 *
 * @description
 * 言語ペアと文脈に基づいて最適化された翻訳指示を生成
 */
export class TranslationInstructionGenerator {
    /**
     * 翻訳指示を生成
     *
     * @param sourceLang - ソース言語コード
     * @param targetLang - ターゲット言語コード
     * @param context - 文脈情報
     * @returns 最適化された翻訳指示
     */
    public static generate(
        sourceLang: string,
        targetLang: string,
        context?: {
            domain?: 'business' | 'technical' | 'casual' | 'academic';
            formality?: 'formal' | 'informal';
            preserveEmotions?: boolean;
        }
    ): string {
        const sourceLanguageName = this.getLanguageName(sourceLang);
        const targetLanguageName = this.getLanguageName(targetLang);
        const domain = context?.domain ?? 'business';
        const formality = context?.formality ?? 'formal';
        const preserveEmotions = context?.preserveEmotions ?? true;

        const instructions = [
            `あなたは高精度なリアルタイム通訳者です。`,
            `${sourceLanguageName}で話された内容を、即座に${targetLanguageName}に翻訳して話してください。`,
            '',
            '重要な指示：',
            '1. 翻訳のみを行い、余計な説明や注釈は一切加えない',
            '2. 原文の意味とニュアンスを正確に保持する',
            '3. 文化的文脈を考慮した自然な翻訳を行う'
        ];

        if (preserveEmotions) {
            instructions.push('4. 話者の感情やトーンを可能な限り再現する');
        }

        if (domain === 'technical') {
            instructions.push('5. 専門用語は正確に翻訳し、必要に応じて原語を併記する');
        } else if (domain === 'business') {
            instructions.push('5. ビジネス用語は適切に翻訳し、敬語を使用する');
        } else if (domain === 'academic') {
            instructions.push('5. 学術用語は正確に翻訳し、専門性を保持する');
        } else {
            instructions.push('5. 自然で流暢な日常会話として翻訳する');
        }

        if (formality === 'formal') {
            instructions.push('6. 丁寧で礼儀正しい表現を使用する');
        } else {
            instructions.push('6. 親しみやすく自然な表現を使用する');
        }

        instructions.push(
            '7. 固有名詞は適切に処理する',
            `8. 必ず${targetLanguageName}のみで応答する`,
            '9. 翻訳できない場合は、原文をそのまま繰り返す',
            '10. 短い発話でも完全な文として翻訳する'
        );

        return instructions.join('\n');
    }

    /**
     * 言語コードから言語名を取得
     *
     * @private
     * @param langCode - 言語コード
     * @returns 言語名
     */
    private static getLanguageName(langCode: string): string {
        const languageMap: Record<string, string> = {
            en: '英語',
            ja: '日本語',
            zh: '简体中文',
            ko: '韓国語',
            es: 'スペイン語',
            fr: 'フランス語',
            de: 'ドイツ語',
            it: 'イタリア語',
            pt: 'ポルトガル語',
            ru: 'ロシア語',
            ar: 'アラビア語',
            hi: 'ヒンディー語'
        };

        return languageMap[langCode] || langCode;
    }
}
