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
 * デフォルト設定（環境変数から上書き可能）
 */
export const CONFIG = {
    // デバッグモード（本番環境では false に設定）
    DEBUG_MODE: false,
    API: {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime',
        // 2種類のモデル設定（環境変数から上書き可能）
        //
        // 1. REALTIME_MODEL: Realtime API用（音声→音声翻訳、音声認識）
        //    - 用途: WebSocket接続、Session作成、音声→音声翻訳
        //    - 自動機能: 音声認識（whisper-1）、言語自動検出
        //    - 推奨: gpt-realtime-2025-08-28 (最新・最高品質)
        //    - 例: gpt-realtime-2025-08-28, gpt-4o-realtime-preview-2024-12-17
        REALTIME_MODEL: 'gpt-realtime-2025-08-28',
        // 2. CHAT_MODEL: Chat Completions API用（言語検出、テキスト翻訳）
        //    - 用途: 言語検出、テキスト→テキスト翻訳
        //    - API: /v1/chat/completions
        //    - 例: gpt-4o, gpt-4o-mini, gpt-4, gpt-3.5-turbo
        //    - ⚠️ Realtime APIモデルは使用不可
        CHAT_MODEL: 'gpt-5-2025-08-07',
        TIMEOUT: 30000
    },
    // 音声設定プリセット（4つの方案から選択）
    // 使用方法: CONFIG.AUDIO_PRESET を変更して再読み込み
    AUDIO_PRESET: 'BALANCED', // 'BALANCED' | 'AGGRESSIVE' | 'LOW_LATENCY' | 'SERVER_VAD'
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
        // 方案D: Server VAD型
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
export function getAudioPreset() {
    return CONFIG.AUDIO_PRESETS[CONFIG.AUDIO_PRESET] || CONFIG.AUDIO_PRESETS.BALANCED;
}
/**
 * 音声プリセットを変更
 *
 * @param presetName - 変更先のプリセット名
 * @returns 変更後のプリセット設定
 */
export function setAudioPreset(presetName) {
    if (!CONFIG.AUDIO_PRESETS[presetName]) {
        console.warn(`[Config] 無効なプリセット名: ${presetName}. BALANCED を使用します。`);
        CONFIG.AUDIO_PRESET = 'BALANCED';
    } else {
        CONFIG.AUDIO_PRESET = presetName;
    }
    return getAudioPreset();
}
/**
 * デバッグモードを設定
 *
 * @param enabled - デバッグモードを有効にするか
 */
export function setDebugMode(enabled) {
    CONFIG.DEBUG_MODE = enabled;
    console.log(`[Config] デバッグモード: ${enabled ? '有効' : '無効'}`);
}
//# sourceMappingURL=Config.js.map
