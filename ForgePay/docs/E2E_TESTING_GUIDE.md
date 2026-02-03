# E2E テスト実行ガイド

このガイドでは、ForgePay の E2E テストを実行するための完全な手順を説明します。

## 前提条件

- Node.js v18+ がインストールされていること
- Docker Desktop が起動していること
- Stripe アカウントがあること

---

## Step 1: 依存関係のインストール

```bash
cd d:\apps\ForgePay

# バックエンドの依存関係をインストール
npm install

# ダッシュボードの依存関係をインストール
cd dashboard && npm install && cd ..

# Playwright をインストール（初回のみ）
npx playwright install
```

---

## Step 2: Docker でデータベースを起動

```bash
# PostgreSQL と Redis を起動
docker-compose up -d postgres redis

# 起動確認
docker ps
```

**期待される出力**:
```
CONTAINER ID   IMAGE      STATUS          PORTS
xxx            postgres   Up X minutes    0.0.0.0:5432->5432/tcp
xxx            redis      Up X minutes    0.0.0.0:6379->6379/tcp
```

---

## Step 3: データベースマイグレーション

```bash
npm run migrate:up
```

**期待される出力**:
```
Migrations complete.
```

---

## Step 4: .env ファイルの確認

`.env` ファイルに以下の設定が含まれていることを確認:

```env
# 必須設定
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge
REDIS_URL=redis://localhost:6379
STRIPE_MODE=test
STRIPE_TEST_SECRET_KEY=sk_test_...  # あなたのStripeテストキー
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
JWT_SECRET=any-secret-string-here

# E2E テスト用（Step 6で設定）
ENABLE_E2E_TESTS=true
# TEST_API_KEY=fpb_test_xxx...  # Step 6で取得
DASHBOARD_URL=http://localhost:3001
```

---

## Step 5: バックエンドサーバーを起動

**ターミナル 1** で実行:

```bash
npm run dev
```

**期待される出力**:
```
{"level":"info","message":"Database connection successful"}
{"level":"info","message":"Redis client connected"}
{"level":"info","message":"ForgePayBridge server started","port":3000}
```

サーバーが起動したことを確認するには:
```bash
curl http://localhost:3000/health
```

**期待される出力**:
```json
{"status":"ok","timestamp":"...","environment":"development"}
```

---

## Step 6: テスト用開発者を作成（API経由）

**新しいターミナル（ターミナル 2）** で実行:

```bash
node scripts/setup-test-developer.js
```

**期待される出力**:
```
🚀 Setting up test developer via API...

📝 Registering test developer...
✅ Developer registered successfully!

============================================================
🔑 TEST API KEY (Save this - it will not be shown again!)
============================================================

   fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

============================================================

📋 Next Steps:

1. Add this API key to your .env file:
   TEST_API_KEY=fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

...

🔍 Verifying API key...
✅ API key verified successfully!
   Developer ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   Email: e2e-test@forgepay.io
   Test Mode: true

✨ Setup complete!
```

**重要**: 表示された `fpb_test_xxx...` の API キーを `.env` ファイルに追加:

```bash
# .env ファイルを開いて以下を追加/更新
TEST_API_KEY=fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 7: E2E テストを実行

### オプション A: API テスト (Jest + Supertest)

```bash
# 環境変数を設定してテスト実行
ENABLE_E2E_TESTS=true TEST_API_KEY=fpb_test_xxx npm test -- --testPathPattern=e2e
```

または PowerShell の場合:
```powershell
$env:ENABLE_E2E_TESTS="true"
$env:TEST_API_KEY="fpb_test_xxx"  # 実際のキーに置き換え
npm test -- --testPathPattern=e2e
```

**期待される出力**:
```
PASS  src/__tests__/e2e/payment-flow.e2e.test.ts
  E2E: ForgePay Payment Platform
    Health Check Endpoints
      ✓ GET /health - should return healthy status
      ✓ GET /api/v1/health - should return detailed health status
    ...
```

### オプション B: UI テスト (Playwright)

**ターミナル 3** でダッシュボードを起動:
```bash
cd dashboard && npm run dev
```

**ターミナル 2** でテスト実行:
```bash
# 環境変数を設定
$env:TEST_API_KEY="fpb_test_xxx"  # 実際のキーに置き換え

# ヘッドレスモードで実行
npm run test:e2e

# ブラウザ表示ありで実行（デバッグ用）
npm run test:e2e:headed

# UI モードで実行（インタラクティブ）
npm run test:e2e:ui
```

**期待される出力**:
```
Running 10 tests using 1 worker

  ✓ admin-login.spec.ts:20:5 › Admin Login Flow › should display login page correctly
  ✓ admin-login.spec.ts:36:5 › Admin Login Flow › should login with valid API key
  ...
```

---

## トラブルシューティング

### 問題: "Database connection failed"

**解決策**:
```bash
# Dockerコンテナの状態確認
docker ps

# 再起動
docker-compose restart postgres redis

# ログ確認
docker logs forgepaybridge-postgres
```

### 問題: "TEST_API_KEY is not set"

**解決策**:
```bash
# 環境変数を確認
echo $env:TEST_API_KEY  # PowerShell
echo $TEST_API_KEY       # Bash

# 設定されていない場合、再度設定
$env:TEST_API_KEY="fpb_test_xxx"
```

### 問題: "Developer already exists"

**解決策**:
```bash
# 既存のテスト開発者を削除
docker exec forgepaybridge-postgres psql -U postgres -d forgepaybridge -c "DELETE FROM developers WHERE email = 'e2e-test@forgepay.io';"

# 再度作成
node scripts/setup-test-developer.js
```

### 問題: Port 3000/3001 is already in use

**解決策** (PowerShell):
```powershell
# ポート3000を使用しているプロセスを確認
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess

# プロセスを終了
Stop-Process -Id <PID> -Force
```

### 問題: Playwright テストがタイムアウト

**解決策**:
```bash
# ダッシュボードが起動しているか確認
curl http://localhost:3001

# ダッシュボードを再起動
cd dashboard && npm run dev
```

---

## テストデータについて

**重要**: E2E テストはすべてのデータを **API 経由** で作成します。

✅ **正しい方法**:
- `/api/v1/onboarding/register` でテスト開発者を作成
- `/api/v1/admin/products` でテスト商品を作成
- `/api/v1/checkout/sessions` でチェックアウトセッションを作成

❌ **禁止された方法**:
- データベースに直接 INSERT 文を実行
- `pool.query()` で直接データを挿入

これにより、実際のユーザーフローと同じパスでテストが実行されます。

---

## テストカバレッジ

### API テスト (Jest)
- ヘルスチェック
- 認証 (API Key 検証)
- チェックアウトフロー
- 商品管理
- 顧客管理
- クーポンシステム
- 多通貨サポート
- GDPR コンプライアンス
- 監査ログ

### UI テスト (Playwright)
- Admin Dashboard ログイン
- ダッシュボード表示
- 商品ページ
- 顧客ページ
- Webhook 監視
- 監査ログ
- Customer Portal マジックリンク

---

## クイックスタート（コマンドまとめ）

```bash
# 1. 依存関係インストール
npm install && cd dashboard && npm install && cd ..

# 2. Docker 起動
docker-compose up -d postgres redis

# 3. マイグレーション
npm run migrate:up

# 4. バックエンド起動（ターミナル1）
npm run dev

# 5. テスト開発者作成（ターミナル2）
npm run test:e2e:setup
# → 出力された API キーを .env の TEST_API_KEY に保存

# 6. API E2E テスト実行（簡単な方法）
npm run test:e2e:api

# 7. ダッシュボード起動（Playwright テスト用、ターミナル3）
cd dashboard && npm run dev

# 8. Playwright テスト実行（ターミナル2）
npm run test:e2e
```

## 利用可能な npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run test:e2e:setup` | テスト開発者を API 経由で作成 |
| `npm run test:e2e:api` | Jest + Supertest の API テストを実行 |
| `npm run test:e2e` | Playwright UI テストを実行 |
| `npm run test:e2e:headed` | ブラウザ表示ありで実行 |
| `npm run test:e2e:ui` | インタラクティブ UI で実行 |
| `npm run test:e2e:debug` | デバッグモードで実行 |
