import { getDb } from '../db/client';

// 無料質問の制限回数（環境変数で上書き可能）
export const FREE_QUESTION_LIMIT = parseInt(process.env.FREE_QUESTION_LIMIT ?? '3', 10);

export interface User {
  user_id: string;
  paid: boolean;
  free_questions_used: number;
  payment_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserStatus {
  paid: boolean;
  free_questions_used: number;
  free_limit: number;
  can_ask: boolean;
  remaining_free: number;
}

/**
 * ユーザーを取得する。存在しない場合は新規作成する
 */
export async function getOrCreateUser(userId: string): Promise<User> {
  const db = getDb();

  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE user_id = ?',
    args: [userId],
  });

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      user_id: row.user_id as string,
      paid: (row.paid as number) === 1,
      free_questions_used: row.free_questions_used as number,
      payment_session_id: row.payment_session_id as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  await db.execute({
    sql: `INSERT INTO users (user_id, paid, free_questions_used)
          VALUES (?, 0, 0)`,
    args: [userId],
  });

  return {
    user_id: userId,
    paid: false,
    free_questions_used: 0,
    payment_session_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * ユーザーの現在のステータスを返す
 */
export async function getUserStatus(userId: string): Promise<UserStatus> {
  const user = await getOrCreateUser(userId);
  const remaining_free = Math.max(0, FREE_QUESTION_LIMIT - user.free_questions_used);

  return {
    paid: user.paid,
    free_questions_used: user.free_questions_used,
    free_limit: FREE_QUESTION_LIMIT,
    can_ask: user.paid || user.free_questions_used < FREE_QUESTION_LIMIT,
    remaining_free,
  };
}

/**
 * 無料質問のカウントをインクリメントする
 */
export async function incrementFreeCount(userId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE users
          SET free_questions_used = free_questions_used + 1,
              updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [userId],
  });
}

/**
 * ユーザーを支払い済みとしてマークする（ForgePay コールバックから呼ばれる）
 */
export async function markUserAsPaid(
  userId: string,
  sessionId?: string,
): Promise<void> {
  const db = getDb();

  await getOrCreateUser(userId);

  await db.execute({
    sql: `UPDATE users
          SET paid = 1,
              payment_session_id = COALESCE(?, payment_session_id),
              updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [sessionId ?? null, userId],
  });
}

/**
 * 質問履歴を保存する
 */
export async function saveQuestionHistory(
  userId: string,
  question: string,
  answer: string,
  isPaidRequest: boolean,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO question_history (user_id, question, answer, is_paid_request)
          VALUES (?, ?, ?, ?)`,
    args: [userId, question, answer, isPaidRequest ? 1 : 0],
  });
}

/**
 * 決済セッション ID からユーザーを検索する
 */
export async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE payment_session_id = ?',
    args: [sessionId],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    user_id: row.user_id as string,
    paid: (row.paid as number) === 1,
    free_questions_used: row.free_questions_used as number,
    payment_session_id: row.payment_session_id as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * チェックアウト開始時に決済セッション ID を仮保存する
 */
export async function savePaymentSession(userId: string, sessionId: string): Promise<void> {
  const db = getDb();
  await getOrCreateUser(userId);
  await db.execute({
    sql: `UPDATE users
          SET payment_session_id = ?,
              updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [sessionId, userId],
  });
}
