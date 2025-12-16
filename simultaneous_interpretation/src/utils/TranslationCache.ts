/**
 * TranslationCache.ts
 *
 * 目的: 翻訳結果のキャッシュによる重複翻訳の削減とパフォーマンス向上
 *
 * 機能:
 *   - LRU (Least Recently Used) キャッシュ実装
 *   - 言語ペア別キャッシュ管理
 *   - TTL (Time To Live) サポート
 *   - キャッシュヒット率統計
 *
 * 使用方法:
 *   const cache = new TranslationCache({ maxSize: 1000, ttl: 3600000 });
 *   cache.set('ja', 'en', 'こんにちは', 'Hello');
 *   const result = cache.get('ja', 'en', 'こんにちは');
 *
 * 注意:
 *   - メモリ使用量に注意（maxSizeを適切に設定）
 *   - TTL経過後は自動削除
 */

import { defaultLogger } from './Logger';

/**
 * キャッシュエントリ
 */
interface CacheEntry {
    source: string;
    target: string;
    sourceLang: string;
    targetLang: string;
    timestamp: number;
    accessCount: number;
}

/**
 * キャッシュ設定
 */
export interface TranslationCacheConfig {
    maxSize: number; // 最大エントリ数
    ttl: number; // Time To Live (ミリ秒)
    enableStats: boolean; // 統計収集を有効化
}

/**
 * キャッシュ統計
 */
export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    maxSize: number;
    evictions: number;
}

/**
 * TranslationCache クラス
 *
 * 目的: LRUキャッシュによる翻訳結果の管理
 */
export class TranslationCache {
    private cache: Map<string, CacheEntry>;
    private config: TranslationCacheConfig;
    private stats: {
        hits: number;
        misses: number;
        evictions: number;
    };

    constructor(config?: Partial<TranslationCacheConfig>) {
        this.config = {
            maxSize: config?.maxSize ?? 1000,
            ttl: config?.ttl ?? 3600000, // デフォルト1時間
            enableStats: config?.enableStats ?? true
        };

        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };

        defaultLogger.info('[TranslationCache] 初期化完了', this.config);
    }

    /**
     * キャッシュキー生成
     *
     * 目的: 言語ペアとソーステキストから一意のキーを生成
     *
     * @param sourceLang 元言語コード
     * @param targetLang 目標言語コード
     * @param source ソーステキスト
     * @returns キャッシュキー
     */
    private generateKey(sourceLang: string, targetLang: string, source: string): string {
        // 正規化: 前後の空白削除、小文字化
        const normalizedSource = source.trim().toLowerCase();
        return `${sourceLang}:${targetLang}:${normalizedSource}`;
    }

    /**
     * キャッシュに追加
     *
     * 目的: 翻訳結果をキャッシュに保存
     *
     * @param sourceLang 元言語コード
     * @param targetLang 目標言語コード
     * @param source ソーステキスト
     * @param target 翻訳結果
     */
    set(sourceLang: string, targetLang: string, source: string, target: string): void {
        const key = this.generateKey(sourceLang, targetLang, source);

        // 既存エントリがある場合は削除（LRU更新のため）
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // maxSizeを超える場合は最も古いエントリを削除
        if (this.cache.size >= this.config.maxSize) {
            this.evictOldest();
        }

        // 新しいエントリを追加
        const entry: CacheEntry = {
            source,
            target,
            sourceLang,
            targetLang,
            timestamp: Date.now(),
            accessCount: 0
        };

        this.cache.set(key, entry);

        if (this.config.enableStats) {
            defaultLogger.debug('[TranslationCache] エントリ追加', {
                key,
                size: this.cache.size
            });
        }
    }

    /**
     * キャッシュから取得
     *
     * 目的: キャッシュされた翻訳結果を取得
     *
     * @param sourceLang 元言語コード
     * @param targetLang 目標言語コード
     * @param source ソーステキスト
     * @returns 翻訳結果 | null
     */
    get(sourceLang: string, targetLang: string, source: string): string | null {
        const key = this.generateKey(sourceLang, targetLang, source);
        const entry = this.cache.get(key);

        if (!entry) {
            // キャッシュミス
            if (this.config.enableStats) {
                this.stats.misses++;
            }
            return null;
        }

        // TTLチェック
        const age = Date.now() - entry.timestamp;
        if (age > this.config.ttl) {
            // TTL期限切れ
            this.cache.delete(key);
            if (this.config.enableStats) {
                this.stats.misses++;
            }
            return null;
        }

        // キャッシュヒット
        if (this.config.enableStats) {
            this.stats.hits++;
        }

        // アクセスカウント更新
        entry.accessCount++;

        // LRU更新: エントリを削除して再追加（Mapの順序を更新）
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.target;
    }

    /**
     * 最も古いエントリを削除
     *
     * 目的: LRUアルゴリズムに基づいて最も古いエントリを削除
     */
    private evictOldest(): void {
        // Mapの最初のエントリが最も古い（LRU）
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
            this.cache.delete(firstKey);
            if (this.config.enableStats) {
                this.stats.evictions++;
            }
            defaultLogger.debug('[TranslationCache] エントリ削除（LRU）', { key: firstKey });
        }
    }

    /**
     * キャッシュクリア
     *
     * 目的: 全てのキャッシュエントリを削除
     */
    clear(): void {
        this.cache.clear();
        defaultLogger.info('[TranslationCache] キャッシュクリア完了');
    }

    /**
     * 言語ペア別クリア
     *
     * 目的: 特定の言語ペアのキャッシュエントリを削除
     *
     * @param sourceLang 元言語コード
     * @param targetLang 目標言語コード
     */
    clearByLanguagePair(sourceLang: string, targetLang: string): void {
        const prefix = `${sourceLang}:${targetLang}:`;
        let deletedCount = 0;

        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
                deletedCount++;
            }
        }

        defaultLogger.info('[TranslationCache] 言語ペア別クリア完了', {
            sourceLang,
            targetLang,
            deletedCount
        });
    }

    /**
     * 期限切れエントリを削除
     *
     * 目的: TTL期限切れのエントリを一括削除
     */
    pruneExpired(): void {
        const now = Date.now();
        let prunedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            const age = now - entry.timestamp;
            if (age > this.config.ttl) {
                this.cache.delete(key);
                prunedCount++;
            }
        }

        if (prunedCount > 0) {
            defaultLogger.info('[TranslationCache] 期限切れエントリ削除完了', {
                prunedCount
            });
        }
    }

    /**
     * 統計情報取得
     *
     * @returns キャッシュ統計
     */
    getStats(): CacheStats {
        const totalRequests = this.stats.hits + this.stats.misses;
        const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: hitRate * 100, // パーセント
            size: this.cache.size,
            maxSize: this.config.maxSize,
            evictions: this.stats.evictions
        };
    }

    /**
     * 統計情報リセット
     */
    resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
        defaultLogger.info('[TranslationCache] 統計情報リセット完了');
    }

    /**
     * キャッシュサイズ取得
     *
     * @returns 現在のキャッシュサイズ
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * キャッシュが空かどうか
     *
     * @returns boolean
     */
    isEmpty(): boolean {
        return this.cache.size === 0;
    }

    /**
     * キャッシュが満杯かどうか
     *
     * @returns boolean
     */
    isFull(): boolean {
        return this.cache.size >= this.config.maxSize;
    }
}

/**
 * グローバルキャッシュインスタンス
 */
let globalCache: TranslationCache | null = null;

/**
 * グローバルキャッシュ取得
 *
 * @param config キャッシュ設定（初回のみ）
 * @returns TranslationCacheインスタンス
 */
export function getGlobalTranslationCache(
    config?: Partial<TranslationCacheConfig>
): TranslationCache {
    if (!globalCache) {
        globalCache = new TranslationCache(config);
    }
    return globalCache;
}
