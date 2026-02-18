# ForgePay

**OpenAI ChatGPT Apps の収益化を実現する Stripe 直接連携レイヤー。**

ChatGPT の [External Checkout Flow](https://platform.openai.com/docs/actions/monetization) に対応したマルチテナント決済 API。  
Stripe の機能（決済・サブスク・税金・不正防止）をそのまま活用し、**OpenAI 固有の `purchase_intent_id` マッピングと Entitlement 管理のみ**を担う最小設計。

```
ChatGPT App ──→ ForgePay API ──→ Stripe（決済処理）
                    │
                    ├─ purchase_intent_id ↔ Stripe Session マッピング
                    ├─ Webhook 受信（冪等性付き）
                    └─ JWT unlock_token 発行・検証
```

| レイヤー | 技術 |
|---------|------|
| API | Node.js 18+ / Express / TypeScript |
| DB | PostgreSQL |
| Cache | Redis |
| Dashboard | React + Vite + TailwindCSS |

---

## セットアップ

### 前提条件

- Node.js >= 18、Docker
- [Stripe アカウント](https://dashboard.stripe.com/register)（無料）

### 1. インストール

```bash
git clone <repository-url>
cd ForgePay
npm install && cd dashboard && npm install && cd ..
```

### 2. セットアップウィザードを起動

```bash
npm run setup
```

対話形式で以下を自動実行します:

1. Stripe キー入力 → `.env` 自動生成（JWT シークレットも自動生成）
2. Docker で PostgreSQL + Redis 起動
3. DB マイグレーション実行
4. 開発者アカウント登録 → **API キーが発行され、メールで届きます**

### 3. ダッシュボード起動

```bash
cd dashboard && npm run dev
# http://localhost:3001
```

取得した API キー（`fpb_test_...`）でログイン。

---

## Stripe の接続

ダッシュボードの **Settings → Stripe API Keys** から接続できます。

1. [Stripe API キーを取得](https://dashboard.stripe.com/test/apikeys)（`sk_test_...` / `pk_test_...`）
2. Settings ページに貼り付け → **「接続テスト」で確認** → **「保存」**

> Settings ページに Stripe アカウント作成からキー入力までのガイドが表示されます。

---

## API の使い方

すべてのリクエストに `X-API-Key: YOUR_API_KEY` ヘッダーが必要です（登録・キー再発行系を除く）。

### 商品・価格の作成

```bash
# 商品作成
curl -X POST http://localhost:3000/api/v1/admin/products \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Premium Plan", "type": "subscription"}'

# 価格作成
curl -X POST http://localhost:3000/api/v1/admin/prices \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"product_id": "PRODUCT_ID", "amount": 1000, "currency": "jpy", "interval": "month"}'
```

### 決済フロー（ChatGPT App 連携）

**① Checkout Session 作成**

```bash
curl -X POST http://localhost:3000/api/v1/checkout/sessions \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "PRODUCT_ID",
    "price_id": "PRICE_ID",
    "purchase_intent_id": "pi_from_openai_12345",
    "customer_email": "user@example.com",
    "success_url": "https://your-app.com/success",
    "cancel_url": "https://your-app.com/cancel"
  }'
```

```json
{
  "checkout_url": "https://checkout.stripe.com/pay/cs_test_...",
  "session_id": "sess_uuid",
  "expires_at": "2024-01-01T01:00:00Z"
}
```

ユーザーを `checkout_url` にリダイレクト → Stripe が決済処理 → Webhook で ForgePay に通知 → `unlock_token` 自動発行。

**② Entitlement 検証（アクセス許可）**

```bash
curl "http://localhost:3000/api/v1/entitlements/verify?unlock_token=JWT_TOKEN" \
  -H "X-API-Key: YOUR_API_KEY"
```

```json
{ "valid": true, "product_id": "...", "status": "active", "expires_at": "..." }
```

### 返金

```bash
curl -X POST http://localhost:3000/api/v1/admin/refunds \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"payment_intent_id": "pi_stripe_...", "amount": 1000, "reason": "customer_request"}'
```

---

## API キーの管理

| 状況 | 方法 |
|------|------|
| 初回登録 | `POST /api/v1/onboarding/register` → レスポンスとメールに届く |
| キー紛失 | `POST /api/v1/onboarding/forgot-key` → メールで新キー発行（旧キー即無効） |
| キー更新 | `POST /api/v1/onboarding/api-key/regenerate` → 旧キーで認証して再発行 |

```bash
# 登録
curl -X POST http://localhost:3000/api/v1/onboarding/register \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com"}'

# キー紛失時
curl -X POST http://localhost:3000/api/v1/onboarding/forgot-key \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com"}'
```

> キー再発行時に処理中の決済セッションがある場合、安全チェック後に警告メールが届きます。

---

## ダッシュボード

| ページ | 機能 |
|--------|------|
| `/` | 売上・顧客・Webhook の状況 |
| `/products` | 商品・価格の作成・編集 |
| `/customers` | 顧客の決済状況確認 |
| `/webhooks` | 失敗 Webhook の確認・再送 |
| `/audit-logs` | 全操作の履歴 |
| `/settings` | Stripe 接続・API キー管理・デフォルト設定 |

---

## API リファレンス

### コア API

| Method | Path | 認証 | 説明 |
|--------|------|------|------|
| GET | `/health` | 不要 | ヘルスチェック |
| POST | `/api/v1/checkout/sessions` | API Key | Checkout Session 作成 |
| GET | `/api/v1/checkout/sessions/:id` | API Key | Session 取得 |
| GET | `/api/v1/entitlements/verify` | API Key | unlock_token 検証 |
| POST | `/api/v1/webhooks/stripe` | 署名検証 | Stripe Webhook 受信 |

### 管理 API（`X-API-Key` 必須）

| Method | Path | 説明 |
|--------|------|------|
| POST/GET | `/api/v1/admin/products` | 商品管理 |
| POST | `/api/v1/admin/prices` | 価格作成 |
| GET | `/api/v1/admin/customers` | 顧客一覧 |
| POST | `/api/v1/admin/refunds` | 返金処理 |
| GET | `/api/v1/admin/audit-logs` | 監査ログ |
| GET | `/api/v1/admin/webhooks/failed` | 失敗 Webhook 一覧 |

### オンボーディング API

| Method | Path | 認証 | 説明 |
|--------|------|------|------|
| POST | `/api/v1/onboarding/register` | 不要 | 開発者登録・API キー発行 |
| POST | `/api/v1/onboarding/forgot-key` | 不要 | キー紛失時の再発行（メール送信） |
| GET | `/api/v1/onboarding/me` | API Key | 開発者情報取得 |
| GET | `/api/v1/onboarding/status` | API Key | オンボーディング進捗確認 |
| POST | `/api/v1/onboarding/stripe/keys` | API Key | Stripe キー設定 |
| POST | `/api/v1/onboarding/stripe/verify` | API Key | Stripe キー接続テスト |
| POST | `/api/v1/onboarding/api-key/regenerate` | API Key | API キー再発行 |
| DELETE | `/api/v1/onboarding/account` | API Key | アカウント削除 |

---

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run setup` | セットアップウィザード起動 |
| `npm run dev` | バックエンド開発サーバー起動 |
| `npm run build` | TypeScript ビルド |
| `npm run migrate:up` | DB マイグレーション実行 |
| `npm run migrate:down` | マイグレーション巻き戻し |
| `npm run docker:up` | PostgreSQL + Redis 起動 |
| `npm run docker:down` | Docker コンテナ停止 |
| `npm test` | ユニットテスト実行 |
| `npm run test:e2e` | E2E テスト実行（全自動） |

---

## ChatGPT App 連携サンプル

`examples/` フォルダに参照実装が含まれています:

- `examples/openai-action-schema.yaml` — OpenAI Actions に設定する OpenAPI スキーマ
- `examples/chatgpt-app-integration.ts` — TypeScript による checkout〜verify の実装例

---

## 付録

<details>
<summary>セキュリティ設計</summary>

| 項目 | 実装 |
|-----|------|
| API 認証 | SHA-256 ハッシュ済み API キー（`X-API-Key` ヘッダー） |
| Webhook 検証 | Stripe 署名検証（`stripe-signature` ヘッダー） |
| unlock_token | 短命 JWT（5分）+ Redis JTI 追跡（使い捨て） |
| Stripe キー保護 | AES-256-GCM で暗号化して DB 保存 |
| レート制限 | Redis ベースのスライディングウィンドウ |
| CORS | 本番環境ではホワイトリスト方式 |

</details>

<details>
<summary>DB テーブル構成</summary>

| テーブル | 目的 |
|---------|------|
| `developers` | 開発者アカウント・API キー（SHA-256 ハッシュ） |
| `products` / `prices` | 商品・価格（Stripe にマッピング） |
| `customers` | 顧客情報（Stripe Customer にマッピング） |
| `checkout_sessions` | `purchase_intent_id` ↔ Stripe Session マッピング |
| `entitlements` | Entitlement 状態管理 |
| `webhook_events` | Webhook 冪等性管理・DLQ |
| `used_tokens` | JWT 使い捨てトークン管理 |
| `audit_logs` | 全操作の監査ログ |

</details>

<details>
<summary>トラブルシューティング</summary>

**サーバーに接続できない**
```bash
npm run docker:up && npm run dev
curl http://localhost:3000/health
```

**DB マイグレーションエラー**
```bash
npm run migrate:down && npm run migrate:up
```

**Stripe Webhook が届かない**
```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

**メール送信を有効にする（本番環境）**

`npm install nodemailer` を実行後、`.env` に以下を追加:
```env
EMAIL_SMTP_HOST=smtp.example.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=user@example.com
EMAIL_SMTP_PASS=password
EMAIL_FROM=noreply@forgepay.io
```
> Gmail: `smtp.gmail.com` / ポート `587` / アプリパスワードを使用。  
> 未設定時はコンソールにログ出力（開発環境向けフォールバック）。

</details>

---

## ライセンス

MIT
