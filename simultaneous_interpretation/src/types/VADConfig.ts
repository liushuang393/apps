/**
 * VAD設定の型定義
 *
 * @description
 * 音声活性検出（VAD）に関する設定とプリセットの型定義
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * シナリオプリセット
 */
export type ScenarioPreset = 'meeting' | 'conversation' | 'quickChat';

/**
 * VAD基本設定
 */
export interface VADConfig {
    /** 最小発話時長 (ms) */
    minSpeechDuration: number;

    /** 無声確認遅延 (ms) */
    silenceConfirmDelay: number;

    /** エネルギー閾値 (0.0 ~ 1.0) */
    threshold: number;
}

/**
 * シナリオ別乗数
 */
export interface ScenarioMultiplier {
    /** 最小時長の乗数 */
    minMult: number;

    /** 無声確認の乗数 */
    silenceMult: number;
}

/**
 * 言語別VAD設定マップ
 */
export type LanguageVADConfigMap = Record<string, VADConfig>;

/**
 * シナリオ別プリセットマップ
 */
export type ScenarioPresetMap = Record<ScenarioPreset, ScenarioMultiplier>;

/**
 * 適応的VADの履歴データ
 */
export interface VADHistoryData {
    /** 発話時長履歴 (ms) */
    durations: number[];

    /** 無声時長履歴 (ms) */
    silences: number[];

    /** 最大履歴件数 */
    maxHistory: number;
}

/**
 * VADパラメータ計算結果
 */
export interface VADParameters {
    /** 計算された最小発話時長 (ms) */
    minDuration: number;

    /** 計算された無声確認遅延 (ms) */
    silenceDelay: number;

    /** 使用された言語 */
    language: string;

    /** 使用されたシナリオ */
    scenario: ScenarioPreset;

    /** 適応的調整が適用されたか */
    adaptiveApplied: boolean;
}
