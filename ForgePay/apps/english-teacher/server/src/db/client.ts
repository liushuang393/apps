import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { readFileSync } from 'fs';

// データベースクライアントのシングルトン管理
let dbClient: Client | null = null;

/**
 * LibSQL クライアントを初期化して返す
 * DATABASE_PATH=":memory:" を指定するとインメモリ DB を使用する（テスト用）
 */
export function getDb(): Client {
  if (dbClient) {
    return dbClient;
  }

  const dbPath = process.env.DATABASE_PATH ?? './data/english-teacher.db';

  // テスト用インメモリモード
  if (dbPath === ':memory:') {
    dbClient = createClient({ url: 'file::memory:' });
    return dbClient;
  }

  const absolutePath = path.resolve(dbPath);

  // データディレクトリが存在しない場合は作成
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbClient = createClient({
    url: `file:${absolutePath}`,
  });

  return dbClient;
}

/**
 * シングルトンをリセットする（テスト用）
 * 各テストケース前に呼び出すことで新鮮な DB を得る
 */
export function resetDb(): void {
  dbClient = null;
}

/**
 * スキーマ SQL を実行してテーブルを初期化する
 */
export async function initializeSchema(): Promise<void> {
  const db = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');

  // スキーマ内の各ステートメントを順番に実行
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.execute(stmt);
  }
}
