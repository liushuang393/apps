# データベース接続確認ガイド

ローカル環境でデータベース接続を確認する方法を説明します。

---

## 🚀 方法1: 専用テストスクリプト（推奨）

### 実行方法

```bash
cd api
npm run test:db
```

### 出力例（成功時）

```
============================================================
データベース接続テスト
============================================================
接続文字列: postgresql://triprize:triprize_password@localhost:5432/triprize

1. 接続テスト実行中...
✓ Database connection established
✅ データベース接続成功

2. クエリテスト実行中...
✅ クエリ成功
   現在時刻: 2024-01-15T10:30:45.123Z
   PostgreSQL バージョン: PostgreSQL 16.1

3. テーブル一覧確認中...
✅ 15 個のテーブルが見つかりました:
   1. campaigns
   2. layers
   3. lottery_results
   4. payment_transactions
   5. positions
   6. prizes
   7. purchases
   8. users
   ...

4. 接続プール情報:
   - 総接続数: 1
   - アイドル接続数: 1
   - 待機中の接続数: 0

============================================================
✅ すべてのテストが成功しました！
============================================================
```

### 出力例（失敗時）

```
============================================================
❌ エラーが発生しました
============================================================
エラーメッセージ: connect ECONNREFUSED 127.0.0.1:5432

確認事項:
1. Docker コンテナが起動しているか: docker-compose ps
2. DATABASE_URL が正しく設定されているか: api/.env を確認
3. データベースがマイグレーション済みか: npm run migrate
============================================================
```

---

## 🚀 方法2: API サーバー起動時のログ確認

### 実行方法

```bash
cd api
npm run dev
```

### 成功時のログ

```
[INFO] Starting TriPrize API server...
[INFO] Testing database connection...
[INFO] ✓ Database connection established
[INFO] ✓ Database connection successful
[INFO] Connecting to Redis...
[INFO] ✓ Redis connection successful
[INFO] Initializing Firebase...
[INFO] ✓ Firebase initialized
[INFO] ✓ Server running at http://0.0.0.0:3000
[INFO] ✓ Health check: http://0.0.0.0:0:3000/health
```

### 失敗時のログ

```
[INFO] Starting TriPrize API server...
[INFO] Testing database connection...
[ERROR] ✗ Database connection failed
[ERROR] Error: connect ECONNREFUSED 127.0.0.1:5432
[ERROR] Failed to start server
```

---

## 🚀 方法3: Health Check API エンドポイント

### 前提条件

API サーバーが起動している必要があります。

### 実行方法

```bash
# PowerShell
Invoke-WebRequest -Uri http://localhost:3000/health | ConvertFrom-Json

# curl (WSL/Git Bash)
curl http://localhost:3000/health

# ブラウザ
# http://localhost:3000/health にアクセス
```

### 成功時のレスポンス

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "environment": "development"
}
```

**注意**: Health check エンドポイントはデータベース接続を直接テストしませんが、サーバーが起動していることを確認できます。

---

## 🚀 方法4: 直接 PostgreSQL に接続（Docker）

### 実行方法

```bash
# Docker コンテナ内の PostgreSQL に接続
docker exec -it triprize-postgres psql -U triprize -d triprize

# または、ローカルの psql クライアントから
psql -h localhost -U triprize -d triprize
# パスワード: triprize_password
```

### 接続確認コマンド

```sql
-- 現在時刻を確認
SELECT NOW();

-- PostgreSQL バージョン確認
SELECT version();

-- データベース一覧
\l

-- テーブル一覧
\dt

-- 接続情報確認
SELECT * FROM pg_stat_activity WHERE datname = 'triprize';

-- 終了
\q
```

---

## 🚀 方法5: Docker コンテナの状態確認

### 実行方法

```bash
# コンテナの状態確認
docker-compose ps

# ログ確認
docker-compose logs postgres

# コンテナ内で PostgreSQL が起動しているか確認
docker exec triprize-postgres pg_isready -U triprize
```

### 成功時の出力

```
NAME                IMAGE                STATUS
triprize-postgres   postgres:16-alpine   Up (healthy)
```

```
/var/run/postgresql:5432 - accepting connections
```

---

## 🔍 トラブルシューティング

### 問題1: `ECONNREFUSED` エラー

**原因**: PostgreSQL が起動していない、またはポートが間違っている

**解決策**:
```bash
# Docker コンテナを起動
docker-compose up -d postgres

# 起動確認
docker-compose ps
```

---

### 問題2: `password authentication failed` エラー

**原因**: パスワードが間違っている

**解決策**:
1. `api/.env` の `DATABASE_URL` を確認
2. `docker-compose.yml` の `POSTGRES_PASSWORD` を確認
3. 両方が一致していることを確認

---

### 問題3: `database "triprize" does not exist` エラー

**原因**: データベースが作成されていない

**解決策**:
```bash
# マイグレーションを実行
cd api
npm run migrate
```

---

### 問題4: `relation "users" does not exist` エラー

**原因**: テーブルが作成されていない（マイグレーション未実行）

**解決策**:
```bash
cd api
npm run migrate
```

---

## 📋 チェックリスト

接続確認のためのチェックリスト：

- [ ] Docker コンテナが起動している (`docker-compose ps`)
- [ ] `api/.env` ファイルが存在し、`DATABASE_URL` が設定されている
- [ ] `DATABASE_URL` の値が正しい（ユーザー名、パスワード、データベース名）
- [ ] マイグレーションが実行済み (`npm run migrate`)
- [ ] ポート 5432 が使用可能（他の PostgreSQL インスタンスと競合していない）

---

## 🎯 推奨される確認手順

1. **まず Docker コンテナを確認**
   ```bash
   docker-compose ps
   ```

2. **専用テストスクリプトを実行**
   ```bash
   cd api
   npm run test:db
   ```

3. **API サーバーを起動してログを確認**
   ```bash
   npm run dev
   ```

4. **Health check エンドポイントを確認**
   ```bash
   curl http://localhost:3000/health
   ```

すべて成功すれば、データベース接続は正常に動作しています！ ✅
