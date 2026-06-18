/**
 * ロガークラス
 *
 * @description
 * 環境に応じたログレベル管理を行う専門的なロギングシステム
 *
 * @features
 * - ログレベル管理（DEBUG, INFO, WARN, ERROR）
 * - 環境別設定（開発/本番）
 * - タイムスタンプ付きログ
 * - カラー出力（開発環境）
 * - ログフォーマット統一
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

/**
 * ログレベル定義
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * ログエントリ
 */
export interface LogEntry {
    level: LogLevel;
    message: string;
    args: unknown[];
    timestamp: string;
}

/**
 * Logger オプション
 */
export interface LoggerOptions {
    /** ログレベル */
    level?: LogLevel;

    /** カラー出力を有効化 */
    enableColors?: boolean;

    /** タイムスタンプを有効化 */
    enableTimestamp?: boolean;

    /** ログプレフィックス */
    prefix?: string;
}

/**
 * ログレベル名マッピング
 */
const LogLevelNames: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.NONE]: 'NONE'
};

/**
 * ログレベルカラー（ANSI カラーコード）
 */
const LogLevelColors: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '\x1b[36m', // Cyan
    [LogLevel.INFO]: '\x1b[32m', // Green
    [LogLevel.WARN]: '\x1b[33m', // Yellow
    [LogLevel.ERROR]: '\x1b[31m', // Red
    [LogLevel.NONE]: ''
};

/**
 * カラーリセット
 */
const ColorReset = '\x1b[0m';

/**
 * Logger クラス
 */
export class Logger {
    private level: LogLevel;
    private readonly enableColors: boolean;
    private readonly enableTimestamp: boolean;
    private readonly prefix: string;
    private readonly history: LogEntry[] = [];
    private readonly maxHistorySize: number = 100;

    /**
     * コンストラクタ
     *
     * @param options - Logger オプション
     */
    constructor(options: LoggerOptions = {}) {
        this.level = options.level !== undefined ? options.level : this._getDefaultLogLevel();

        this.enableColors =
            options.enableColors !== undefined ? options.enableColors : this._isColorSupported();

        this.enableTimestamp =
            options.enableTimestamp !== undefined ? options.enableTimestamp : true;

        this.prefix = options.prefix ?? 'VoiceTranslate';
    }

    /**
     * デフォルトログレベルの取得
     *
     * @private
     * @returns ログレベル
     */
    private _getDefaultLogLevel(): LogLevel {
        // 本番環境では INFO 以上のみ
        if (this._isProduction()) {
            return LogLevel.INFO;
        }
        // 開発環境では DEBUG から
        return LogLevel.DEBUG;
    }

    /**
     * 本番環境かどうかを判定
     *
     * @private
     * @returns 本番環境の場合 true
     */
    private _isProduction(): boolean {
        // Node.js 環境
        if (typeof process !== 'undefined' && process.env) {
            return process.env['NODE_ENV'] === 'production';
        }

        // ブラウザ環境（localhost でない場合は本番とみなす）
        if (typeof window !== 'undefined' && window.location) {
            return (
                !window.location.hostname.includes('localhost') &&
                !window.location.hostname.includes('127.0.0.1')
            );
        }

        return false;
    }

    /**
     * カラー出力がサポートされているかを判定
     *
     * @private
     * @returns サポートされている場合 true
     */
    private _isColorSupported(): boolean {
        // ブラウザ環境ではカラーコードは使用しない
        if (typeof window !== 'undefined') {
            return false;
        }

        // Node.js 環境
        if (typeof process !== 'undefined' && process.stdout) {
            return Boolean(process.stdout.isTTY);
        }

        return false;
    }

    /**
     * タイムスタンプの生成
     *
     * @private
     * @returns タイムスタンプ文字列
     */
    private _getTimestamp(): string {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${ms}`;
    }

    /**
     * ログメッセージのフォーマット
     *
     * @private
     * @param level - ログレベル
     * @param message - メッセージ
     * @returns フォーマット済みメッセージ
     */
    private _formatMessage(level: LogLevel, message: string): string {
        const parts: string[] = [];

        // タイムスタンプ
        if (this.enableTimestamp) {
            parts.push(`[${this._getTimestamp()}]`);
        }

        // プレフィックス
        parts.push(`[${this.prefix}]`);

        // ログレベル
        const levelName = LogLevelNames[level];
        if (this.enableColors) {
            const color = LogLevelColors[level];
            parts.push(`${color}[${levelName}]${ColorReset}`);
        } else {
            parts.push(`[${levelName}]`);
        }

        // メッセージ
        parts.push(message);

        return parts.join(' ');
    }

    /**
     * ログの出力
     *
     * @private
     * @param level - ログレベル
     * @param message - メッセージ
     * @param args - 追加引数
     */
    private _log(level: LogLevel, message: string, ...args: unknown[]): void {
        // ログレベルチェック
        if (level < this.level) {
            return;
        }

        // メッセージのフォーマット
        const formattedMessage = this._formatMessage(level, message);

        // ログ履歴に追加（開発環境のみ）
        if (!this._isProduction()) {
            this.history.push({
                level,
                message: formattedMessage,
                args,
                timestamp: new Date().toISOString()
            });

            // 履歴サイズの制限
            if (this.history.length > this.maxHistorySize) {
                this.history.shift();
            }
        }

        // コンソール出力（Loggerクラス内部でのみ許可）
        switch (level) {
            case LogLevel.DEBUG:
            case LogLevel.INFO:
                console.info(formattedMessage, ...args);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage, ...args);
                break;
            case LogLevel.ERROR:
                console.error(formattedMessage, ...args);
                break;
        }
    }

    /**
     * DEBUG レベルログ
     *
     * @param message - メッセージ
     * @param args - 追加引数
     */
    public debug(message: string, ...args: unknown[]): void {
        this._log(LogLevel.DEBUG, message, ...args);
    }

    /**
     * INFO レベルログ
     *
     * @param message - メッセージ
     * @param args - 追加引数
     */
    public info(message: string, ...args: unknown[]): void {
        this._log(LogLevel.INFO, message, ...args);
    }

    /**
     * WARN レベルログ
     *
     * @param message - メッセージ
     * @param args - 追加引数
     */
    public warn(message: string, ...args: unknown[]): void {
        this._log(LogLevel.WARN, message, ...args);
    }

    /**
     * ERROR レベルログ
     *
     * @param message - メッセージ
     * @param args - 追加引数
     */
    public error(message: string, ...args: unknown[]): void {
        this._log(LogLevel.ERROR, message, ...args);
    }

    /**
     * ログレベルの設定
     *
     * @param level - ログレベル
     */
    public setLevel(level: LogLevel): void {
        this.level = level;
    }

    /**
     * ログレベルの取得
     *
     * @returns ログレベル
     */
    public getLevel(): LogLevel {
        return this.level;
    }

    /**
     * ログ履歴の取得
     *
     * @returns ログ履歴
     */
    public getHistory(): LogEntry[] {
        return [...this.history];
    }

    /**
     * ログ履歴のクリア
     */
    public clearHistory(): void {
        this.history.length = 0;
    }

    /**
     * グループログの開始
     *
     * @param label - グループラベル
     */
    public group(label: string): void {
        if (this.level <= LogLevel.DEBUG) {
            // eslint-disable-next-line no-console
            console.group(label);
        }
    }

    /**
     * グループログの終了
     */
    public groupEnd(): void {
        if (this.level <= LogLevel.DEBUG) {
            // eslint-disable-next-line no-console
            console.groupEnd();
        }
    }
}

/**
 * デフォルトロガーインスタンス
 */
export const defaultLogger = new Logger();

/**
 * デフォルトエクスポート
 */
export default {
    Logger,
    LogLevel,
    defaultLogger
};
