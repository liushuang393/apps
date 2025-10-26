/**
 * 術語辞書管理
 *
 * @description
 * ユーザー辞書とドメイン辞書を管理し、
 * 翻訳の術語一貫性を保つ
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import type {
    TermEntry,
    TerminologyDictionary,
    DomainDictionary,
    InstructionsParams
} from '../types/Conversation';
import { defaultLogger } from '../utils/Logger';

export class TerminologyManager {
    private userDict: TerminologyDictionary = new Map();
    private domainDicts: DomainDictionary = new Map();

    /**
     * ユーザー術語追加
     *
     * @param entry 術語エントリ
     */
    addUserTerm(entry: TermEntry): void {
        entry.lastUsedAt = Date.now();
        this.userDict.set(entry.source, entry);
    }

    /**
     * ユーザー術語削除
     *
     * @param source 原語
     * @returns 削除されたか
     */
    removeUserTerm(source: string): boolean {
        return this.userDict.delete(source);
    }

    /**
     * ユーザー術語取得
     *
     * @param source 原語
     * @returns 術語エントリ（存在しない場合undefined）
     */
    getUserTerm(source: string): TermEntry | undefined {
        return this.userDict.get(source);
    }

    /**
     * すべてのユーザー術語を取得
     *
     * @returns 術語エントリ配列
     */
    getAllUserTerms(): TermEntry[] {
        return Array.from(this.userDict.values());
    }

    /**
     * ドメイン辞書をロード
     *
     * @param domain ドメイン名
     * @param dictionary 辞書データ
     */
    loadDomainDict(domain: string, dictionary: Map<string, string>): void {
        this.domainDicts.set(domain, dictionary);
    }

    /**
     * Instructions 生成
     *
     * @param params パラメータ
     * @returns フォーマット済み instructions
     */
    generateInstructions(params: InstructionsParams): string {
        const { sourceLang, targetLang, domain, customInstructions, style = 'formal' } = params;

        let instructions = `あなたは${sourceLang}から${targetLang}への同時通訳者です。`;

        // スタイル指定
        if (style === 'formal') {
            instructions += '丁寧で正式な表現を使用してください。';
        } else if (style === 'casual') {
            instructions += '自然でカジュアルな表現を使用してください。';
        } else if (style === 'technical') {
            instructions += '技術的で正確な表現を使用してください。';
        }

        // ユーザー辞書
        if (this.userDict.size > 0) {
            instructions += '\n\n【必須術語】以下の用語は必ずこの訳語を使用してください:\n';

            const sortedTerms = Array.from(this.userDict.values()).sort(
                (a, b) => b.priority - a.priority
            );

            sortedTerms.forEach((entry) => {
                instructions += `- "${entry.source}" は必ず "${entry.target}" と訳してください\n`;
            });
        }

        // ドメイン辞書
        if (domain && this.domainDicts.has(domain)) {
            const dict = this.domainDicts.get(domain)!;
            instructions += '\n\n【参考術語】以下の用語を参考にしてください:\n';

            const entries = Array.from(dict.entries()).slice(0, 20);
            entries.forEach(([src, tgt]) => {
                instructions += `- ${src} → ${tgt}\n`;
            });
        }

        // カスタム指示
        if (customInstructions) {
            instructions += '\n\n【追加指示】\n' + customInstructions;
        }

        return instructions;
    }

    /**
     * LocalStorageに保存
     *
     * @param key ストレージキー
     */
    saveToLocalStorage(key: string = 'voicetranslate_user_dict'): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        const data = Array.from(this.userDict.entries());
        localStorage.setItem(key, JSON.stringify(data));
    }

    /**
     * LocalStorageから読み込み
     *
     * @param key ストレージキー
     * @returns 読み込まれた術語数
     */
    loadFromLocalStorage(key: string = 'voicetranslate_user_dict'): number {
        if (typeof localStorage === 'undefined') {
            return 0;
        }

        const saved = localStorage.getItem(key);
        if (!saved) {
            return 0;
        }

        try {
            const data = JSON.parse(saved) as Array<[string, TermEntry]>;
            this.userDict = new Map(data);
            return this.userDict.size;
        } catch (error) {
            defaultLogger.error('[TerminologyManager] 読み込みエラー:', error);
            return 0;
        }
    }

    /**
     * ユーザー辞書をクリア
     */
    clearUserDict(): void {
        this.userDict.clear();
    }

    /**
     * ドメイン辞書をクリア
     *
     * @param domain オプション: 特定のドメインのみクリア
     */
    clearDomainDict(domain?: string): void {
        if (domain) {
            this.domainDicts.delete(domain);
        } else {
            this.domainDicts.clear();
        }
    }
}
