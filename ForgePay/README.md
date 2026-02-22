# ForgePay

**アプリの決済を一括管理する集中型決済レイヤー。**

Stripe の機能（決済・サブスク・税金・不正防止）をそのまま活用し、アプリは Stripe を直接触らずに決済を実現できる。

---

## 技術アーキテクチャ

```mermaid
flowchart TB
  subgraph app ["あなたのアプリ（例: English Teacher）"]
    A1["ビジネスロジック"]
    A2["POST /api/v1/quickpay<br>purchase_intent_id だけ渡す"]
    A3["POST /callback/forgepay<br>で通知を受信"]
  end

  subgraph forgepay ["ForgePay（ポート 3000）"]
    F1["QuickPay API"]
    F2["商品 / 価格管理"]
    F3["Stripe Webhook 受信"]
    F4["コールバック通知"]
    F5["Entitlement 管理"]
    DB["PostgreSQL"]
    Cache["Redis"]
  end

  subgraph stripe ["Stripe"]
    S1["Checkout Session"]
    S2["Webhook"]
  end

  A2 --> F1
  F1 --> S1
  S2 --> F3
  F3 --> F4
  F4 --> A3
  F1 --> DB
  F3 --> DB
  F1 --> Cache
```

### 呼び出し関係

```
アプリ → ForgePay → Stripe     （決済セッション作成）
Stripe → ForgePay → アプリ     （決済完了通知）
アプリ → ForgePay              （支払い状態確認）
```

**アプリは Stripe を直接呼ばない。** ForgePay が全ての Stripe 通信を代行する。

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| API | Node.js 18+ / Express / TypeScript |
| DB | PostgreSQL |
| Cache | Redis |
| Dashboard | React + Vite + TailwindCSS |

---

## セットアップ

### 前提条件

- Node.js >= 18、Docker Desktop
- [Stripe アカウント](https://dashboard.stripe.com/register)（無料）
- [Stripe CLI](https://stripe.com/docs/stripe-cli)（`winget install stripe.cli`）

---

### 🔰 一回のみ実行（初回セットアップ）

#### 1. インストール

```bash
git clone <repository-url>
cd ForgePay
npm install && cd dashboard && npm install && cd ..
```

#### 2. セットアップウィザード

```bash
npm run setup
```

対話形式で `.env` 生成 → Docker 起動 → DB マイグレーション → 開発者アカウント登録を自動実行。

1. Stripe キー入力 → `.env` 自動生成（JWT シークレットも自動生成）
2. Docker で PostgreSQL + Redis 起動
3. DB マイグレーション実行
4. 開発者アカウント登録 → **API キー発行**（`fpb_test_...`）

> API キーは一度しか表示されません。必ずコピーして保管してください。

#### 3. Stripe CLI ログイン

```bash
stripe login
```

#### 4. Webhook シークレット取得

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

表示された `whsec_...` を `.env` の `STRIPE_TEST_WEBHOOK_SECRET` にコピー。
同じ Stripe アカウントであれば値は毎回同じなので、**一度だけ** `.env` に設定すれば OK。

#### 5. Stripe キー接続

ダッシュボード **Settings → Stripe API Keys** から接続・保存。

---

### ▶️ 毎回起動時

```bash
# Docker が停止している場合のみ
npm run docker:up

# ターミナル 1: バックエンド　→ http://localhost:3000/health
npm run dev

# ターミナル 2: ダッシュボード → http://localhost:3001
cd dashboard && npm run dev

# ターミナル 3: Stripe Webhook フォワード（決済テスト時）
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

取得した API キー（`fpb_test_...`）でダッシュボードにログイン。

---

### 🔧 個別場合のみ

| 場面 | コマンド |
|------|---------|
| `npm run git:sync` 後に新しいマイグレーションが追加された | `npm run migrate:up` |
| 最新コードをリモートから取得 | `npm run git:sync` |
| マイグレーションを巻き戻したい | `npm run migrate:down` |
---

## ポート構成

| サービス | ポート | 説明 |
|----------|--------|------|
| バックエンド API | `3000` | Express サーバー |
| ダッシュボード | `3001` | Vite 開発サーバー（`/api` → 3000 にプロキシ） |
| PostgreSQL | `5432` | Docker |
| Redis | `6379` | Docker |

---

## .env 設定例

```env
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000

# Stripe（テスト用キー）
STRIPE_MODE=test
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...

# DB & Redis
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge
REDIS_URL=redis://localhost:6379

# セキュリティ
JWT_SECRET=dev-jwt-secret-change-in-production
ENCRYPTION_KEY=dev-encryption-key-change-in-production
```

---

## QuickPay API — 3 モード

アプリが決済セッションを作成する唯一のエンドポイント。

### `POST /api/v1/quickpay`

**ヘッダー:** `X-API-Key: YOUR_API_KEY`

| モード | 必須フィールド | 説明 |
|--------|---------------|------|
| 商品 ID | `purchase_intent_id` + `product_id` | ダッシュボードで作成した商品を使用。価格は DB から自動解決 |
| Price ID | `purchase_intent_id` + `price_id` | Stripe Price ID を直接指定 |
| アドホック | `purchase_intent_id` + `name` + `amount` + `currency` | 商品未登録でもその場で決済 |

`success_url` / `cancel_url` は省略可。省略時はダッシュボードのデフォルト設定を使用。

```bash
# 最小の呼び出し（user_id だけ）
curl -X POST http://localhost:3000/api/v1/quickpay \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"purchase_intent_id": "user_123"}'
```

```json
{
  "session_id": "cs_test_...",
  "checkout_url": "https://checkout.stripe.com/pay/...",
  "expires_at": "2026-02-22T01:30:00Z"
}
```

---

## ダッシュボード設定

`http://localhost:3001/settings` にログイン後：

| 項目 | 説明 | 設定例 |
|------|------|--------|
| Stripe 決済キー | `.env` から自動読み込み。ダッシュボードからも上書き可能 | 接続済みと表示されれば OK |
| 会社名 | Stripe 決済画面に表示される名前 | `My SaaS` |
| 成功時 URL | 支払い完了後のリダイレクト先 | `http://localhost:3002/checkout/success` |
| キャンセル URL | やめた時の戻り先 | `http://localhost:3002/checkout/cancel` |
| 決済方法 | クレカ・コンビニ等。複数選択可 | `Credit Card` |
| デフォルト言語 | Stripe チェックアウト画面の言語 | `Japanese` |
| デフォルト通貨 | 商品価格のデフォルト通貨 | `JPY` |
| 通知先 URL | 決済完了をアプリに通知する URL | `http://localhost:3002/callback/forgepay` |

---

## Stripe Webhook ローカルテスト

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
# 表示される whsec_... を .env の STRIPE_TEST_WEBHOOK_SECRET に設定
```

---

## API リファレンス

### コア API

| Method | Path | 認証 | 説明 |
|--------|------|------|------|
| GET | `/health` | 不要 | ヘルスチェック |
| POST | `/api/v1/quickpay` | API Key | 簡易決済セッション作成（3 モード） |
| POST | `/api/v1/checkout/sessions` | API Key | Checkout Session 作成 |
| GET | `/api/v1/checkout/sessions/:id` | API Key | Session 取得 |
| GET | `/api/v1/entitlements/verify` | API Key | 購入状態検証 |
| POST | `/api/v1/webhooks/stripe` | 署名検証 | Stripe Webhook 受信 |

### 管理 API（`X-API-Key` 必須）

| Method | Path | 説明 |
|--------|------|------|
| POST/GET | `/api/v1/admin/products` | 商品管理 |
| POST | `/api/v1/admin/prices` | 価格作成 |
| GET | `/api/v1/admin/customers` | 顧客一覧 |
| POST | `/api/v1/admin/refunds` | 返金処理 |
| GET | `/api/v1/admin/audit-logs` | 監査ログ |

### オンボーディング API

| Method | Path | 認証 | 説明 |
|--------|------|------|------|
| POST | `/api/v1/onboarding/register` | 不要 | 開発者登録・API キー発行 |
| POST | `/api/v1/onboarding/forgot-key` | 不要 | キー紛失時の再発行 |
| GET | `/api/v1/onboarding/settings` | API Key | 設定取得 |
| PUT | `/api/v1/onboarding/settings` | API Key | 設定更新 |
| POST | `/api/v1/onboarding/stripe/keys` | API Key | Stripe キー設定 |

---

## サンプルアプリ

| アプリ | ディレクトリ | 説明 |
|--------|-------------|------|
| English Teacher | `apps/english-teacher/` | ChatGPT MCP + ForgePay 連携の英語教師サービス |

---

## アプリ統合ガイド

**[INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)** に詳細な統合手順を記載。
AI コーディングアシスタントが読めば ForgePay 連携アプリを自律的に構築できる。

---

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run setup` | セットアップウィザード |
| `npm run dev` | バックエンド開発サーバー |
| `npm run build` | TypeScript ビルド |
| `npm run migrate:up` | DB マイグレーション |
| `npm run migrate:down` | マイグレーション巻き戻し |
| `npm run docker:up` | PostgreSQL + Redis 起動 |
| `npm run docker:down` | Docker 停止 |
| `npm test` | ユニットテスト |
| `npm run test:e2e` | E2E テスト |

---

## ライセンス

MIT
