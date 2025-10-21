/**
 * 音声処理パイプラインインターフェース
 *
 * @description
 * 音声入力から音声出力までの処理フローを定義
 * 各処理ステップを抽象化し、柔軟な組み合わせを可能にする
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 音声フォーマット
 */
export interface AudioFormat {
    /** サンプリングレート (Hz) */
    sampleRate: number;
    /** チャンネル数 */
    channels: number;
    /** ビット深度 */
    bitDepth: number;
    /** フォーマット名 (例: 'pcm16', 'float32') */
    format: string;
}

/**
 * 音声データ
 */
export interface AudioData {
    /** 音声データ (ArrayBuffer または Float32Array) */
    data: ArrayBuffer | Float32Array;
    /** 音声フォーマット */
    format: AudioFormat;
    /** タイムスタンプ (ms) */
    timestamp: number;
    /** メタデータ */
    metadata?: Record<string, unknown>;
}

/**
 * 音声処理結果
 */
export interface AudioProcessingResult {
    /** 処理済み音声データ */
    audio: AudioData;
    /** 処理が成功したか */
    success: boolean;
    /** エラーメッセージ (失敗時) */
    error?: string;
}

/**
 * VAD (Voice Activity Detection) 結果
 */
export interface VADResult {
    /** 音声が検出されたか */
    isSpeech: boolean;
    /** 信頼度スコア (0-1) */
    confidence: number;
    /** エネルギーレベル */
    energy: number;
    /** タイムスタンプ (ms) */
    timestamp: number;
}

/**
 * 音声処理プロセッサインターフェース
 *
 * @description
 * 音声処理パイプラインの各ステップを表す基本インターフェース
 */
export interface IAudioProcessor {
    /**
     * プロセッサ名
     */
    readonly name: string;

    /**
     * 音声データを処理
     *
     * @param input - 入力音声データ
     * @returns 処理結果
     */
    process(input: AudioData): Promise<AudioProcessingResult>;

    /**
     * プロセッサを初期化
     */
    initialize(): Promise<void>;

    /**
     * プロセッサを破棄
     */
    dispose(): Promise<void>;
}

/**
 * VAD プロセッサインターフェース
 */
export interface IVADProcessor extends IAudioProcessor {
    /**
     * 音声アクティビティを検出
     *
     * @param input - 入力音声データ
     * @returns VAD 結果
     */
    detect(input: AudioData): Promise<VADResult>;

    /**
     * VAD 設定を更新
     *
     * @param config - VAD 設定
     */
    updateConfig(config: {
        threshold?: number;
        debounce?: number;
        minSpeechMs?: number;
    }): void;
}

/**
 * リサンプラープロセッサインターフェース
 */
export interface IResamplerProcessor extends IAudioProcessor {
    /**
     * 音声をリサンプリング
     *
     * @param input - 入力音声データ
     * @param targetSampleRate - ターゲットサンプリングレート
     * @returns リサンプリング結果
     */
    resample(input: AudioData, targetSampleRate: number): Promise<AudioProcessingResult>;
}

/**
 * エンコーダープロセッサインターフェース
 */
export interface IEncoderProcessor extends IAudioProcessor {
    /**
     * 音声をエンコード
     *
     * @param input - 入力音声データ
     * @param targetFormat - ターゲットフォーマット
     * @returns エンコード結果
     */
    encode(input: AudioData, targetFormat: string): Promise<AudioProcessingResult>;
}

/**
 * ノイズリダクションプロセッサインターフェース
 */
export interface INoiseReductionProcessor extends IAudioProcessor {
    /**
     * ノイズを除去
     *
     * @param input - 入力音声データ
     * @returns ノイズ除去結果
     */
    reduceNoise(input: AudioData): Promise<AudioProcessingResult>;

    /**
     * ノイズリダクション設定を更新
     *
     * @param config - ノイズリダクション設定
     */
    updateConfig(config: {
        enabled?: boolean;
        level?: number;
    }): void;
}

/**
 * 音声処理パイプラインインターフェース
 */
export interface IAudioPipeline {
    /**
     * プロセッサを追加
     *
     * @param processor - 追加するプロセッサ
     */
    addProcessor(processor: IAudioProcessor): void;

    /**
     * プロセッサを削除
     *
     * @param processorName - 削除するプロセッサ名
     */
    removeProcessor(processorName: string): void;

    /**
     * 音声データを処理
     *
     * @param input - 入力音声データ
     * @returns 処理結果
     */
    process(input: AudioData): Promise<AudioProcessingResult>;

    /**
     * パイプラインを初期化
     */
    initialize(): Promise<void>;

    /**
     * パイプラインを破棄
     */
    dispose(): Promise<void>;

    /**
     * パイプライン内のプロセッサ一覧を取得
     *
     * @returns プロセッサ名の配列
     */
    getProcessors(): string[];
}

/**
 * 音声キャプチャインターフェース
 */
export interface IAudioCapture {
    /**
     * 音声キャプチャを開始
     *
     * @param onAudioData - 音声データコールバック
     */
    start(onAudioData: (data: AudioData) => void): Promise<void>;

    /**
     * 音声キャプチャを停止
     */
    stop(): Promise<void>;

    /**
     * キャプチャ中かどうか
     *
     * @returns キャプチャ中かどうか
     */
    isCapturing(): boolean;

    /**
     * 音声フォーマットを取得
     *
     * @returns 音声フォーマット
     */
    getFormat(): AudioFormat;
}

/**
 * 音声再生インターフェース
 */
export interface IAudioPlayer {
    /**
     * 音声を再生
     *
     * @param audio - 再生する音声データ
     */
    play(audio: AudioData): Promise<void>;

    /**
     * 再生を停止
     */
    stop(): Promise<void>;

    /**
     * 再生中かどうか
     *
     * @returns 再生中かどうか
     */
    isPlaying(): boolean;

    /**
     * 音量を設定
     *
     * @param volume - 音量 (0-1)
     */
    setVolume(volume: number): void;

    /**
     * 音量を取得
     *
     * @returns 音量 (0-1)
     */
    getVolume(): number;
}

