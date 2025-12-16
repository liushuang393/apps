/**
 * 設定管理インターフェース
 *
 * @description
 * アプリケーション設定の統一管理
 * 環境変数、ローカルストレージ、デフォルト値を統合
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * API 設定
 */
export interface APIConfig {
    /** Realtime API URL */
    realtimeUrl: string;
    /** Realtime API モデル */
    realtimeModel: string;
    /** Chat API モデル */
    chatModel: string;
    /** API キー */
    apiKey: string;
    /** タイムアウト (ms) */
    timeout: number;
}

/**
 * 音声設定
 */
export interface AudioConfig {
    /** サンプリングレート (Hz) */
    sampleRate: number;
    /** チャンクサイズ (samples) */
    chunkSize: number;
    /** バッファサイズ (samples) */
    bufferSize: number;
    /** 音声フォーマット */
    format: string;
    /** チャンネル数 */
    channels: number;
}

/**
 * VAD 設定
 */
export interface VADConfig {
    /** VAD を有効化 */
    enabled: boolean;
    /** VAD タイプ ('client' | 'server') */
    type: 'client' | 'server';
    /** 閾値 (0-1) */
    threshold: number;
    /** デバウンス時間 (ms) */
    debounce: number;
    /** 最小音声長さ (ms) */
    minSpeechMs: number;
    /** Server VAD 設定 */
    server?: {
        /** 閾値 (0-1) */
        threshold: number;
        /** プレフィックスパディング (ms) */
        prefixPaddingMs: number;
        /** 静音判定時間 (ms) */
        silenceDurationMs: number;
    };
}

/**
 * 翻訳設定
 */
export interface TranslationSettings {
    /** ソース言語コード */
    sourceLang: string;
    /** ターゲット言語コード */
    targetLang: string;
    /** 音声タイプ */
    voiceType: string;
    /** 音声出力を有効化 */
    audioOutputEnabled: boolean;
    /** 入力トランスクリプトを表示 */
    showInputTranscript: boolean;
    /** 出力トランスクリプトを表示 */
    showOutputTranscript: boolean;
}

/**
 * 音声処理設定
 */
export interface AudioProcessingSettings {
    /** ノイズリダクションを有効化 */
    noiseReduction: boolean;
    /** エコーキャンセレーションを有効化 */
    echoCancellation: boolean;
    /** 自動ゲインコントロールを有効化 */
    autoGainControl: boolean;
    /** 出力音量 (0-10) */
    outputVolume: number;
}

/**
 * UI 設定
 */
export interface UISettings {
    /** テーマ ('light' | 'dark' | 'auto') */
    theme: 'light' | 'dark' | 'auto';
    /** 言語 */
    language: string;
    /** フォントサイズ */
    fontSize: number;
    /** コンパクトモード */
    compactMode: boolean;
}

/**
 * アプリケーション設定
 */
export interface AppConfig {
    /** デバッグモード */
    debugMode: boolean;
    /** API 設定 */
    api: APIConfig;
    /** 音声設定 */
    audio: AudioConfig;
    /** VAD 設定 */
    vad: VADConfig;
    /** 翻訳設定 */
    translation: TranslationSettings;
    /** 音声処理設定 */
    audioProcessing: AudioProcessingSettings;
    /** UI 設定 */
    ui: UISettings;
}

/**
 * 設定変更イベント
 */
export interface ConfigChangeEvent<T = unknown> {
    /** 変更されたキー */
    key: string;
    /** 古い値 */
    oldValue: T;
    /** 新しい値 */
    newValue: T;
    /** タイムスタンプ */
    timestamp: number;
}

/**
 * 設定管理インターフェース
 */
export interface IConfigManager {
    /**
     * 設定を初期化
     *
     * @param defaultConfig - デフォルト設定
     */
    initialize(defaultConfig: Partial<AppConfig>): Promise<void>;

    /**
     * 設定を取得
     *
     * @param key - 設定キー (ドット記法対応: 'api.realtimeModel')
     * @param defaultValue - デフォルト値
     * @returns 設定値
     */
    get<T = unknown>(key: string, defaultValue?: T): T;

    /**
     * 設定を設定
     *
     * @param key - 設定キー (ドット記法対応: 'api.realtimeModel')
     * @param value - 設定値
     */
    set<T = unknown>(key: string, value: T): Promise<void>;

    /**
     * 複数の設定を一括設定
     *
     * @param config - 設定オブジェクト
     */
    setMultiple(config: Partial<AppConfig>): Promise<void>;

    /**
     * 設定を削除
     *
     * @param key - 設定キー
     */
    delete(key: string): Promise<void>;

    /**
     * すべての設定を取得
     *
     * @returns すべての設定
     */
    getAll(): AppConfig;

    /**
     * 設定をリセット
     *
     * @param key - 設定キー (省略時はすべてリセット)
     */
    reset(key?: string): Promise<void>;

    /**
     * 設定変更を監視
     *
     * @param key - 監視する設定キー
     * @param callback - 変更時のコールバック
     * @returns 監視解除関数
     */
    watch<T = unknown>(key: string, callback: (event: ConfigChangeEvent<T>) => void): () => void;

    /**
     * 設定をエクスポート
     *
     * @returns 設定の JSON 文字列
     */
    export(): string;

    /**
     * 設定をインポート
     *
     * @param json - 設定の JSON 文字列
     */
    import(json: string): Promise<void>;

    /**
     * 設定を検証
     *
     * @param config - 検証する設定
     * @returns 検証結果
     */
    validate(config: Partial<AppConfig>): {
        valid: boolean;
        errors: string[];
    };

    /**
     * 設定マネージャーを破棄
     */
    dispose(): Promise<void>;
}

/**
 * 環境変数プロバイダー
 */
export interface IEnvironmentProvider {
    /**
     * 環境変数を取得
     *
     * @param key - 環境変数キー
     * @param defaultValue - デフォルト値
     * @returns 環境変数の値
     */
    get(key: string, defaultValue?: string): string | undefined;

    /**
     * すべての環境変数を取得
     *
     * @returns 環境変数のマップ
     */
    getAll(): Record<string, string>;
}

/**
 * ストレージプロバイダー
 */
export interface IStorageProvider {
    /**
     * データを取得
     *
     * @param key - キー
     * @returns データ
     */
    get<T = unknown>(key: string): Promise<T | null>;

    /**
     * データを設定
     *
     * @param key - キー
     * @param value - 値
     */
    set<T = unknown>(key: string, value: T): Promise<void>;

    /**
     * データを削除
     *
     * @param key - キー
     */
    delete(key: string): Promise<void>;

    /**
     * すべてのデータを取得
     *
     * @returns すべてのデータ
     */
    getAll(): Promise<Record<string, unknown>>;

    /**
     * すべてのデータをクリア
     */
    clear(): Promise<void>;
}
