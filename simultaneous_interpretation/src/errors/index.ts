/**
 * カスタムエラークラス
 *
 * @description
 * アプリケーション全体で使用するカスタムエラークラスの定義
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * エラー詳細情報の型定義
 */
export interface ErrorDetails {
    [key: string]: unknown;
}

/**
 * エラー JSON 表現の型定義
 */
export interface ErrorJSON {
    name: string;
    code: string;
    message: string;
    details: ErrorDetails | null;
    timestamp: string;
    stack?: string | undefined;
}

/**
 * 基底カスタムエラークラス
 */
abstract class BaseCustomError extends Error {
    public readonly code: string;
    public readonly details: ErrorDetails | null;
    public readonly timestamp: string;

    constructor(message: string, code: string, details: ErrorDetails | null = null) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * エラーを JSON 形式に変換
     */
    public toJSON(): ErrorJSON {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

/**
 * 認証エラー
 *
 * @description
 * API キーの検証失敗や認証関連のエラー
 */
export class AuthenticationError extends BaseCustomError {
    constructor(message: string, details: ErrorDetails | null = null) {
        super(message, 'AUTH_ERROR', details);
    }
}

/**
 * 接続エラー
 *
 * @description
 * WebSocket 接続失敗やネットワークエラー
 */
export class ConnectionError extends BaseCustomError {
    constructor(message: string, details: ErrorDetails | null = null) {
        super(message, 'CONNECTION_ERROR', details);
    }
}

/**
 * 設定エラー
 *
 * @description
 * 設定パラメータの検証失敗や不正な設定値
 */
export class ConfigurationError extends BaseCustomError {
    constructor(message: string, details: ErrorDetails | null = null) {
        super(message, 'CONFIG_ERROR', details);
    }
}

/**
 * API エラー
 *
 * @description
 * API レスポンスエラーやサーバーエラー
 */
export class APIError extends BaseCustomError {
    public readonly statusCode?: number | undefined;

    constructor(
        message: string,
        statusCode?: number | undefined,
        details: ErrorDetails | null = null
    ) {
        super(message, 'API_ERROR', details);
        this.statusCode = statusCode;
    }

    public override toJSON(): ErrorJSON & { statusCode?: number | undefined } {
        return {
            ...super.toJSON(),
            statusCode: this.statusCode
        };
    }
}

/**
 * タイムアウトエラー
 *
 * @description
 * 処理タイムアウトや接続タイムアウト
 */
export class TimeoutError extends BaseCustomError {
    public readonly timeoutMs: number;

    constructor(message: string, timeoutMs: number, details: ErrorDetails | null = null) {
        super(message, 'TIMEOUT_ERROR', details);
        this.timeoutMs = timeoutMs;
    }

    public override toJSON(): ErrorJSON & { timeoutMs: number } {
        return {
            ...super.toJSON(),
            timeoutMs: this.timeoutMs
        };
    }
}

/**
 * 検証エラー
 *
 * @description
 * 入力値の検証失敗
 */
export class ValidationError extends BaseCustomError {
    public readonly field?: string | undefined;

    constructor(message: string, field?: string | undefined, details: ErrorDetails | null = null) {
        super(message, 'VALIDATION_ERROR', details);
        this.field = field;
    }

    public override toJSON(): ErrorJSON & { field?: string | undefined } {
        return {
            ...super.toJSON(),
            field: this.field
        };
    }
}

/**
 * 暗号化エラー
 *
 * @description
 * 暗号化・復号化処理のエラー
 */
export class EncryptionError extends BaseCustomError {
    constructor(message: string, details: ErrorDetails | null = null) {
        super(message, 'ENCRYPTION_ERROR', details);
    }
}

/**
 * ストレージエラー
 *
 * @description
 * ローカルストレージやセッションストレージのエラー
 */
export class StorageError extends BaseCustomError {
    constructor(message: string, details: ErrorDetails | null = null) {
        super(message, 'STORAGE_ERROR', details);
    }
}
