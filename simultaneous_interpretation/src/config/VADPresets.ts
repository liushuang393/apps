/**
 * VADプリセット設定
 *
 * @description
 * 言語別とシナリオ別のVADプリセット設定を提供
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import type { VADConfig, LanguageVADConfigMap, ScenarioPresetMap } from '../types/VADConfig';

/**
 * 言語別VAD設定
 *
 * 各言語の発話特性に基づいて最適化されたパラメータ:
 * - 日本語: 間が多い、ゆっくり → 長め設定
 * - 英語: 標準的な速度 → 標準設定
 * - 中国語: やや速い → やや短め設定
 * - ベトナム語: 非常に速い → 短め設定
 */
export const LANGUAGE_VAD_CONFIG: LanguageVADConfigMap = {
    ja: {
        minSpeechDuration: 1200, // 1.2秒
        silenceConfirmDelay: 600, // 600ms
        threshold: 0.004
    },
    en: {
        minSpeechDuration: 1000, // 1.0秒
        silenceConfirmDelay: 500, // 500ms
        threshold: 0.005
    },
    zh: {
        minSpeechDuration: 900, // 0.9秒
        silenceConfirmDelay: 450, // 450ms
        threshold: 0.005
    },
    vi: {
        minSpeechDuration: 800, // 0.8秒
        silenceConfirmDelay: 400, // 400ms
        threshold: 0.006
    }
};

/**
 * シナリオ別プリセット
 *
 * 使用シーンに応じた乗数設定:
 * - 会議: 精度優先（+30%/+20% 長め）
 * - 日常会話: バランス（標準）
 * - 短対話: 速度優先（-30%/-20% 短め）
 */
export const SCENARIO_PRESETS: ScenarioPresetMap = {
    meeting: {
        minMult: 1.3, // +30% 長め
        silenceMult: 1.2 // +20% 長め
    },
    conversation: {
        minMult: 1.0, // 標準
        silenceMult: 1.0 // 標準
    },
    quickChat: {
        minMult: 0.7, // -30% 短め
        silenceMult: 0.8 // -20% 短め
    }
};

/**
 * デフォルトVAD設定
 */
export const DEFAULT_VAD_CONFIG: VADConfig = {
    minSpeechDuration: 1000,
    silenceConfirmDelay: 500,
    threshold: 0.01
};

/**
 * 適応的VAD調整の制約
 */
export const ADAPTIVE_VAD_CONSTRAINTS = {
    /** 最小履歴件数（適応調整を開始する前） */
    MIN_HISTORY_COUNT: 5,

    /** 最大履歴件数 */
    MAX_HISTORY_COUNT: 10,

    /** 基準値に対する最小乗数 */
    MIN_MULTIPLIER: 0.5,

    /** 基準値に対する最大乗数 */
    MAX_MULTIPLIER: 2.0,

    /** 平均発話時長に対する下限乗数 */
    AVG_DURATION_FLOOR: 0.7,

    /** 平均無声時長に対する乗数範囲 */
    AVG_SILENCE_MULTIPLIER: {
        min: 0.5,
        max: 1.5,
        target: 0.8
    }
} as const;

/**
 * 言語コードから設定を取得
 *
 * @param language 言語コード (e.g., 'ja', 'en', 'zh', 'vi')
 * @returns VAD設定（存在しない場合はデフォルト）
 */
export function getLanguageVADConfig(language: string): VADConfig {
    return LANGUAGE_VAD_CONFIG[language] ?? DEFAULT_VAD_CONFIG;
}

/**
 * すべての利用可能な言語コードを取得
 *
 * @returns 言語コードの配列
 */
export function getAvailableLanguages(): string[] {
    return Object.keys(LANGUAGE_VAD_CONFIG);
}

/**
 * 言語設定が存在するかチェック
 *
 * @param language 言語コード
 * @returns 設定が存在するか
 */
export function hasLanguageConfig(language: string): boolean {
    return language in LANGUAGE_VAD_CONFIG;
}
