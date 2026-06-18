/**
 * ConversationDatabase - 会話データベース管理
 *
 * @description
 * SQLite を使用して会話履歴を永続化管理
 *
 * @features
 * - セッション自動採番
 * - 会話ターン管理
 * - コンテキスト取得
 * - 統計情報
 *
 * @note
 * Electron 環境専用（ブラウザ・拡張機能では使用不可）
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 環境検出
 *
 * @returns true if running in Electron environment
 */
export function isElectronEnvironment(): boolean {
    return (
        typeof process !== 'undefined' &&
        process.versions !== null &&
        process.versions.electron !== null
    );
}

/**
 * ターン情報インターフェース
 */
export interface Turn {
    id?: number;
    sessionId: number;
    role: 'user' | 'assistant';
    content: string;
    language?: string;
    timestamp: number;
}

/**
 * セッション情報インターフェース
 */
export interface Session {
    id: number;
    startTime: number;
    endTime?: number;
    turnCount: number;
    sourceLanguage?: string;
    targetLanguage?: string;
}

/**
 * 会話データベース管理クラス
 */
export class ConversationDatabase {
    private db: Database.Database;
    private currentSessionId: number | null = null;

    /**
     * @param dbPath データベースファイルパス（オプション）
     *
     * 優先順位:
     * 1. 引数で指定されたパス
     * 2. 環境変数 CONVERSATION_DB_PATH
     * 3. デフォルトパス: アプリディレクトリ/db/conversations.db
     */
    constructor(dbPath?: string) {
        console.info('[ConversationDB] データベース初期化開始');

        // ✅ パス決定ロジック
        if (!dbPath) {
            // 環境変数から読み込み
            const envPath = process.env['CONVERSATION_DB_PATH'];
            if (envPath) {
                dbPath = envPath;
                console.info('[ConversationDB] 環境変数からパス取得:', dbPath);
            } else {
                console.info('[ConversationDB] 環境変数 CONVERSATION_DB_PATH は設定されていません');
            }
        }

        if (!dbPath) {
            // デフォルトパス: アプリディレクトリ/db/conversations.db
            const { app } = require('electron');

            // 開発環境と本番環境で異なるパスを使用
            // 開発環境: process.cwd() (D:\apps\simultaneous_interpretation)
            // 本番環境: app.getAppPath() (パッケージディレクトリ)
            const isDev = !app.isPackaged;
            const appPath = isDev ? process.cwd() : app.getAppPath();

            dbPath = path.join(appPath, 'db', 'conversations.db');
            console.info('[ConversationDB] デフォルトパス使用:', {
                isDev: isDev,
                appPath: appPath,
                dbPath: dbPath
            });
        }

        // ディレクトリが存在しない場合は作成
        const dir = path.dirname(dbPath);
        console.info('[ConversationDB] ディレクトリチェック:', dir);

        if (fs.existsSync(dir)) {
            console.info('[ConversationDB] ディレクトリは既に存在します:', dir);
        } else {
            console.info('[ConversationDB] ディレクトリが存在しないため作成します:', dir);
            fs.mkdirSync(dir, { recursive: true });
            console.info('[ConversationDB] ディレクトリ作成完了:', dir);
        }

        console.info('[ConversationDB] 最終的なデータベースパス:', dbPath);
        this.db = new Database(dbPath);
        console.info('[ConversationDB] データベース接続完了');

        this.initializeTables();
        console.info('[ConversationDB] テーブル初期化完了');
    }

    /**
     * テーブル初期化
     *
     * @private
     */
    private initializeTables(): void {
        // ✅ セッションテーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                turn_count INTEGER DEFAULT 0,
                source_language TEXT,
                target_language TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // ✅ ターンテーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                language TEXT,
                timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        `);

        // ✅ インデックス作成
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
            CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
            CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
        `);

        console.info('[ConversationDB] テーブル初期化完了');
    }

    /**
     * 新しいセッションを開始
     *
     * @param sourceLanguage ソース言語
     * @param targetLanguage ターゲット言語
     * @returns セッションID
     */
    startSession(sourceLanguage?: string, targetLanguage?: string): number {
        const stmt = this.db.prepare(`
            INSERT INTO sessions (start_time, source_language, target_language)
            VALUES (?, ?, ?)
        `);

        const result = stmt.run(Date.now(), sourceLanguage, targetLanguage);
        this.currentSessionId = result.lastInsertRowid as number;

        console.info('[ConversationDB] セッション開始:', {
            sessionId: this.currentSessionId,
            sourceLanguage,
            targetLanguage
        });

        return this.currentSessionId;
    }

    /**
     * 現在のセッションを終了
     */
    endSession(): void {
        if (!this.currentSessionId) {
            console.warn('[ConversationDB] アクティブなセッションがありません');
            return;
        }

        const stmt = this.db.prepare(`
            UPDATE sessions 
            SET end_time = ?,
                turn_count = (SELECT COUNT(*) FROM turns WHERE session_id = ?)
            WHERE id = ?
        `);

        stmt.run(Date.now(), this.currentSessionId, this.currentSessionId);

        console.info('[ConversationDB] セッション終了:', {
            sessionId: this.currentSessionId
        });

        this.currentSessionId = null;
    }

    /**
     * 現在のセッションIDを取得
     *
     * @returns セッションID（なければ新規作成）
     */
    getCurrentSessionId(): number {
        if (!this.currentSessionId) {
            return this.startSession();
        }
        return this.currentSessionId;
    }

    /**
     * ターンを追加
     *
     * @param turn ターン情報
     * @returns ターンID
     */
    addTurn(turn: Omit<Turn, 'id' | 'sessionId'>): number {
        const sessionId = this.getCurrentSessionId();

        const stmt = this.db.prepare(`
            INSERT INTO turns (session_id, role, content, language, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            sessionId,
            turn.role,
            turn.content,
            turn.language || null,
            turn.timestamp
        );

        console.info('[ConversationDB] ターン追加:', {
            turnId: result.lastInsertRowid,
            sessionId,
            role: turn.role,
            contentLength: turn.content.length
        });

        return result.lastInsertRowid as number;
    }

    /**
     * 最近のターンを取得
     *
     * @param count 取得件数
     * @param sessionId セッションID（省略時は現在のセッション）
     * @returns ターン配列
     */
    getRecentTurns(count: number = 10, sessionId?: number): Turn[] {
        const targetSessionId = sessionId !== undefined ? sessionId : this.currentSessionId;
        if (!targetSessionId) {
            return [];
        }

        const stmt = this.db.prepare(`
            SELECT id, session_id as sessionId, role, content, language, timestamp
            FROM turns
            WHERE session_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        const turns = stmt.all(targetSessionId, count) as Turn[];
        const reversedTurns = turns.reverse(); // 古い順に並べ替え

        console.info('[ConversationDB] ターン取得:', {
            sessionId: targetSessionId,
            requested: count,
            returned: reversedTurns.length
        });

        return reversedTurns;
    }

    /**
     * セッション情報を取得
     *
     * @param sessionId セッションID
     * @returns セッション情報
     */
    getSession(sessionId: number): Session | null {
        const stmt = this.db.prepare(`
            SELECT 
                id,
                start_time as startTime,
                end_time as endTime,
                turn_count as turnCount,
                source_language as sourceLanguage,
                target_language as targetLanguage
            FROM sessions
            WHERE id = ?
        `);

        return stmt.get(sessionId) as Session | null;
    }

    /**
     * すべてのセッションを取得
     *
     * @param limit 取得件数（デフォルト: 100）
     * @returns セッション配列
     */
    getAllSessions(limit: number = 100): Session[] {
        const stmt = this.db.prepare(`
            SELECT 
                id,
                start_time as startTime,
                end_time as endTime,
                turn_count as turnCount,
                source_language as sourceLanguage,
                target_language as targetLanguage
            FROM sessions
            ORDER BY start_time DESC
            LIMIT ?
        `);

        return stmt.all(limit) as Session[];
    }

    /**
     * セッションのすべてのターンを取得
     *
     * @param sessionId セッションID
     * @returns ターン配列
     */
    getSessionTurns(sessionId: number): Turn[] {
        const stmt = this.db.prepare(`
            SELECT id, session_id as sessionId, role, content, language, timestamp
            FROM turns
            WHERE session_id = ?
            ORDER BY timestamp ASC
        `);

        return stmt.all(sessionId) as Turn[];
    }

    /**
     * OpenAI形式のコンテキストを取得
     *
     * @param count 取得件数
     * @param sessionId セッションID
     * @returns メッセージ配列
     */
    getContextForAPI(
        count: number = 10,
        sessionId?: number
    ): Array<{ role: string; content: string }> {
        const turns = this.getRecentTurns(count, sessionId);
        return turns.map((turn) => ({
            role: turn.role,
            content: turn.content
        }));
    }

    /**
     * 統計情報を取得
     *
     * @returns 統計情報
     */
    getStats(): {
        totalSessions: number;
        totalTurns: number;
        currentSessionTurns: number;
        averageTurnsPerSession: number;
    } {
        const statsStmt = this.db.prepare(`
            SELECT 
                COUNT(DISTINCT session_id) as totalSessions,
                COUNT(*) as totalTurns,
                CAST(COUNT(*) AS REAL) / COUNT(DISTINCT session_id) as avgTurns
            FROM turns
        `);

        const stats = statsStmt.get() as {
            totalSessions: number;
            totalTurns: number;
            avgTurns: number;
        };

        let currentSessionTurns = 0;
        if (this.currentSessionId) {
            const currentStmt = this.db.prepare(
                'SELECT COUNT(*) as count FROM turns WHERE session_id = ?'
            );
            const current = currentStmt.get(this.currentSessionId) as { count: number };
            currentSessionTurns = current.count;
        }

        return {
            totalSessions: stats.totalSessions || 0,
            totalTurns: stats.totalTurns || 0,
            currentSessionTurns,
            averageTurnsPerSession: Math.round(stats.avgTurns) || 0
        };
    }

    /**
     * 古いセッションを削除
     *
     * @param daysToKeep 保持日数
     * @returns 削除されたセッション数
     */
    cleanupOldSessions(daysToKeep: number = 30): number {
        const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

        const stmt = this.db.prepare(`
            DELETE FROM sessions
            WHERE start_time < ?
        `);

        const result = stmt.run(cutoffTime);

        const deletedCount = result.changes || 0;

        console.info('[ConversationDB] 古いセッション削除:', {
            daysToKeep,
            deletedCount
        });

        return deletedCount;
    }

    /**
     * データベースをバックアップ
     *
     * @param backupPath バックアップファイルパス
     */
    backup(backupPath: string): void {
        const backupDb = new Database(backupPath);
        this.db.backup(backupDb.name);
        backupDb.close();

        console.info('[ConversationDB] バックアップ完了:', backupPath);
    }

    /**
     * データベースを閉じる
     */
    close(): void {
        if (this.currentSessionId) {
            this.endSession();
        }
        this.db.close();
        console.info('[ConversationDB] データベースクローズ');
    }
}
