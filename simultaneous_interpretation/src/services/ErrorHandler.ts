/**
 * エラーハンドラーサービス
 *
 * @description
 * 統一されたエラー処理とリカバリー機能を提供
 * ユーザーフレンドリーなエラーメッセージと自動復旧
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * エラーカテゴリー
 */
export enum ErrorCategory {
    /** ネットワークエラー */
    NETWORK = 'NETWORK',
    /** API エラー */
    API = 'API',
    /** 音声処理エラー */
    AUDIO = 'AUDIO',
    /** 設定エラー */
    CONFIG = 'CONFIG',
    /** システムエラー */
    SYSTEM = 'SYSTEM',
    /** ユーザーエラー */
    USER = 'USER'
}

/**
 * エラー重大度
 */
export enum ErrorSeverity {
    /** 情報 - ログのみ */
    INFO = 'INFO',
    /** 警告 - 通知のみ */
    WARNING = 'WARNING',
    /** エラー - ユーザーに通知、自動復旧試行 */
    ERROR = 'ERROR',
    /** 致命的 - ユーザーに通知、手動介入必要 */
    CRITICAL = 'CRITICAL'
}

/**
 * リカバリー戦略
 */
export enum RecoveryStrategy {
    /** 何もしない */
    NONE = 'NONE',
    /** 再試行 */
    RETRY = 'RETRY',
    /** 再接続 */
    RECONNECT = 'RECONNECT',
    /** リセット */
    RESET = 'RESET',
    /** フォールバック */
    FALLBACK = 'FALLBACK',
    /** ユーザー介入 */
    USER_ACTION = 'USER_ACTION'
}

/**
 * アプリケーションエラー
 */
export class AppError extends Error {
    /** エラーコード */
    code: string;
    /** エラーカテゴリー */
    category: ErrorCategory;
    /** エラー重大度 */
    severity: ErrorSeverity;
    /** リカバリー戦略 */
    recoveryStrategy: RecoveryStrategy;
    /** ユーザーメッセージ */
    userMessage: string;
    /** 詳細情報 */
    details?: unknown;
    /** タイムスタンプ */
    timestamp: number;
    /** リトライ可能 */
    retryable: boolean;

    constructor(options: {
        code: string;
        message: string;
        category: ErrorCategory;
        severity: ErrorSeverity;
        recoveryStrategy: RecoveryStrategy;
        userMessage: string;
        details?: unknown;
        retryable?: boolean;
    }) {
        super(options.message);
        this.name = 'AppError';
        this.code = options.code;
        this.category = options.category;
        this.severity = options.severity;
        this.recoveryStrategy = options.recoveryStrategy;
        this.userMessage = options.userMessage;
        this.details = options.details;
        this.timestamp = Date.now();
        this.retryable = options.retryable ?? true;
    }
}

/**
 * エラーハンドラー設定
 */
export interface ErrorHandlerConfig {
    /** エラーログを有効化 */
    enableLogging: boolean;
    /** ユーザー通知を有効化 */
    enableUserNotification: boolean;
    /** 自動リカバリーを有効化 */
    enableAutoRecovery: boolean;
    /** 最大リトライ回数 */
    maxRetries: number;
    /** リトライ遅延 (ms) */
    retryDelay: number;
    /** エラーレポートを有効化 */
    enableErrorReporting: boolean;
}

/**
 * エラーハンドラーサービス
 */
export class ErrorHandler {
    private config: ErrorHandlerConfig;
    private errorHistory: AppError[] = [];
    private readonly maxHistorySize = 100;

    constructor(config?: Partial<ErrorHandlerConfig>) {
        this.config = {
            enableLogging: true,
            enableUserNotification: true,
            enableAutoRecovery: true,
            maxRetries: 3,
            retryDelay: 1000,
            enableErrorReporting: false,
            ...config
        };
    }

    /**
     * エラーを処理
     *
     * @param error - エラーオブジェクト
     * @returns リカバリー成功フラグ
     */
    async handleError(error: Error | AppError): Promise<boolean> {
        // AppError に変換
        const appError = this.normalizeError(error);

        // エラー履歴に追加
        this.addToHistory(appError);

        // ログ出力
        if (this.config.enableLogging) {
            this.logError(appError);
        }

        // ユーザー通知
        if (this.config.enableUserNotification && this.shouldNotifyUser(appError)) {
            this.notifyUser(appError);
        }

        // エラーレポート
        if (this.config.enableErrorReporting) {
            await this.reportError(appError);
        }

        // 自動リカバリー
        if (this.config.enableAutoRecovery && appError.retryable) {
            return await this.attemptRecovery(appError);
        }

        return false;
    }

    /**
     * エラーを正規化
     */
    private normalizeError(error: Error | AppError): AppError {
        if (error instanceof AppError) {
            return error;
        }

        // 一般的なエラーを AppError に変換
        return this.classifyError(error);
    }

    /**
     * エラーを分類
     */
    private classifyError(error: Error): AppError {
        const message = error.message.toLowerCase();

        // ネットワークエラー
        if (message.includes('network') || message.includes('connection') || 
            message.includes('timeout') || message.includes('fetch')) {
            return new AppError({
                code: 'NETWORK_ERROR',
                message: error.message,
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.ERROR,
                recoveryStrategy: RecoveryStrategy.RECONNECT,
                userMessage: 'ネットワーク接続に問題が発生しました。再接続を試みています...',
                details: error,
                retryable: true
            });
        }

        // API エラー
        if (message.includes('api') || message.includes('unauthorized') || 
            message.includes('forbidden') || message.includes('rate limit')) {
            return new AppError({
                code: 'API_ERROR',
                message: error.message,
                category: ErrorCategory.API,
                severity: ErrorSeverity.ERROR,
                recoveryStrategy: RecoveryStrategy.RETRY,
                userMessage: 'API エラーが発生しました。しばらくしてから再試行してください。',
                details: error,
                retryable: true
            });
        }

        // 音声エラー
        if (message.includes('audio') || message.includes('microphone') || 
            message.includes('speaker') || message.includes('media')) {
            return new AppError({
                code: 'AUDIO_ERROR',
                message: error.message,
                category: ErrorCategory.AUDIO,
                severity: ErrorSeverity.ERROR,
                recoveryStrategy: RecoveryStrategy.RESET,
                userMessage: '音声デバイスにアクセスできません。マイクとスピーカーの設定を確認してください。',
                details: error,
                retryable: true
            });
        }

        // 設定エラー
        if (message.includes('config') || message.includes('setting') || 
            message.includes('invalid')) {
            return new AppError({
                code: 'CONFIG_ERROR',
                message: error.message,
                category: ErrorCategory.CONFIG,
                severity: ErrorSeverity.WARNING,
                recoveryStrategy: RecoveryStrategy.FALLBACK,
                userMessage: '設定に問題があります。デフォルト設定を使用します。',
                details: error,
                retryable: false
            });
        }

        // その他のエラー
        return new AppError({
            code: 'UNKNOWN_ERROR',
            message: error.message,
            category: ErrorCategory.SYSTEM,
            severity: ErrorSeverity.ERROR,
            recoveryStrategy: RecoveryStrategy.USER_ACTION,
            userMessage: '予期しないエラーが発生しました。ページを再読み込みしてください。',
            details: error,
            retryable: false
        });
    }

    /**
     * リカバリーを試行
     */
    private async attemptRecovery(error: AppError): Promise<boolean> {
        console.log(`[ErrorHandler] Attempting recovery for ${error.code} using ${error.recoveryStrategy}`);

        switch (error.recoveryStrategy) {
            case RecoveryStrategy.RETRY:
                return await this.retryOperation(error);
            
            case RecoveryStrategy.RECONNECT:
                return await this.reconnect(error);
            
            case RecoveryStrategy.RESET:
                return await this.reset(error);
            
            case RecoveryStrategy.FALLBACK:
                return await this.fallback(error);
            
            case RecoveryStrategy.NONE:
            case RecoveryStrategy.USER_ACTION:
            default:
                return false;
        }
    }

    /**
     * 操作を再試行
     */
    private async retryOperation(error: AppError): Promise<boolean> {
        // 実装は呼び出し元で行う
        console.log(`[ErrorHandler] Retry strategy for ${error.code}`);
        return false;
    }

    /**
     * 再接続
     */
    private async reconnect(error: AppError): Promise<boolean> {
        console.log(`[ErrorHandler] Reconnect strategy for ${error.code}`);
        // WebSocket 再接続は WebSocketAdapter で処理される
        return true;
    }

    /**
     * リセット
     */
    private async reset(error: AppError): Promise<boolean> {
        console.log(`[ErrorHandler] Reset strategy for ${error.code}`);
        // 音声デバイスのリセットなど
        return false;
    }

    /**
     * フォールバック
     */
    private async fallback(error: AppError): Promise<boolean> {
        console.log(`[ErrorHandler] Fallback strategy for ${error.code}`);
        // デフォルト設定の使用など
        return true;
    }

    /**
     * エラーをログ出力
     */
    private logError(error: AppError): void {
        const logMethod = this.getLogMethod(error.severity);
        logMethod(`[${error.category}] ${error.code}: ${error.message}`, error.details);
    }

    /**
     * ログメソッドを取得
     */
    private getLogMethod(severity: ErrorSeverity): (...args: unknown[]) => void {
        switch (severity) {
            case ErrorSeverity.INFO:
                return console.info;
            case ErrorSeverity.WARNING:
                return console.warn;
            case ErrorSeverity.ERROR:
            case ErrorSeverity.CRITICAL:
                return console.error;
            default:
                return console.log;
        }
    }

    /**
     * ユーザーに通知すべきか
     */
    private shouldNotifyUser(error: AppError): boolean {
        return error.severity === ErrorSeverity.ERROR || 
               error.severity === ErrorSeverity.CRITICAL;
    }

    /**
     * ユーザーに通知
     */
    private notifyUser(error: AppError): void {
        // ブラウザ環境での通知
        if (typeof window !== 'undefined') {
            // カスタムイベントを発火
            window.dispatchEvent(new CustomEvent('app-error', {
                detail: {
                    message: error.userMessage,
                    severity: error.severity,
                    code: error.code
                }
            }));
        }
    }

    /**
     * エラーをレポート
     */
    private async reportError(error: AppError): Promise<void> {
        // エラーレポートサービスに送信
        // 実装は環境に応じて
        console.log('[ErrorHandler] Error reported:', error.code);
    }

    /**
     * エラー履歴に追加
     */
    private addToHistory(error: AppError): void {
        this.errorHistory.push(error);
        
        // 履歴サイズを制限
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }
    }

    /**
     * エラー履歴を取得
     */
    getErrorHistory(): AppError[] {
        return [...this.errorHistory];
    }

    /**
     * エラー履歴をクリア
     */
    clearErrorHistory(): void {
        this.errorHistory = [];
    }

    /**
     * 設定を更新
     */
    updateConfig(config: Partial<ErrorHandlerConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

/**
 * グローバルエラーハンドラーインスタンス
 */
export const globalErrorHandler = new ErrorHandler();

