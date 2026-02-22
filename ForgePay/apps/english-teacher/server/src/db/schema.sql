-- ユーザーテーブル: 無料制限と支払い状態を管理
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  paid INTEGER NOT NULL DEFAULT 0,           -- 1: 支払い済み, 0: 未払い
  free_questions_used INTEGER NOT NULL DEFAULT 0,
  payment_session_id TEXT,                   -- 最後の決済セッション ID（ForgePay 経由）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 質問履歴テーブル: 会話ログと分析用
CREATE TABLE IF NOT EXISTS question_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_paid_request INTEGER NOT NULL DEFAULT 0, -- 支払い済みユーザーの質問かどうか
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (user_id)
);

-- インデックス: ユーザー別の質問履歴検索を高速化
CREATE INDEX IF NOT EXISTS idx_question_history_user_id
  ON question_history (user_id);
