/**
 * 会話コンテキスト管理
 *
 * @description
 * 直近の会話履歴を保持し、翻訳の一貫性を保つ
 * OpenAI Realtime API の instructions に注入する
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import type {
    ConversationEntry,
    ContextInfo,
    ContextGenerationOptions
} from '../types/Conversation';

export class ConversationContext {
    private history: ConversationEntry[] = [];
    private readonly maxHistory: number;
    private readonly maxAgeMs: number;

    /**
     * コンストラクタ
     *
     * @param maxHistory 最大履歴件数（デフォルト: 5）
     * @param maxAgeMs 最大コンテキスト年齢（デフォルト: 5分）
     */
    constructor(maxHistory: number = 5, maxAgeMs: number = 300000) {
        this.maxHistory = maxHistory;
        this.maxAgeMs = maxAgeMs;
    }

    /**
     * エントリ追加
     *
     * @param sourceText 原文
     * @param translatedText 訳文
     * @param language 言語コード
     * @param confidence オプション: 信頼度
     */
    addEntry(
        sourceText: string,
        translatedText: string,
        language: string,
        confidence?: number
    ): void {
        const entry: ConversationEntry = {
            timestamp: Date.now(),
            sourceText,
            translatedText,
            language,
            ...(confidence !== undefined ? { confidence } : {})
        };

        this.history.push(entry);

        // 古いエントリを削除
        this.pruneOldEntries();

        // 最大件数を超えた場合
        while (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    /**
     * コンテキスト取得
     *
     * @param options オプション
     * @returns コンテキスト情報
     */
    getContext(options?: ContextGenerationOptions): ContextInfo {
        const {
            maxHistory = this.maxHistory,
            maxAgeMs = this.maxAgeMs,
            includeTerminology = true,
            summarize = false
        } = options ?? {};

        // 有効な履歴を取得
        const validHistory = this.getValidHistory(maxAgeMs);
        const recent = validHistory.slice(-maxHistory);

        if (recent.length === 0) {
            return {
                contextString: '',
                terminology: new Map(),
                historyCount: 0,
                oldestTimestamp: null
            };
        }

        // コンテキスト文字列生成
        const contextLines = recent.map((entry, index) => {
            if (summarize) {
                return `[${index + 1}] ${entry.sourceText.substring(0, 50)}... → ${entry.translatedText.substring(0, 50)}...`;
            }
            return `[${index + 1}] ${entry.sourceText} → ${entry.translatedText}`;
        });

        const contextString = contextLines.join('\n');

        // 術語抽出
        const terminology = includeTerminology ? this.extractTerminology(recent) : new Map();

        return {
            contextString,
            terminology,
            historyCount: recent.length,
            oldestTimestamp: recent[0]?.timestamp ?? null
        };
    }

    /**
     * 術語抽出
     *
     * @param entries エントリ配列
     * @returns 術語マップ（原語 → 訳語）
     */
    extractTerminology(entries: ConversationEntry[]): Map<string, string> {
        const terms = new Map<string, string>();

        entries.forEach((entry) => {
            // 大文字で始まる単語を固有名詞と判定（簡易実装）
            const sourceTerms = entry.sourceText.match(/\b[A-Z][a-z]+\b/g) || [];
            const targetTerms = entry.translatedText.match(/\b[A-Z][a-z]+\b/g) || [];

            // 簡易対応付け（出現順）
            sourceTerms.forEach((term, i) => {
                if (targetTerms[i]) {
                    terms.set(term, targetTerms[i]);
                }
            });
        });

        return terms;
    }

    /**
     * 履歴をリセット
     */
    reset(): void {
        this.history = [];
    }

    /**
     * 履歴件数を取得
     *
     * @returns 履歴件数
     */
    getHistoryCount(): number {
        return this.history.length;
    }

    /**
     * すべての履歴を取得
     *
     * @returns 履歴のコピー
     */
    getAllHistory(): ConversationEntry[] {
        return [...this.history];
    }

    /**
     * 古いエントリを削除
     */
    private pruneOldEntries(): void {
        const now = Date.now();
        this.history = this.history.filter((entry) => now - entry.timestamp < this.maxAgeMs);
    }

    /**
     * 有効な履歴を取得
     *
     * @param maxAgeMs 最大年齢
     * @returns 有効な履歴
     */
    private getValidHistory(maxAgeMs: number): ConversationEntry[] {
        const now = Date.now();
        return this.history.filter((entry) => now - entry.timestamp < maxAgeMs);
    }
}
