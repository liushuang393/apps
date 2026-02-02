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
6. e2e test
ENABLE_E2E_TESTS=true npm test

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

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report
- `npm run migrate:up` - Run database migrations
- `npm run migrate:down` - Rollback database migrations
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier

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

### Unit Tests

```bash
npm test
```

### Property-Based Tests

Property-based tests use `fast-check` to verify universal properties:

```bash
npm test -- --testPathPattern=property
```

### Integration Tests

```bash
npm test -- --testPathPattern=integration
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
