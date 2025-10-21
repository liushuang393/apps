/**
 * VoiceTranslate Pro - 設定管理
 *
 * 目的: アプリケーション全体の設定を一元管理
 *
 * 機能:
 * - API設定 (OpenAI Realtime API, Chat Completions API)
 * - 音声設定プリセット (BALANCED, AGGRESSIVE, LOW_LATENCY, SERVER_VAD)
 * - VAD設定 (マイクモード、システム音声モード)
 *
 * 注意点:
 * - 環境変数から設定を上書き可能
 * - 本番環境では DEBUG_MODE を false に設定
 */
/**
 * 音声プリセット設定の型定義
 */
export interface AudioPresetConfig {
    /** バッファサイズ (サンプル数) */
    BUFFER_SIZE: number;
    /** 最小音声長さ (ミリ秒) */
    MIN_SPEECH_MS: number;
    /** VAD去抖動時間 (ミリ秒) */
    VAD_DEBOUNCE: number;
    /** 設定の説明 */
    DESCRIPTION: string;
}
/**
 * VAD感度設定の型定義
 */
export interface VADSensitivityConfig {
    /** 音声検出閾値 (0.0-1.0) */
    threshold: number;
    /** デバウンス時間 (ミリ秒) */
    debounce: number;
}
/**
 * VAD設定の型定義
 */
export interface VADConfig {
    /** マイクモード用設定 */
    MICROPHONE: {
        LOW: VADSensitivityConfig;
        MEDIUM: VADSensitivityConfig;
        HIGH: VADSensitivityConfig;
    };
    /** システム音声モード用設定 */
    SYSTEM: {
        LOW: VADSensitivityConfig;
        MEDIUM: VADSensitivityConfig;
        HIGH: VADSensitivityConfig;
    };
}
/**
 * API設定の型定義
 */
export interface APIConfig {
    /** Realtime API WebSocket URL */
    REALTIME_URL: string;
    /** Realtime API用モデル (音声→音声翻訳) */
    REALTIME_MODEL: string;
    /** Chat Completions API用モデル (テキスト翻訳) */
    CHAT_MODEL: string;
    /** APIタイムアウト (ミリ秒) */
    TIMEOUT: number;
}
/**
 * 音声設定の型定義
 */
export interface AudioConfig {
    /** サンプルレート (Hz) */
    SAMPLE_RATE: number;
    /** チャンクサイズ (サンプル数) */
    CHUNK_SIZE: number;
    /** 音声フォーマット */
    FORMAT: string;
}
/**
 * 音声プリセット名の型定義
 */
export type AudioPresetName = 'BALANCED' | 'AGGRESSIVE' | 'LOW_LATENCY' | 'SERVER_VAD';
/**
 * アプリケーション設定の型定義
 */
export interface AppConfig {
    /** デバッグモード */
    DEBUG_MODE: boolean;
    /** API設定 */
    API: APIConfig;
    /** 現在の音声プリセット名 */
    AUDIO_PRESET: AudioPresetName;
    /** 音声プリセット設定 */
    AUDIO_PRESETS: Record<AudioPresetName, AudioPresetConfig>;
    /** 音声設定 */
    AUDIO: AudioConfig;
    /** VAD設定 */
    VAD: VADConfig;
}
/**
 * デフォルト設定（環境変数から上書き可能）
 */
export declare const CONFIG: AppConfig;
/**
 * 現在のプリセット設定を取得
 *
 * @returns 現在選択されている音声プリセット設定
 */
export declare function getAudioPreset(): AudioPresetConfig;
/**
 * 音声プリセットを変更
 *
 * @param presetName - 変更先のプリセット名
 * @returns 変更後のプリセット設定
 */
export declare function setAudioPreset(presetName: AudioPresetName): AudioPresetConfig;
/**
 * デバッグモードを設定
 *
 * @param enabled - デバッグモードを有効にするか
 */
export declare function setDebugMode(enabled: boolean): void;
//# sourceMappingURL=Config.d.ts.map