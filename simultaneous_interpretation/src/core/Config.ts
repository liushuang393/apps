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
 * - ⚠️ モデル設定の優先順位: 環境変数 > .env ファイル > エラー
 * - ⚠️ 環境変数が設定されていない場合は例外が投げられます
 * - ⚠️ 以下のデフォルト値は参考値です。実際の値は環境変数から読み込まれます
 * - Electron環境では、voicetranslate-pro.js で環境変数から上書きされます
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
export type AudioPresetName =
    | 'BALANCED'
    | 'AGGRESSIVE'
    | 'LOW_LATENCY'
    | 'ULTRA_LOW_LATENCY'
    | 'SERVER_VAD';

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
 * デフォルト設定
 *
 * ⚠️ 注意: 以下のデフォルト値は参考値です
 * 実際の値は環境変数から読み込まれます（優先順位: 環境変数 > .env ファイル > エラー）
 * Electron環境では、voicetranslate-pro.js で環境変数から上書きされます
 */
export const CONFIG: AppConfig = {
    // デバッグモード（本番環境では false に設定）
    DEBUG_MODE: false,

    API: {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime',

        // ⚠️ 以下のモデル設定は参考値です。実際の値は環境変数から読み込まれます
        // 環境変数が設定されていない場合は例外が投げられます
        //
        // 2種類のモデル設定（環境変数から必須）
        //
        // 1. REALTIME_MODEL: Realtime API用（音声→音声翻訳、音声認識）
        //    - 環境変数: OPENAI_REALTIME_MODEL（必須）
        //    - 用途: WebSocket接続、Session作成、音声→音声翻訳
        //    - 自動機能: 音声認識（whisper-1）、言語自動検出
        //    - 推奨: gpt-realtime-2025-08-28 (最新・最高品質)
        //    - 例: gpt-realtime-2025-08-28, gpt-4o-realtime-preview-2024-12-17
        REALTIME_MODEL: 'gpt-realtime-2025-08-28', // 参考値

        // 2. CHAT_MODEL: Chat Completions API用（言語検出、テキスト翻訳）
        //    - 環境変数: OPENAI_CHAT_MODEL（必須）
        //    - 用途: 言語検出、テキスト→テキスト翻訳
        //    - API: /v1/chat/completions
        //    - 例: gpt-4o, gpt-4o-mini, gpt-4, gpt-3.5-turbo
        //    - ⚠️ Realtime APIモデルは使用不可
        CHAT_MODEL: 'gpt-5-2025-08-07', // 参考値

        TIMEOUT: 30000
    },

    // 音声設定プリセット（5つの方案から選択）
    // 使用方法: CONFIG.AUDIO_PRESET を変更して再読み込み
    AUDIO_PRESET: 'BALANCED', // 'BALANCED' | 'AGGRESSIVE' | 'LOW_LATENCY' | 'ULTRA_LOW_LATENCY' | 'SERVER_VAD'

    AUDIO_PRESETS: {
        // 方案A: バランス型（推奨）
        BALANCED: {
            BUFFER_SIZE: 6000, // 250ms @ 24kHz
            MIN_SPEECH_MS: 500, // 最小音声長さ
            VAD_DEBOUNCE: 400, // VAD去抖動時間
            DESCRIPTION: '精度と遅延のバランス - 推奨設定'
        },
        // 方案B: 高精度型
        AGGRESSIVE: {
            BUFFER_SIZE: 8000, // 333ms @ 24kHz
            MIN_SPEECH_MS: 800, // 最小音声長さ
            VAD_DEBOUNCE: 500, // VAD去抖動時間
            DESCRIPTION: '最高精度、ネットワーク負荷最小 - 遅延やや大'
        },
        // 方案C: 低遅延型
        LOW_LATENCY: {
            BUFFER_SIZE: 4800, // 200ms @ 24kHz
            MIN_SPEECH_MS: 400, // 最小音声長さ
            VAD_DEBOUNCE: 250, // VAD去抖動時間
            DESCRIPTION: '最低遅延 - VAD精度やや低'
        },
        // 方案D: 超低遅延型（Teams/ブラウザ監視用）
        ULTRA_LOW_LATENCY: {
            BUFFER_SIZE: 2048, // 85ms @ 24kHz
            MIN_SPEECH_MS: 300, // 最小音声長さ
            VAD_DEBOUNCE: 150, // VAD去抖動時間
            DESCRIPTION: '超低遅延 - Teams/ブラウザ監視最適化、フレームドロップ防止'
        },
        // 方案E: Server VAD型
        SERVER_VAD: {
            BUFFER_SIZE: 4800, // 200ms @ 24kHz
            MIN_SPEECH_MS: 0, // Server VADに任せる
            VAD_DEBOUNCE: 0, // Client VAD無効
            DESCRIPTION: 'OpenAI Server VAD使用 - 最高精度、ネットワーク負荷大'
        }
    },

    AUDIO: {
        SAMPLE_RATE: 24000,
        CHUNK_SIZE: 4800,
        FORMAT: 'pcm16'
    },

    VAD: {
        // マイクモード用（静かな環境：個人会議、少人数会議）
        MICROPHONE: {
            LOW: { threshold: 0.008, debounce: 400 },
            MEDIUM: { threshold: 0.004, debounce: 250 },
            HIGH: { threshold: 0.002, debounce: 150 }
        },
        // システム音声モード用（騒がしい環境：ブラウザ音声、会議、音楽）
        // 注意: Teams/Zoom監視時は ULTRA_LOW_LATENCY プリセット + MEDIUM/HIGH 感度推奨
        SYSTEM: {
            LOW: { threshold: 0.015, debounce: 500 },
            MEDIUM: { threshold: 0.01, debounce: 350 },
            HIGH: { threshold: 0.006, debounce: 250 }
        }
    }
};

/**
 * 現在のプリセット設定を取得
 *
 * @returns 現在選択されている音声プリセット設定
 */
export function getAudioPreset(): AudioPresetConfig {
    return CONFIG.AUDIO_PRESETS[CONFIG.AUDIO_PRESET] || CONFIG.AUDIO_PRESETS.BALANCED;
}

/**
 * 音声プリセットを変更
 *
 * @param presetName - 変更先のプリセット名
 * @returns 変更後のプリセット設定
 */
export function setAudioPreset(presetName: AudioPresetName): AudioPresetConfig {
    if (CONFIG.AUDIO_PRESETS[presetName]) {
        CONFIG.AUDIO_PRESET = presetName;
    } else {
        console.warn(`[Config] 無効なプリセット名: ${presetName}. BALANCED を使用します。`);
        CONFIG.AUDIO_PRESET = 'BALANCED';
    }
    return getAudioPreset();
}

/**
 * デバッグモードを設定
 *
 * @param enabled - デバッグモードを有効にするか
 */
export function setDebugMode(enabled: boolean): void {
    CONFIG.DEBUG_MODE = enabled;
    console.info(`[Config] デバッグモード: ${enabled ? '有効' : '無効'}`);
}
