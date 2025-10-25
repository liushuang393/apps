/**
 * VoiceTranslate Pro - Core Type Definitions
 *
 * 目的: コアモジュールで使用する共通の型定義
 */

/**
 * アプリケーション状態
 */
export interface AppState {
    /** APIキー */
    apiKey: string;
    /** 接続状態 */
    isConnected: boolean;
    /** 録音状態 */
    isRecording: boolean;
    /** ソース言語 (✅ 自動検出により null から始まる) */
    sourceLang: string | null;
    /** ターゲット言語 */
    targetLang: string;
    /** 音声タイプ */
    voiceType: string;
    /** セッション開始時刻 */
    sessionStartTime: number | null;
    /** 文字数カウント */
    charCount: number;
    /** WebSocket接続 */
    ws: WebSocket | null;
    /** 音声ソースタイプ */
    audioSourceType: 'microphone' | 'system';
    /** システム音声ソースID */
    systemAudioSourceId: string | null;
    /** 出力音量 */
    outputVolume: number;
    /** 音声再生中フラグ */
    isPlayingAudio: boolean;
    /** 入力音声出力フラグ */
    inputAudioOutputEnabled: boolean;
}

/**
 * 言語情報
 */
export interface LanguageInfo {
    /** 言語コード */
    code: string;
    /** 英語名 */
    name: string;
    /** ネイティブ名 */
    nativeName: string;
}

/**
 * 音声タイプ
 */
export type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

/**
 * 通知タイプ
 */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * 通知オプション
 */
export interface NotificationOptions {
    /** タイトル */
    title: string;
    /** メッセージ */
    message: string;
    /** タイプ */
    type: NotificationType;
    /** 表示時間 (ミリ秒) */
    duration?: number;
}

/**
 * トランスクリプトエントリ
 */
export interface TranscriptEntry {
    /** タイムスタンプ */
    timestamp: number;
    /** テキスト */
    text: string;
    /** 言語 */
    language: string;
    /** タイプ */
    type: 'input' | 'output';
}

/**
 * セッション統計
 */
export interface SessionStats {
    /** セッション時間 (秒) */
    sessionTime: number;
    /** 文字数 */
    charCount: number;
    /** レイテンシ (ミリ秒) */
    latency: number;
    /** 精度 (0-100) */
    accuracy: number;
}

/**
 * WebSocketメッセージ
 */
export interface WebSocketMessage {
    /** メッセージタイプ */
    type: string;
    /** メッセージデータ */
    [key: string]: unknown;
}

/**
 * レスポンス作成リクエスト
 */
export interface ResponseCreateRequest {
    /** モダリティ */
    modalities?: string[];
    /** 指示 */
    instructions?: string;
    /** 音声 */
    voice?: VoiceType;
    /** 出力音声フォーマット */
    output_audio_format?: string;
    /** ツール */
    tools?: unknown[];
    /** ツール選択 */
    tool_choice?: string;
    /** 温度 */
    temperature?: number;
    /** 最大出力トークン */
    max_output_tokens?: number | 'inf';
}

/**
 * セッション更新リクエスト
 */
export interface SessionUpdateRequest {
    /** セッション設定 */
    session?: {
        /** モダリティ */
        modalities?: string[];
        /** 指示 */
        instructions?: string;
        /** 音声 */
        voice?: VoiceType;
        /** 入力音声フォーマット */
        input_audio_format?: string;
        /** 出力音声フォーマット */
        output_audio_format?: string;
        /** 入力音声転写 */
        input_audio_transcription?: {
            model?: string;
        };
        /** ターンディテクション */
        turn_detection?: {
            type?: string;
            threshold?: number;
            prefix_padding_ms?: number;
            silence_duration_ms?: number;
        } | null;
        /** ツール */
        tools?: unknown[];
        /** ツール選択 */
        tool_choice?: string;
        /** 温度 */
        temperature?: number;
        /** 最大出力トークン */
        max_response_output_tokens?: number | 'inf';
    };
}

/**
 * 音声データ
 */
export interface AudioData {
    /** サンプルデータ */
    samples: Float32Array;
    /** サンプルレート */
    sampleRate: number;
    /** チャンネル数 */
    channels: number;
}

/**
 * ストレージキー
 */
export type StorageKey =
    | 'openai_api_key'
    | 'source_lang'
    | 'target_lang'
    | 'voice_type'
    | 'audio_source_type'
    | 'vadEnabled'
    | 'noiseReduction'
    | 'echoCancellation'
    | 'autoGainControl'
    | 'showInputTranscript'
    | 'showOutputTranscript'
    | 'audioOutputEnabled'
    | 'inputAudioOutputEnabled';

/**
 * ストレージアダプター
 */
export interface IStorageAdapter {
    /**
     * 値を保存
     * @param key - キー
     * @param value - 値
     */
    save(key: StorageKey, value: unknown): Promise<void>;

    /**
     * 値を読み込み
     * @param key - キー
     * @returns 値
     */
    load(key: StorageKey): Promise<unknown>;

    /**
     * 値を削除
     * @param key - キー
     */
    remove(key: StorageKey): Promise<void>;

    /**
     * すべてクリア
     */
    clear(): Promise<void>;
}

/**
 * プラットフォームアダプター
 */
export interface IPlatformAdapter {
    /**
     * ストレージアダプター
     */
    storage: IStorageAdapter;

    /**
     * DOM要素を取得
     * @param id - 要素ID
     * @returns DOM要素
     */
    getElementById(id: string): HTMLElement | null;

    /**
     * 通知を表示
     * @param options - 通知オプション
     */
    notify(options: NotificationOptions): void;

    /**
     * マイク権限をチェック
     * @returns 権限があるかどうか
     */
    checkMicrophonePermission(): Promise<boolean>;

    /**
     * 音声ソースを検出
     * @returns 音声ソースのリスト
     */
    detectAudioSources(): Promise<unknown[]>;
}
