# ForgePayBridge (フォージペイ)

A SaaS platform that wraps Stripe to provide a turnkey payment solution for OpenAI ChatGPT Apps monetization.

## Features

- 🔐 **Hosted Checkout Pages** - Stripe-powered payment pages with automatic tax calculation
- 🎫 **Entitlement Management** - Automatic access control for one-time and subscription purchases
- 🔄 **Reliable Webhooks** - Idempotent webhook processing with retry logic and DLQ
- 🤖 **ChatGPT Integration** - Seamless integration with OpenAI's External Checkout flow
- 📊 **Admin Dashboard** - Web interface for product management and analytics
- 🌍 **Multi-Currency** - Support for USD, EUR, GBP, JPY, AUD, and more
- 💰 **Tax Handling** - Automatic VAT, GST, and sales tax calculation
- 🛡️ **Security** - PCI-compliant via Stripe, fraud prevention with Stripe Radar

## Prerequisites

- Node.js 18+ (LTS)
- PostgreSQL 14+
- Redis 6+
- Stripe account (test and/or live mode)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd forgepaybridge
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run database migrations:
```bash
npm run migrate:up
```

5. Start the development server:
```bash
npm run dev
```

6. (Optional) Run E2E tests - see [Testing](#testing) section below

## Configuration

### Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `STRIPE_MODE` - Set to `test` or `live`
- `STRIPE_TEST_SECRET_KEY` - Your Stripe test secret key
- `STRIPE_TEST_WEBHOOK_SECRET` - Your Stripe test webhook secret
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for signing unlock tokens

### Stripe Setup

1. Create a Stripe account at https://stripe.com
2. Get your API keys from the Stripe Dashboard
3. Configure webhook endpoint: `https://yourdomain.com/api/v1/webhooks/stripe`
4. Select webhook events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`

### ローカル開発環境セットアップ（完全ガイド）

ローカル環境でStripe Webhookをテストするための完全な手順です。

#### 前提条件

- Node.js 18+
- Docker Desktop（PostgreSQL/Redis用）
- Stripeアカウント（テストモード）

#### Step 1: 依存関係のインストール

```bash
# プロジェクトのルートで実行
npm install
```

#### Step 2: Docker でデータベース起動

```bash
# PostgreSQL と Redis を起動
docker-compose up -d postgres redis

# 起動確認
docker ps
```

#### Step 3: データベースマイグレーション

```bash
npm run migrate:up
```

#### Step 4: Stripe CLI のインストール

```bash
# Windows (Winget - 推奨)
winget install Stripe.StripeCLI

# Windows (Scoop)
scoop install stripe

# Windows (手動インストール)
# https://github.com/stripe/stripe-cli/releases からダウンロード

# Mac (Homebrew)
brew install stripe/stripe-cli/stripe

# Linux (apt)
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install stripe

# インストール確認
stripe --version
```

#### Step 5: Stripe CLI にログイン

```bash
stripe login
```

ブラウザが自動で開き、Stripeアカウントへの認証を求められます。
「Allow access」をクリックして認証を完了してください。

認証成功時の表示:
```
> Your pairing code is: enjoy-adore-glad-poise
> This pairing code verifies your authentication with Stripe.
> Press Enter to open the browser or visit https://dashboard.stripe.com/stripecli/confirm_auth?t=...
> Done! The Stripe CLI is configured for [your-account-name]
```

#### Step 6: Webhook シークレットキーの取得

**新しいターミナルを開いて**以下を実行（サーバー起動中に実行）:

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

出力例:
```
> Ready! You are using Stripe API Version [2023-10-16].
> Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**重要**: `whsec_` で始まるシークレットキーをコピーしてください。

#### Step 7: .env ファイルの設定

`.env.example` をコピーして `.env` を作成:

```bash
cp .env.example .env
```

`.env` ファイルを編集して以下を設定:

```env
# Stripe テストキー（Stripe Dashboardから取得）
STRIPE_TEST_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxx

# Webhook シークレット（stripe listen コマンドから取得）
STRIPE_TEST_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### Step 8: サーバー起動

```bash
npm run dev
```

正常起動時のログ:
```
{"level":"info","message":"Database connection successful"}
{"level":"info","message":"Redis connection successful"}
{"level":"info","message":"ForgePayBridge server started","port":3000}
```

#### Step 9: 動作確認

```bash
# ヘルスチェック
curl http://localhost:3000/health

# API ドキュメント
# ブラウザで http://localhost:3000/api-docs を開く
```

#### Step 10: Webhook テスト

stripe listen を実行中の状態で、別のターミナルからテストイベントを送信:

```bash
# チェックアウト完了イベント
stripe trigger checkout.session.completed

# 支払い成功イベント
stripe trigger payment_intent.succeeded

# サブスクリプション更新イベント
stripe trigger invoice.paid

# 返金イベント
stripe trigger charge.refunded

# 全イベント一覧
stripe trigger --help
```

#### テストカード番号

| カード番号 | 結果 | 用途 |
|-----------|------|------|
| `4242 4242 4242 4242` | 成功 | 通常の支払いテスト |
| `4000 0025 0000 3155` | 3Dセキュア認証必要 | 認証フローテスト |
| `4000 0000 0000 0002` | 拒否 | エラーハンドリングテスト |
| `4000 0000 0000 9995` | 残高不足 | 残高エラーテスト |
| `4000 0000 0000 3220` | 3Dセキュア2必須 | SCA対応テスト |

**共通設定**:
- 有効期限: 任意の将来日付（例: 12/34）
- CVC: 任意の3桁（例: 123）
- 郵便番号: 任意（例: 12345）

#### トラブルシューティング

**Stripe CLI が見つからない場合**:
```bash
# パス再読み込み（Windows PowerShell）
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# または新しいターミナルを開く
```

**Webhook が届かない場合**:
1. `stripe listen` が実行中か確認
2. サーバーがポート3000で起動しているか確認
3. `.env` の `STRIPE_TEST_WEBHOOK_SECRET` が正しいか確認

**データベース接続エラー**:
```bash
# コンテナ状態確認
docker ps

# コンテナ再起動
docker-compose restart postgres redis
```

## Development

### Available Scripts

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（ホットリロード） |
| `npm run build` | 本番ビルド |
| `npm start` | 本番サーバー起動 |
| `npm test` | 単体テスト実行 |
| `npm run test:watch` | ウォッチモードでテスト |
| `npm run test:coverage` | カバレッジレポート生成 |
| `npm run test:e2e:setup` | E2E テスト開発者作成 |
| `npm run test:e2e:api` | API E2E テスト実行 |
| `npm run test:e2e` | Playwright UI テスト |
| `npm run migrate:up` | マイグレーション実行 |
| `npm run migrate:down` | マイグレーションロールバック |
| `npm run lint` | Lint 実行 |
| `npm run format` | Prettier でフォーマット |
| `npm run docker:up` | PostgreSQL/Redis 起動 |
| `npm run docker:down` | Docker コンテナ停止 |

### Project Structure

```
forgepaybridge/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # API controllers
│   ├── services/        # Business logic services
│   ├── repositories/    # Data access layer
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── app.ts           # Express app setup
│   └── index.ts         # Application entry point
├── migrations/          # Database migrations
├── tests/               # Test files
├── logs/                # Application logs
└── dist/                # Compiled JavaScript (generated)
```

## Testing

### 単体テスト（Unit Tests）

```bash
npm test
```

### プロパティベーステスト（Property-Based Tests）

`fast-check` を使用したプロパティベーステスト:

```bash
npm test -- --testPathPattern=property
```

### 統合テスト（Integration Tests）

```bash
npm test -- --testPathPattern=integration
```

---

## E2E テスト完全ガイド

### 前提条件

- Node.js 18+
- Docker Desktop（PostgreSQL/Redis用）
- バックエンドサーバーが起動していること

### Step 1: 環境準備

```bash
# 依存関係インストール
npm install

# Docker でデータベース起動
docker-compose up -d postgres redis

# マイグレーション実行
npm run migrate:up
```

### Step 2: バックエンドサーバー起動

**ターミナル1** で実行:

```bash
npm run dev
```

正常起動の確認:
```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"...","environment":"development"}
```

### Step 3: テスト開発者の作成

**ターミナル2** で実行:

```bash
npm run test:e2e:setup
```

出力例:
```
🚀 Setting up test developer via API...
✅ Developer registered successfully!

============================================================
🔑 TEST API KEY (Save this - it will not be shown again!)
============================================================

   fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

============================================================

✅ API key verified successfully!
   Developer ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   Email: e2e-test@forgepay.io
   Test Mode: true

✨ Setup complete!
```

**重要**: 出力された API キーを `.env` ファイルに保存:

```env
TEST_API_KEY=fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Step 4: API E2E テスト実行

```bash
# 簡単な方法（推奨）- .env から API Key を自動読み込み
npm run test:e2e:api
```

期待される出力:
```
🧪 Running E2E Tests...
   API Key: fpb_test_xxxxx...

PASS src/__tests__/e2e/payment-flow.e2e.test.ts (11 s)
  E2E: ForgePay Payment Platform
    Health Check Endpoints
      ✓ GET /health - should return healthy status
      ✓ GET /api/v1/health - should return detailed health status
      ✓ GET /api/v1/health/live - should return alive
      ✓ GET /api/v1/health/ready - should return ready status
    API Authentication
      ✓ should reject requests without API key
      ✓ should reject requests with invalid API key
      ✓ should accept requests with valid API key
    Checkout Flow
      ✓ should create checkout session with valid data
      ... (全44テスト)

Test Suites: 1 passed, 1 total
Tests:       44 passed, 44 total

✅ E2E Tests completed successfully!
```

### Step 5: Playwright UI テスト（オプション）

ブラウザベースの UI テストを実行する場合:

#### 5-1: TEST_API_KEY の設定確認

Playwright テストには `TEST_API_KEY` 環境変数が **必須** です。
Step 3 で取得した API キーが `.env` に設定されていることを確認:

```env
# .env ファイル
TEST_API_KEY=fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

または PowerShell で直接設定:

```powershell
$env:TEST_API_KEY="fpb_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

#### 5-2: ダッシュボード起動

**ターミナル3** で実行:

```bash
cd dashboard && npm install && npm run dev
```

ダッシュボードが `http://localhost:3001` で起動していることを確認。

#### 5-3: Playwright テスト実行

**ターミナル2** で実行:

```bash
# ヘッドレスモード（CI向け）
npm run test:e2e

# ブラウザ表示あり（デバッグ向け）
npm run test:e2e:headed

# インタラクティブ UI モード（推奨）
npm run test:e2e:ui

# デバッグモード
npm run test:e2e:debug
```

期待される出力:
```
Running 10 tests using 1 worker

  ✓ admin-login.spec.ts:20:5 › Admin Login Flow › should display login page correctly
  ✓ admin-login.spec.ts:36:5 › Admin Login Flow › should login with valid API key
  ✓ admin-dashboard.spec.ts:15:5 › Admin Dashboard › should display dashboard
  ...

  10 passed (15s)
```

#### TEST_API_KEY が設定されていない場合のエラー

`TEST_API_KEY` が未設定の場合、以下のエラーが表示されます:

```
⚠️  TEST_API_KEY is not set!
    E2E tests require a valid API key.
    
To fix:
1. Start the server: npm run dev
2. Run setup: node scripts/setup-test-developer.js
3. Set the API key: export TEST_API_KEY=<your_api_key>
```

**解決策**:
```bash
# Step 3 を再実行して API Key を取得
npm run test:e2e:setup

# 出力された API Key を .env に保存、または環境変数に設定
$env:TEST_API_KEY="fpb_test_xxx..."  # PowerShell
```

---

### E2E テスト用 npm スクリプト一覧

| コマンド | 説明 |
|---------|------|
| `npm run test:e2e:setup` | テスト開発者を API 経由で作成 |
| `npm run test:e2e:api` | Jest + Supertest の API テストを実行（44テスト） |
| `npm run test:e2e` | Playwright UI テストを実行 |
| `npm run test:e2e:headed` | ブラウザ表示ありで実行 |
| `npm run test:e2e:ui` | インタラクティブ UI で実行 |
| `npm run test:e2e:debug` | デバッグモードで実行 |
| `npm run test:e2e:report` | テストレポートを表示 |

---

### テスト設計原則

**重要**: E2Eテストはすべてのテストデータを **API経由** で作成します。

✅ **正しい方法**:
- `/api/v1/onboarding/register` でテスト開発者を作成
- `/api/v1/admin/products` でテスト商品を作成
- `/api/v1/checkout/sessions` でチェックアウトセッションを作成
- テスト後は API 経由でクリーンアップ

❌ **禁止された方法**:
- データベースに直接 INSERT 文を実行
- `pool.query()` で直接データを挿入

これにより、実際のユーザーフローと同じパスでテストが実行されます。

---

### テストカバレッジ

**API テスト（44テスト）**:
| カテゴリ | テスト数 | 内容 |
|---------|---------|------|
| Health Check | 4 | ヘルスチェックエンドポイント |
| API Authentication | 3 | API Key 認証 |
| Checkout Flow | 4 | チェックアウトフロー |
| Entitlement | 3 | エンタイトルメント検証 |
| Admin Products | 4 | 商品管理 API |
| Admin Customers | 2 | 顧客管理 API |
| Coupon System | 3 | クーポンシステム |
| Multi-Currency | 3 | 多通貨サポート |
| Legal Templates | 3 | 法的テンプレート |
| GDPR Compliance | 2 | GDPR コンプライアンス |
| Monitoring | 2 | モニタリング・メトリクス |
| Developer Onboarding | 3 | 開発者オンボーディング |
| Invoice System | 2 | 請求書システム |
| Audit Logs | 2 | 監査ログ |
| Error Handling | 2 | エラーハンドリング |
| API Documentation | 2 | API ドキュメント |

**UI テスト（Playwright）**:
- Admin Dashboard: ログイン、ダッシュボード、商品管理、顧客管理、Webhook監視、監査ログ
- Customer Portal: マジックリンクログイン、ダッシュボード
- Integration: チェックアウトフロー、Entitlement検証

### 総合テスト準備の概要

**必要な準備**
- Docker Desktop を起動
- Node.js 18+ をインストール

**テスト実行手順**

```powershell
# 環境チェック
.\scripts\env-checker.ps1

# 環境準備（Docker起動、DB移行）
.\scripts\test-runner.ps1 -Setup

# 単体テスト
.\scripts\test-runner.ps1 -Unit
```

**E2Eテスト（サーバー起動が必要）**

```powershell
# ターミナル1: サーバー起動
npm run dev

# ターミナル2: テスト実行
.\scripts\test-runner.ps1 -E2E
```

```
┌──────────────┐        ┌─────────────────────────────┐
│  テストコード  │  HTTP  │  実際のサーバー              │
│              │ ────→  │  localhost:3000             │
│  Jest +      │        │    ↓                        │
│  Supertest   │ ←────  │  DB/Redis (実際に接続)       │
└──────────────┘        └─────────────────────────────┘
```

**Playwright (UI E2Eテスト)（サーバー起動が必要）**

```powershell
# ターミナル1: バックエンド起動
npm run dev

# ターミナル2: フロントエンド起動
cd dashboard && npm run dev

# ターミナル3: テスト実行
.\scripts\test-runner.ps1 -Playwright
```

```
┌──────────────┐        ┌─────────────────────────────┐
│  Playwright  │        │  Dashboard (フロントエンド)   │
│  (ブラウザ)   │ ────→  │  localhost:3001             │
│              │        │    ↓ API呼び出し             │
│  ボタンクリック │        │  Backend (バックエンド)      │
│  入力操作     │        │  localhost:3000             │
│  画面確認     │        │    ↓                        │
│              │ ←────  │  DB/Redis                   │
└──────────────┘        └─────────────────────────────┘
```

**テストの種類**
| オプション | 説明 | サーバー |
|------------|------|----------|
| `-Unit` | コードだけテスト（速い） | 不要 |
| `-E2E` | API通信テスト | 1つ必要 |
| `-Playwright` | 画面操作テスト | 2つ必要 |

---

### クイックリファレンス：Playwright テスト実行手順

```bash
# 1. Docker 起動
docker-compose up -d postgres redis

# 2. マイグレーション
npm run migrate:up

# 3. バックエンド起動（ターミナル1）
npm run dev

# 4. テスト開発者作成（ターミナル2）- 初回のみ
npm run test:e2e:setup
# → 出力された fpb_test_xxx... を .env の TEST_API_KEY に保存

# 5. ダッシュボード起動（ターミナル3）
cd dashboard && npm run dev

# 6. Playwright テスト実行（ターミナル2）
npm run test:e2e
```

---

### トラブルシューティング

**問題: "TEST_API_KEY is not set"**
```bash
# 解決策: テスト開発者を作成して .env に API Key を設定
npm run test:e2e:setup
# → 出力された API Key を .env に保存
```

**問題: "Developer already exists"**
```bash
# 解決策: 既存のテスト開発者を削除して再作成
docker exec forgepaybridge-postgres psql -U postgres -d forgepaybridge \
  -c "DELETE FROM developers WHERE email = 'e2e-test@forgepay.io';"
npm run test:e2e:setup
```

**問題: "Database connection failed"**
```bash
# 解決策: Docker コンテナを再起動
docker-compose restart postgres redis
```

**問題: Port 3000 is already in use**
```powershell
# 解決策 (PowerShell): ポートを使用しているプロセスを終了
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
```

## API Documentation

### Checkout API

**Create Checkout Session**
```
POST /api/v1/checkout/sessions
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "product_id": "prod_123",
  "price_id": "price_456",
  "purchase_intent_id": "pi_openai_789",
  "success_url": "https://chat.openai.com/success",
  "cancel_url": "https://chat.openai.com/cancel"
}
```

**Verify Entitlement**
```
GET /api/v1/entitlements/verify?unlock_token=<token>
Authorization: Bearer <api_key>
```

### Webhook Endpoint

```
POST /api/v1/webhooks/stripe
Stripe-Signature: <signature>

<Stripe event payload>
```

## Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `STRIPE_MODE=live`
- [ ] Configure live Stripe API keys
- [ ] Set strong `JWT_SECRET`
- [ ] Configure production database
- [ ] Configure production Redis
- [ ] Set up SSL/TLS certificates
- [ ] Configure CORS allowed origins
- [ ] Set up monitoring and alerts
- [ ] Configure log aggregation
- [ ] Test webhook delivery
- [ ] Complete Stripe account verification

### Docker Deployment

```bash
docker build -t forgepaybridge .
docker run -p 3000:3000 --env-file .env forgepaybridge
```

## Monitoring

### Health Check

```
GET /health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "environment": "production",
  "stripeMode": "live"
}
```

### Logs

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only

Logs are structured JSON for easy parsing and aggregation.

## Security

- All card data is handled by Stripe (PCI-compliant)
- Webhook signatures are verified
- API keys are hashed before storage
- Rate limiting on all endpoints
- Customer PII is encrypted at rest
- GDPR-compliant data export and deletion

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
