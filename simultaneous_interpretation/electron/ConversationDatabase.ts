/** Electron 専用の暗号化会話履歴リポジトリ。 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app, safeStorage } from 'electron';

const SCHEMA_VERSION = 2;
const MAX_QUERY_LIMIT = 1_000;
const DECRYPTION_PLACEHOLDER = '[内容を復号できません]';

export function isElectronEnvironment(): boolean {
    return (
        typeof process !== 'undefined' &&
        process.versions !== null &&
        typeof process.versions.electron === 'string'
    );
}

export interface Turn {
    id?: number;
    sessionId: number;
    segmentId: string;
    role: 'user' | 'assistant';
    content: string;
    language?: string;
    timestamp: number;
    isFinal: boolean;
    source: string;
    decryptionError?: boolean;
}

export interface Session {
    id: number;
    startTime: number;
    endTime?: number;
    turnCount: number;
    sourceLanguage?: string;
    targetLanguage?: string;
    status: 'active' | 'completed' | 'interrupted';
}

export interface SegmentTurnInput {
    sessionId: number;
    segmentId: string;
    role: 'user' | 'assistant';
    content: string;
    language?: string;
    timestamp: number;
    isFinal: boolean;
    source: string;
}

export interface ContentCipher {
    isAvailable(): boolean;
    encrypt(content: string): Buffer;
    decrypt(content: Buffer): string;
}

class SafeStorageContentCipher implements ContentCipher {
    public isAvailable(): boolean {
        return safeStorage.isEncryptionAvailable();
    }

    public encrypt(content: string): Buffer {
        return safeStorage.encryptString(content);
    }

    public decrypt(content: Buffer): string {
        return safeStorage.decryptString(content);
    }
}

interface TurnRow {
    id: number;
    sessionId: number;
    segmentId: string;
    role: 'user' | 'assistant';
    contentCipher: Buffer;
    language: string | null;
    timestamp: number;
    isFinal: number;
    source: string;
}

export class ConversationDatabase {
    private readonly db: Database.Database;
    private readonly cipher: ContentCipher;
    private currentSessionId: number | null = null;

    public constructor(dbPath?: string, cipher: ContentCipher = new SafeStorageContentCipher()) {
        if (!cipher.isAvailable()) {
            throw new Error('OS の暗号化ストレージを利用できないため、会話履歴を有効化できません');
        }
        this.cipher = cipher;

        const resolvedPath = dbPath || path.join(app.getPath('userData'), 'conversations.db');
        const directory = path.dirname(resolvedPath);
        fs.mkdirSync(directory, { recursive: true });
        this.createPreMigrationBackup(resolvedPath);

        this.db = new Database(resolvedPath);
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL');
        this.initializeSchema();
        this.markAbandonedSessionsInterrupted();
    }

    public startSession(sourceLanguage?: string, targetLanguage?: string): number {
        if (this.currentSessionId !== null) {
            this.endSession('interrupted');
        }
        const result = this.db
            .prepare(
                `INSERT INTO sessions
                    (start_time, status, source_language, target_language)
                 VALUES (?, 'active', ?, ?)`
            )
            .run(Date.now(), sourceLanguage ?? null, targetLanguage ?? null);
        this.currentSessionId = Number(result.lastInsertRowid);
        return this.currentSessionId;
    }

    public endSession(status: 'completed' | 'interrupted' = 'completed'): void {
        if (this.currentSessionId === null) {
            return;
        }
        const sessionId = this.currentSessionId;
        this.db
            .prepare(
                `UPDATE sessions
                 SET end_time = ?, status = ?,
                     turn_count = (
                         SELECT COUNT(DISTINCT segment_id) FROM turns WHERE session_id = ?
                     )
                 WHERE id = ?`
            )
            .run(Date.now(), status, sessionId, sessionId);
        this.currentSessionId = null;
    }

    public getCurrentSessionId(): number {
        return this.currentSessionId ?? this.startSession();
    }

    /** 旧 renderer 経路の互換 API。新規コードは upsertSegmentTurn を使用する。 */
    public addTurn(
        turn: Omit<Turn, 'id' | 'sessionId' | 'segmentId' | 'isFinal' | 'source'>
    ): number {
        const sessionId = this.getCurrentSessionId();
        const segmentId = `legacy_${turn.timestamp}_${Date.now()}`;
        return this.upsertSegmentTurn({
            sessionId,
            segmentId,
            role: turn.role,
            content: turn.content,
            ...(turn.language !== undefined ? { language: turn.language } : {}),
            timestamp: turn.timestamp,
            isFinal: true,
            source: 'legacy'
        });
    }

    public upsertSegmentTurn(turn: SegmentTurnInput): number {
        this.validateSegmentTurn(turn);
        const encrypted = this.cipher.encrypt(turn.content);
        const result = this.db
            .prepare(
                `INSERT INTO turns
                    (session_id, segment_id, role, content_cipher, encryption_version,
                     language, timestamp, is_final, source)
                 VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
                 ON CONFLICT(session_id, segment_id, role) DO UPDATE SET
                     content_cipher = excluded.content_cipher,
                     encryption_version = excluded.encryption_version,
                     language = excluded.language,
                     timestamp = excluded.timestamp,
                     is_final = excluded.is_final,
                     source = excluded.source`
            )
            .run(
                turn.sessionId,
                turn.segmentId,
                turn.role,
                encrypted,
                turn.language ?? null,
                turn.timestamp,
                turn.isFinal ? 1 : 0,
                turn.source
            );
        this.refreshTurnCount(turn.sessionId);
        if (result.lastInsertRowid !== 0) {
            return Number(result.lastInsertRowid);
        }
        const row = this.db
            .prepare('SELECT id FROM turns WHERE session_id = ? AND segment_id = ? AND role = ?')
            .get(turn.sessionId, turn.segmentId, turn.role) as { id: number } | undefined;
        if (row === undefined) {
            throw new Error('履歴ターンの保存結果を取得できませんでした');
        }
        return row.id;
    }

    public getRecentTurns(count: number = 10, sessionId?: number): Turn[] {
        const targetSessionId = sessionId ?? this.currentSessionId;
        if (targetSessionId === null) {
            return [];
        }
        const limit = this.normalizeLimit(count, 10);
        const rows = this.db
            .prepare(
                `SELECT id, session_id AS sessionId, segment_id AS segmentId, role,
                        content_cipher AS contentCipher, language, timestamp,
                        is_final AS isFinal, source
                 FROM turns WHERE session_id = ?
                 ORDER BY timestamp DESC, id DESC LIMIT ?`
            )
            .all(targetSessionId, limit) as TurnRow[];
        return rows.reverse().map((row) => this.toTurn(row));
    }

    public getSession(sessionId: number): Session | null {
        this.validatePositiveInteger(sessionId, 'sessionId');
        return (
            (this.db
                .prepare(
                    `SELECT id, start_time AS startTime, end_time AS endTime,
                            turn_count AS turnCount, source_language AS sourceLanguage,
                            target_language AS targetLanguage, status
                     FROM sessions WHERE id = ?`
                )
                .get(sessionId) as Session | undefined) ?? null
        );
    }

    public getAllSessions(limit: number = 100): Session[] {
        return this.db
            .prepare(
                `SELECT id, start_time AS startTime, end_time AS endTime,
                        turn_count AS turnCount, source_language AS sourceLanguage,
                        target_language AS targetLanguage, status
                 FROM sessions ORDER BY start_time DESC LIMIT ?`
            )
            .all(this.normalizeLimit(limit, 100)) as Session[];
    }

    public getSessionTurns(sessionId: number): Turn[] {
        this.validatePositiveInteger(sessionId, 'sessionId');
        const rows = this.db
            .prepare(
                `SELECT id, session_id AS sessionId, segment_id AS segmentId, role,
                        content_cipher AS contentCipher, language, timestamp,
                        is_final AS isFinal, source
                 FROM turns WHERE session_id = ?
                 ORDER BY timestamp ASC, id ASC LIMIT ?`
            )
            .all(sessionId, MAX_QUERY_LIMIT) as TurnRow[];
        return rows.map((row) => this.toTurn(row));
    }

    public getContextForAPI(
        count: number = 10,
        sessionId?: number
    ): Array<{ role: string; content: string }> {
        return this.getRecentTurns(count, sessionId).map((turn) => ({
            role: turn.role,
            content: turn.content
        }));
    }

    public getStats(): {
        totalSessions: number;
        totalTurns: number;
        currentSessionTurns: number;
        averageTurnsPerSession: number;
    } {
        const sessionStats = this.db
            .prepare('SELECT COUNT(*) AS totalSessions FROM sessions')
            .get() as { totalSessions: number };
        const turnStats = this.db
            .prepare(
                'SELECT COUNT(DISTINCT session_id || char(0) || segment_id) AS totalTurns FROM turns'
            )
            .get() as { totalTurns: number };
        let currentSessionTurns = 0;
        if (this.currentSessionId !== null) {
            const current = this.db
                .prepare(
                    'SELECT COUNT(DISTINCT segment_id) AS count FROM turns WHERE session_id = ?'
                )
                .get(this.currentSessionId) as { count: number };
            currentSessionTurns = current.count;
        }
        const totalSessions = sessionStats.totalSessions || 0;
        const totalTurns = turnStats.totalTurns || 0;
        return {
            totalSessions,
            totalTurns,
            currentSessionTurns,
            averageTurnsPerSession: totalSessions === 0 ? 0 : Math.round(totalTurns / totalSessions)
        };
    }

    /** 永久保存が既定。互換 API として明示呼出し時だけ削除する。 */
    public cleanupOldSessions(daysToKeep: number = 30): number {
        if (!Number.isFinite(daysToKeep) || daysToKeep <= 0) {
            throw new Error('daysToKeep は正の数で指定してください');
        }
        const result = this.db
            .prepare("DELETE FROM sessions WHERE start_time < ? AND status != 'active'")
            .run(Date.now() - daysToKeep * 86_400_000);
        return result.changes;
    }

    public clearAll(): number {
        if (this.currentSessionId !== null) {
            throw new Error('翻訳中は会話履歴を清空できません');
        }
        return this.db.prepare('DELETE FROM sessions').run().changes;
    }

    public close(): void {
        if (this.currentSessionId !== null) {
            this.endSession('interrupted');
        }
        this.db.close();
    }

    private initializeSchema(): void {
        const hasSessions =
            this.db
                .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'")
                .get() !== undefined;
        const currentVersion = Number(this.db.pragma('user_version', { simple: true }));
        if (!hasSessions) {
            this.createSchemaV2();
            return;
        }
        if (currentVersion < SCHEMA_VERSION) {
            this.migrateLegacySchema();
        }
    }

    private createSchemaV2(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'interrupted')),
                turn_count INTEGER NOT NULL DEFAULT 0,
                source_language TEXT,
                target_language TEXT,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                segment_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content_cipher BLOB NOT NULL,
                encryption_version INTEGER NOT NULL,
                language TEXT,
                timestamp INTEGER NOT NULL,
                is_final INTEGER NOT NULL DEFAULT 1,
                source TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                UNIQUE(session_id, segment_id, role)
            );
            CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
            CREATE INDEX IF NOT EXISTS idx_turns_segment_id ON turns(segment_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
            PRAGMA user_version = 2;
        `);
    }

    private migrateLegacySchema(): void {
        const migration = this.db.transaction(() => {
            this.db.exec(`
                ALTER TABLE sessions RENAME TO sessions_legacy;
                ALTER TABLE turns RENAME TO turns_legacy;
            `);
            this.createSchemaV2();
            this.db.exec(`
                INSERT INTO sessions
                    (id, start_time, end_time, status, turn_count,
                     source_language, target_language, created_at)
                SELECT id, start_time, end_time,
                       CASE WHEN end_time IS NULL THEN 'interrupted' ELSE 'completed' END,
                       turn_count, source_language, target_language, created_at
                FROM sessions_legacy;
            `);
            const legacyTurns = this.db
                .prepare(
                    `SELECT id, session_id AS sessionId, role, content, language, timestamp, created_at AS createdAt
                     FROM turns_legacy ORDER BY id`
                )
                .all() as Array<{
                id: number;
                sessionId: number;
                role: 'user' | 'assistant';
                content: string;
                language: string | null;
                timestamp: number;
                createdAt: number;
            }>;
            const insert = this.db.prepare(
                `INSERT INTO turns
                    (id, session_id, segment_id, role, content_cipher, encryption_version,
                     language, timestamp, is_final, source, created_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, 'legacy-migration', ?)`
            );
            for (const turn of legacyTurns) {
                insert.run(
                    turn.id,
                    turn.sessionId,
                    `legacy_${turn.id}`,
                    turn.role,
                    this.cipher.encrypt(turn.content),
                    turn.language,
                    turn.timestamp,
                    turn.createdAt
                );
            }
            this.db.exec(`
                DROP TABLE turns_legacy;
                DROP TABLE sessions_legacy;
                CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
                CREATE INDEX IF NOT EXISTS idx_turns_segment_id ON turns(segment_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
                PRAGMA user_version = 2;
            `);
            this.db.exec(`
                UPDATE sessions SET turn_count = (
                    SELECT COUNT(DISTINCT segment_id) FROM turns WHERE session_id = sessions.id
                );
            `);
        });
        migration();
    }

    private markAbandonedSessionsInterrupted(): void {
        this.db
            .prepare(
                "UPDATE sessions SET status = 'interrupted', end_time = COALESCE(end_time, ?) WHERE status = 'active'"
            )
            .run(Date.now());
    }

    private refreshTurnCount(sessionId: number): void {
        this.db
            .prepare(
                `UPDATE sessions SET turn_count = (
                    SELECT COUNT(DISTINCT segment_id) FROM turns WHERE session_id = ?
                 ) WHERE id = ?`
            )
            .run(sessionId, sessionId);
    }

    private toTurn(row: TurnRow): Turn {
        try {
            return {
                id: row.id,
                sessionId: row.sessionId,
                segmentId: row.segmentId,
                role: row.role,
                content: this.cipher.decrypt(row.contentCipher),
                ...(row.language !== null ? { language: row.language } : {}),
                timestamp: row.timestamp,
                isFinal: row.isFinal === 1,
                source: row.source
            };
        } catch {
            return {
                id: row.id,
                sessionId: row.sessionId,
                segmentId: row.segmentId,
                role: row.role,
                content: DECRYPTION_PLACEHOLDER,
                ...(row.language !== null ? { language: row.language } : {}),
                timestamp: row.timestamp,
                isFinal: row.isFinal === 1,
                source: row.source,
                decryptionError: true
            };
        }
    }

    private validateSegmentTurn(turn: SegmentTurnInput): void {
        this.validatePositiveInteger(turn.sessionId, 'sessionId');
        if (turn.segmentId.length === 0 || turn.segmentId.length > 200) {
            throw new Error('segmentId が不正です');
        }
        if (turn.content.length === 0 || turn.content.length > 1_000_000) {
            throw new Error('履歴本文の長さが不正です');
        }
        if (!Number.isFinite(turn.timestamp) || turn.timestamp <= 0) {
            throw new Error('timestamp が不正です');
        }
        if (turn.source.length === 0 || turn.source.length > 100) {
            throw new Error('source が不正です');
        }
    }

    private validatePositiveInteger(value: number, name: string): void {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${name} が不正です`);
        }
    }

    private normalizeLimit(value: number, fallback: number): number {
        return Number.isSafeInteger(value) && value > 0
            ? Math.min(value, MAX_QUERY_LIMIT)
            : fallback;
    }

    private createPreMigrationBackup(databasePath: string): void {
        if (!fs.existsSync(databasePath)) {
            return;
        }
        const backupPath = `${databasePath}.pre-v2.bak`;
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
        }
    }
}
