/**
 * 会話コンテキストの型定義
 *
 * @description
 * 会話履歴管理と術語辞書に関する型定義
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * 会話エントリ
 */
export interface ConversationEntry {
    /** タイムスタンプ (Unix time in ms) */
    timestamp: number;

    /** 原文 */
    sourceText: string;

    /** 訳文 */
    translatedText: string;

    /** 言語コード (e.g., 'ja', 'en', 'zh', 'vi') */
    language: string;

    /** オプション: 信頼度スコア (0.0 ~ 1.0) */
    confidence?: number;
}

/**
 * 術語エントリ
 */
export interface TermEntry {
    /** 原語 */
    source: string;

    /** 訳語 */
    target: string;

    /** ドメイン (e.g., 'IT', 'medical', 'business') */
    domain: string;

    /** 優先度 (1-10, 10が最高) */
    priority: number;

    /** 作成日時 */
    createdAt: number;

    /** 最終使用日時 */
    lastUsedAt?: number;
}

/**
 * 術語辞書マップ
 */
export type TerminologyDictionary = Map<string, TermEntry>;

/**
 * ドメイン別辞書マップ
 */
export type DomainDictionary = Map<string, Map<string, string>>;

/**
 * コンテキスト生成オプション
 */
export interface ContextGenerationOptions {
    /** 最大履歴件数 */
    maxHistory?: number;

    /** 最大コンテキスト年齢 (ms) */
    maxAgeMs?: number;

    /** 術語を含めるか */
    includeTerminology?: boolean;

    /** 要約形式 */
    summarize?: boolean;
}

/**
 * コンテキスト情報
 */
export interface ContextInfo {
    /** フォーマット済みコンテキスト文字列 */
    contextString: string;

    /** 抽出された術語 */
    terminology: Map<string, string>;

    /** 履歴件数 */
    historyCount: number;

    /** 最古のエントリのタイムスタンプ */
    oldestTimestamp: number | null;
}

/**
 * Instructions生成パラメータ
 */
export interface InstructionsParams {
    /** 原言語 */
    sourceLang: string;

    /** 目標言語 */
    targetLang: string;

    /** オプション: ドメイン */
    domain?: string;

    /** オプション: カスタム指示 */
    customInstructions?: string;

    /** オプション: スタイル指定 */
    style?: 'formal' | 'casual' | 'technical';
}
