/**
 * WebSocket 型定義
 *
 * @description
 * WebSocket 関連の型定義とインターフェース
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * WebSocket 接続状態
 */
export enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    RECONNECTING = 'reconnecting',
    ERROR = 'error'
}

/**
 * WebSocket 設定
 */
export interface WebSocketConfig {
    /** WebSocket エンドポイント URL */
    url: string;

    /** OpenAI API キー */
    apiKey: string;

    /** 使用するモデル名 */
    model: string;

    /** 再接続試行回数（デフォルト: 3） */
    reconnectAttempts?: number;

    /** 再接続遅延（ミリ秒、デフォルト: 1000） */
    reconnectDelay?: number;

    /** 接続タイムアウト（ミリ秒、デフォルト: 10000） */
    connectionTimeout?: number;
}

/**
 * セッション設定
 */
export interface SessionConfig {
    /** モデル名 */
    model: string;

    /** モダリティ（テキスト、音声など） */
    modalities?: string[];

    /** システムプロンプト */
    instructions?: string;

    /** 音声タイプ */
    voice?: string;

    /** 入力音声フォーマット */
    input_audio_format?: string;

    /** 出力音声フォーマット */
    output_audio_format?: string;

    /** 入力音声転写設定 */
    input_audio_transcription?: {
        model: string;
    };

    /** ターン検出設定 */
    turn_detection?: TurnDetectionConfig;

    /** 温度パラメータ */
    temperature?: number;

    /** 最大レスポンストークン数 */
    max_response_output_tokens?: number;
}

/**
 * ターン検出設定
 */
export interface TurnDetectionConfig {
    /** 検出タイプ */
    type: 'server_vad';

    /** 閾値 */
    threshold?: number;

    /** プレフィックスパディング（ミリ秒） */
    prefix_padding_ms?: number;

    /** 無音期間（ミリ秒） */
    silence_duration_ms?: number;
}

/**
 * WebSocket メッセージ型
 */
export enum MessageType {
    SESSION_UPDATE = 'session.update',
    SESSION_CREATED = 'session.created',
    INPUT_AUDIO_BUFFER_APPEND = 'input_audio_buffer.append',
    INPUT_AUDIO_BUFFER_COMMIT = 'input_audio_buffer.commit',
    INPUT_AUDIO_BUFFER_CLEAR = 'input_audio_buffer.clear',
    CONVERSATION_ITEM_CREATE = 'conversation.item.create',
    RESPONSE_CREATE = 'response.create',
    RESPONSE_CANCEL = 'response.cancel',
    ERROR = 'error'
}

/**
 * WebSocket メッセージ基底インターフェース
 */
export interface BaseMessage {
    /** メッセージタイプ */
    type: MessageType | string;

    /** イベント ID */
    event_id?: string;
}

/**
 * セッション更新メッセージ
 */
export interface SessionUpdateMessage extends BaseMessage {
    type: MessageType.SESSION_UPDATE;
    session: SessionConfig;
}

/**
 * セッション作成メッセージ
 */
export interface SessionCreatedMessage extends BaseMessage {
    type: MessageType.SESSION_CREATED;
    session: {
        id: string;
        object: string;
        model: string;
        modalities: string[];
        instructions: string;
        voice: string;
        input_audio_format: string;
        output_audio_format: string;
        input_audio_transcription: {
            model: string;
        };
        turn_detection: TurnDetectionConfig;
        temperature: number;
        max_response_output_tokens: number;
    };
}

/**
 * 音声バッファ追加メッセージ
 */
export interface InputAudioBufferAppendMessage extends BaseMessage {
    type: MessageType.INPUT_AUDIO_BUFFER_APPEND;
    audio: string; // Base64 encoded audio
}

/**
 * エラーメッセージ
 */
export interface ErrorMessage extends BaseMessage {
    type: MessageType.ERROR;
    error: {
        type: string;
        code: string;
        message: string;
        param?: string;
    };
}

/**
 * WebSocket メッセージユニオン型
 */
export type WebSocketMessage =
    | SessionUpdateMessage
    | SessionCreatedMessage
    | InputAudioBufferAppendMessage
    | ErrorMessage
    | BaseMessage;

/**
 * イベントハンドラ型定義
 */
export interface EventHandlers {
    /** 接続開始時のハンドラ */
    onOpen?: ((event: Event) => void) | undefined;

    /** メッセージ受信時のハンドラ */
    onMessage?: ((message: WebSocketMessage) => void) | undefined;

    /** 接続終了時のハンドラ */
    onClose?: ((event: CloseEvent) => void) | undefined;

    /** エラー発生時のハンドラ */
    onError?: ((error: Error) => void) | undefined;

    /** 状態変更時のハンドラ */
    onStateChange?: ((state: ConnectionState) => void) | undefined;
}
