/**
 * 翻訳サービスインターフェース
 *
 * @description
 * 音声翻訳とテキスト翻訳の統一インターフェース
 * 異なる実装（Realtime API、Chat API）を抽象化
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 翻訳モード
 */
export enum TranslationMode {
    /** 音声→音声翻訳 */
    VOICE_TO_VOICE = 'voice_to_voice',
    /** テキスト→テキスト翻訳 */
    TEXT_TO_TEXT = 'text_to_text',
    /** 音声→テキスト翻訳 */
    VOICE_TO_TEXT = 'voice_to_text'
}

/**
 * 翻訳品質レベル
 */
export enum TranslationQuality {
    /** 高速（低品質） */
    FAST = 'fast',
    /** バランス（推奨） */
    BALANCED = 'balanced',
    /** 高品質（低速） */
    HIGH_QUALITY = 'high_quality'
}

/**
 * 言語情報
 */
export interface LanguageInfo {
    /** 言語コード (例: 'en', 'ja', 'zh') */
    code: string;
    /** 英語名 (例: 'English', 'Japanese') */
    name: string;
    /** ネイティブ名 (例: 'English', '日本語') */
    nativeName: string;
}

/**
 * 翻訳設定
 */
export interface TranslationConfig {
    /** ソース言語 */
    sourceLanguage: LanguageInfo;
    /** ターゲット言語 */
    targetLanguage: LanguageInfo;
    /** 翻訳モード */
    mode: TranslationMode;
    /** 品質レベル */
    quality?: TranslationQuality;
    /** 音声タイプ (音声翻訳の場合) */
    voice?: string;
    /** 音声出力を有効化 */
    enableAudioOutput?: boolean;
    /** Server VAD を有効化 */
    enableServerVAD?: boolean;
}

/**
 * 翻訳リクエスト
 */
export interface TranslationRequest {
    /** 入力データ (テキストまたは音声データ) */
    input: string | ArrayBuffer;
    /** 翻訳設定 */
    config: TranslationConfig;
    /** リクエストID (オプション) */
    requestId?: string;
}

/**
 * 翻訳レスポンス
 */
export interface TranslationResponse {
    /** 翻訳結果 (テキストまたは音声データ) */
    output: string | ArrayBuffer;
    /** 入力のトランスクリプト (音声入力の場合) */
    inputTranscript?: string;
    /** 出力のトランスクリプト (音声出力の場合) */
    outputTranscript?: string;
    /** リクエストID */
    requestId?: string;
    /** 処理時間 (ms) */
    processingTime?: number;
    /** 信頼度スコア (0-1) */
    confidence?: number;
}

/**
 * 翻訳エラー
 */
export interface TranslationError {
    /** エラーコード */
    code: string;
    /** エラーメッセージ */
    message: string;
    /** 詳細情報 */
    details?: unknown;
    /** リトライ可能か */
    retryable: boolean;
}

/**
 * 翻訳サービスイベント
 */
export interface TranslationServiceEvents {
    /** 接続確立 */
    onConnected?: () => void;
    /** 接続切断 */
    onDisconnected?: () => void;
    /** 翻訳開始 */
    onTranslationStart?: (request: TranslationRequest) => void;
    /** 翻訳完了 */
    onTranslationComplete?: (response: TranslationResponse) => void;
    /** 翻訳エラー */
    onTranslationError?: (error: TranslationError) => void;
    /** 入力トランスクリプト */
    onInputTranscript?: (transcript: string) => void;
    /** 出力トランスクリプト */
    onOutputTranscript?: (transcript: string) => void;
}

/**
 * 翻訳サービスインターフェース
 */
export interface ITranslationService {
    /**
     * サービスを初期化
     *
     * @param config - 翻訳設定
     * @param events - イベントハンドラ
     */
    initialize(config: TranslationConfig, events?: TranslationServiceEvents): Promise<void>;

    /**
     * 接続を確立
     */
    connect(): Promise<void>;

    /**
     * 接続を切断
     */
    disconnect(): Promise<void>;

    /**
     * 翻訳を実行
     *
     * @param request - 翻訳リクエスト
     * @returns 翻訳レスポンス
     */
    translate(request: TranslationRequest): Promise<TranslationResponse>;

    /**
     * 設定を更新
     *
     * @param config - 新しい翻訳設定
     */
    updateConfig(config: Partial<TranslationConfig>): Promise<void>;

    /**
     * 接続状態を取得
     *
     * @returns 接続中かどうか
     */
    isConnected(): boolean;

    /**
     * サービスを破棄
     */
    dispose(): Promise<void>;
}

/**
 * Realtime API 翻訳サービス
 *
 * @description
 * OpenAI Realtime API を使用した音声→音声翻訳サービス
 */
export interface IRealtimeTranslationService extends ITranslationService {
    /**
     * 音声データをストリーミング送信
     *
     * @param audioData - 音声データ (PCM16)
     */
    streamAudio(audioData: ArrayBuffer): Promise<void>;

    /**
     * 応答の生成をキャンセル
     */
    cancelResponse(): Promise<void>;

    /**
     * 会話をクリア
     */
    clearConversation(): Promise<void>;
}

/**
 * Chat API 翻訳サービス
 *
 * @description
 * OpenAI Chat Completions API を使用したテキスト→テキスト翻訳サービス
 */
export interface IChatTranslationService extends ITranslationService {
    /**
     * 言語を検出
     *
     * @param text - 検出対象のテキスト
     * @returns 検出された言語コード
     */
    detectLanguage(text: string): Promise<string>;

    /**
     * バッチ翻訳を実行
     *
     * @param texts - 翻訳対象のテキスト配列
     * @returns 翻訳結果の配列
     */
    translateBatch(texts: string[]): Promise<string[]>;
}

