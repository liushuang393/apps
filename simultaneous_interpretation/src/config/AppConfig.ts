/**
 * アプリケーション設定
 *
 * @description
 * グローバル設定の定義と管理
 *
 * ⚠️ モデル設定の優先順位: 環境変数 > .env ファイル > エラー
 * ⚠️ 環境変数が設定されていない場合は例外が投げられます
 *
 * 必須環境変数:
 * - OPENAI_REALTIME_MODEL: Realtime API用モデル
 * - OPENAI_CHAT_MODEL: Chat Completions API用モデル
 *
 * オプション環境変数:
 * - OPENAI_REALTIME_URL: Realtime API URL（デフォルト: wss://api.openai.com/v1/realtime）
 * - DEBUG_MODE: デバッグモード（デフォルト: false）
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 音声プリセット名
 */
export type AudioPresetName = 'BALANCED' | 'AGGRESSIVE' | 'LOW_LATENCY' | 'SERVER_VAD';

/**
 * 音声プリセット設定
 */
export interface AudioPresetConfig {
    /** バッファサイズ (samples) */
    BUFFER_SIZE: number;
    /** 最小音声長さ (ms) */
    MIN_SPEECH_MS: number;
    /** VAD デバウンス時間 (ms) */
    VAD_DEBOUNCE: number;
    /** 説明 */
    DESCRIPTION: string;
}

/**
 * VAD 感度設定
 */
export interface VADSensitivityConfig {
    /** 閾値 */
    threshold: number;
    /** デバウンス時間 (ms) */
    debounce: number;
}

/**
 * VAD モード設定
 */
export interface VADModeConfig {
    LOW: VADSensitivityConfig;
    MEDIUM: VADSensitivityConfig;
    HIGH: VADSensitivityConfig;
}

/**
 * アプリケーション設定
 */
export class AppConfig {
    /** デバッグモード */
    static DEBUG_MODE = false;

    /**
     * API 設定
     *
     * ⚠️ 注意: REALTIME_MODEL と CHAT_MODEL は参考値です
     * 実際の値は環境変数から読み込まれます（loadFromEnv() で上書き）
     */
    static API = {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime',
        REALTIME_MODEL: 'gpt-realtime-2025-08-28',  // 参考値（環境変数で上書き必須）
        CHAT_MODEL: 'gpt-4o',  // 参考値（環境変数で上書き必須）
        TIMEOUT: 30000
    };

    /** 音声プリセット名 */
    static AUDIO_PRESET: AudioPresetName = 'BALANCED';

    /** 音声プリセット設定 */
    static AUDIO_PRESETS: Record<AudioPresetName, AudioPresetConfig> = {
        BALANCED: {
            BUFFER_SIZE: 6000,
            MIN_SPEECH_MS: 500,
            VAD_DEBOUNCE: 400,
            DESCRIPTION: '精度と遅延のバランス - 推奨設定'
        },
        AGGRESSIVE: {
            BUFFER_SIZE: 8000,
            MIN_SPEECH_MS: 800,
            VAD_DEBOUNCE: 500,
            DESCRIPTION: '最高精度、ネットワーク負荷最小 - 遅延やや大'
        },
        LOW_LATENCY: {
            BUFFER_SIZE: 4800,
            MIN_SPEECH_MS: 400,
            VAD_DEBOUNCE: 250,
            DESCRIPTION: '最低遅延 - VAD精度やや低'
        },
        SERVER_VAD: {
            BUFFER_SIZE: 4800,
            MIN_SPEECH_MS: 0,
            VAD_DEBOUNCE: 0,
            DESCRIPTION: 'OpenAI Server VAD使用 - 最高精度、ネットワーク負荷大'
        }
    };

    /** 音声設定 */
    static AUDIO = {
        SAMPLE_RATE: 24000,
        CHUNK_SIZE: 4800,
        FORMAT: 'pcm16' as const
    };

    /** VAD 設定 */
    static VAD = {
        MICROPHONE: {
            LOW: { threshold: 0.008, debounce: 400 },
            MEDIUM: { threshold: 0.004, debounce: 250 },
            HIGH: { threshold: 0.002, debounce: 150 }
        } as VADModeConfig,
        SYSTEM: {
            LOW: { threshold: 0.015, debounce: 500 },
            MEDIUM: { threshold: 0.010, debounce: 350 },
            HIGH: { threshold: 0.006, debounce: 250 }
        } as VADModeConfig
    };

    /**
     * 現在のプリセット設定を取得
     */
    static getAudioPreset(): AudioPresetConfig {
        return this.AUDIO_PRESETS[this.AUDIO_PRESET] || this.AUDIO_PRESETS.BALANCED;
    }

    /**
     * 環境変数から設定を読み込み
     *
     * @throws {Error} 必須の環境変数が設定されていない場合
     *
     * @description
     * 優先順位: 環境変数 > .env ファイル > エラー
     * デフォルト値は使用せず、環境変数が設定されていない場合は例外を投げる
     */
    static loadFromEnv(): void {
        if (typeof process !== 'undefined' && process.env) {
            const errors: string[] = [];

            // Realtime モデル（必須）
            if (process.env.OPENAI_REALTIME_MODEL) {
                this.API.REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL;
            } else {
                errors.push('OPENAI_REALTIME_MODEL が設定されていません');
            }

            // Chat モデル（必須）
            if (process.env.OPENAI_CHAT_MODEL) {
                this.API.CHAT_MODEL = process.env.OPENAI_CHAT_MODEL;
            } else {
                errors.push('OPENAI_CHAT_MODEL が設定されていません');
            }

            // Realtime URL（オプション、デフォルト値あり）
            if (process.env.OPENAI_REALTIME_URL) {
                this.API.REALTIME_URL = process.env.OPENAI_REALTIME_URL;
            }

            // デバッグモード（オプション）
            if (process.env.DEBUG_MODE) {
                this.DEBUG_MODE = process.env.DEBUG_MODE === 'true';
            }

            // エラーがある場合は例外を投げる
            if (errors.length > 0) {
                throw new Error(
                    `設定エラー: 必須の環境変数が設定されていません\n` +
                    `${errors.join('\n')}\n\n` +
                    `.env ファイルに以下の設定を追加してください:\n` +
                    `OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28\n` +
                    `OPENAI_CHAT_MODEL=gpt-4o`
                );
            }
        }
    }

    /**
     * 設定を検証
     */
    static validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // API キーチェック（ブラウザ環境では不要）
        if (typeof window === 'undefined') {
            if (!process.env.OPENAI_API_KEY) {
                errors.push('OPENAI_API_KEY is not set');
            }
        }

        // モデル名チェック
        if (!this.API.REALTIME_MODEL) {
            errors.push('REALTIME_MODEL is not set');
        }

        if (!this.API.CHAT_MODEL) {
            errors.push('CHAT_MODEL is not set');
        }

        // サンプリングレートチェック
        if (this.AUDIO.SAMPLE_RATE !== 24000) {
            errors.push('SAMPLE_RATE must be 24000 for Realtime API');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 設定をリセット
     */
    static reset(): void {
        this.DEBUG_MODE = false;
        this.AUDIO_PRESET = 'BALANCED';
        this.API.REALTIME_MODEL = 'gpt-realtime-2025-08-28';
        this.API.CHAT_MODEL = 'gpt-4o';
    }
}

// 環境変数から設定を読み込み
AppConfig.loadFromEnv();

