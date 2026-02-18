# ForgePay アーキテクチャ設計書

## 設計方針

ForgePay は **Option A: 薄い連携レイヤー + マルチテナント管理** を採用。
Stripe の重複機能を全て削除し、OpenAI External Checkout Flow 固有ロジックのみを実装。

---

## コンポーネント構成

```
┌─────────────────────────────────────────────────────────────┐
│  ChatGPT App (OpenAI External Checkout Flow)                │
│  └─ purchase_intent_id を含む決済リクエスト                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│  ForgePay API レイヤー                                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Routes (Express)                                     │   │
│  │  ├─ /checkout     → Checkout Session 作成/管理        │   │
│  │  ├─ /entitlements → Entitlement 検証/管理            │   │
│  │  ├─ /webhooks     → Stripe Webhook 受信              │   │
│  │  ├─ /admin        → 商品/価格/顧客/返金/監査ログ管理 │   │
│  │  └─ /onboarding   → 開発者登録/APIキー/Stripe接続    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Middleware                                            │   │
│  │  ├─ apiKeyAuth       → SHA-256 APIキー認証            │   │
│  │  ├─ rateLimiter      → Redis ベースレート制限          │   │
│  │  └─ validate         → Zod スキーマバリデーション      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Services (ビジネスロジック)                           │   │
│  │  ├─ CheckoutService     → purchase_intent_id マッピング│  │
│  │  ├─ EntitlementService  → エンタイトルメント状態管理   │   │
│  │  ├─ TokenService        → JWT unlock token 発行/検証  │   │
│  │  ├─ WebhookProcessor   → Webhook 冪等処理 + DLQ       │   │
│  │  ├─ DeveloperService   → 開発者アカウント管理         │   │
│  │  ├─ CallbackService    → 開発者コールバック通知        │   │
│  │  ├─ StripeClient       → Stripe SDK ラッパー          │   │
│  │  └─ StripeClientFactory→ マルチテナント Stripe 管理    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Repositories (データアクセス層)                       │   │
│  │  ├─ DeveloperRepository                               │   │
│  │  ├─ ProductRepository / PriceRepository               │   │
│  │  ├─ CustomerRepository                                │   │
│  │  ├─ CheckoutSessionRepository                         │   │
│  │  ├─ EntitlementRepository                             │   │
│  │  ├─ WebhookLogRepository                              │   │
│  │  └─ AuditLogRepository                                │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────┬──────────────────┬───────────────────────┘
                   │                  │
    ┌──────────────▼──┐    ┌─────────▼─────────┐
    │   PostgreSQL     │    │   Redis            │
    │  ├─ developers   │    │  ├─ token:used:*   │
    │  ├─ products     │    │  ├─ rate_limit:*   │
    │  ├─ prices       │    │  └─ stripe_client:*│
    │  ├─ customers    │    └───────────────────┘
    │  ├─ checkout_    │
    │  │  sessions     │    ┌───────────────────┐
    │  ├─ entitlements │    │  Stripe API        │
    │  ├─ webhook_     │    │  ├─ Checkout       │
    │  │  events       │    │  ├─ Billing        │
    │  ├─ used_tokens  │    │  ├─ Tax            │
    │  └─ audit_logs   │    │  ├─ Invoicing      │
    └──────────────────┘    │  └─ Customer Portal│
                            └───────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Dashboard (React + Vite + TailwindCSS)                      │
│  ├─ /           → ダッシュボード概要                         │
│  ├─ /products   → 商品・価格管理                             │
│  ├─ /customers  → 顧客一覧                                  │
│  ├─ /webhooks   → Webhook 監視                               │
│  ├─ /audit-logs → 監査ログ                                   │
│  └─ /settings   → 開発者設定                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## コアフロー

### 1. チェックアウトフロー

```
ChatGPT User → OpenAI (purchase_intent_id 発行)
    → ForgePay CheckoutService
        → Stripe Checkout Session 作成（purchase_intent_id を client_reference_id に）
        → DB にマッピング保存
    → ユーザーが Stripe Checkout で決済
    → Stripe Webhook → ForgePay WebhookProcessor
        → checkout.session.completed イベント処理
        → EntitlementService.grantEntitlement()
        → TokenService.generateUnlockToken()
        → CallbackService で開発者に通知
    → ChatGPT App が unlock_token を検証
        → EntitlementService.verifyUnlockToken()
        → アクセス許可
```

### 2. マルチテナントフロー

```
開発者 A → POST /onboarding/register → API キー発行
    → POST /onboarding/stripe/keys → Stripe シークレットキー設定（AES-256-GCM 暗号化）
    → StripeClientFactory が開発者 A 固有の Stripe クライアントを生成（キャッシュ付き）
    → 以降の API 呼び出しは開発者 A の Stripe アカウントで実行
```

---

## 削除済み機能と委譲先

| 削除した機能 | 委譲先 | 理由 |
|---|---|---|
| CurrencyService | Stripe 自動通貨変換 | ハードコード為替レートは Stripe に劣る |
| CouponService | Stripe Coupon / Promotion Code | Stripe の方が機能豊富 |
| InvoiceService | Stripe Invoicing | PDF生成・自動送信は Stripe が提供 |
| TaxService | Stripe Tax (automatic_tax) | リアルタイム税率計算は Stripe が担当 |
| FraudService | Stripe Radar | 不正防止は Stripe のコア機能 |
| EmailService | 外部メールサービス | Stripe の自動メール + 将来的に SES 等 |
| MagicLinkService | Stripe Customer Portal | 顧客のサブスク管理は Stripe が提供 |
| LegalTemplateService | 外部サービス | 法的テンプレートは SaaS の範囲外 |
| GDPRService | 外部コンプライアンスツール | 専用ツール（OneTrust 等）を使用 |
| MetricsService | 外部モニタリング | Datadog / Grafana 等を使用 |
| Customer Portal | Stripe Customer Portal | Stripe が提供する顧客ポータルを利用 |

---

## セキュリティ設計

| 項目 | 実装 |
|---|---|
| API 認証 | SHA-256 ハッシュ済み API キー（X-API-Key ヘッダー） |
| Webhook 検証 | Stripe 署名検証（stripe-signature ヘッダー） |
| Unlock Token | 短命 JWT（5分）+ Redis JTI 追跡で使い捨て |
| Stripe キー暗号化 | AES-256-GCM で暗号化して DB 保存 |
| レート制限 | Redis ベースのスライディングウィンドウ |
| CORS | 本番環境ではホワイトリスト方式 |
| セキュリティヘッダー | Helmet.js |

---

## ファイル構成

```
src/
├── config/             # 設定（DB, Redis, Swagger, 環境変数）
├── middleware/          # 認証, レート制限, バリデーション
├── repositories/       # DB アクセス層（8 リポジトリ）
├── routes/             # API ルート（5 ルーター）
├── schemas/            # Zod バリデーションスキーマ
├── services/           # ビジネスロジック（8 サービス）
├── types/              # TypeScript 型定義
├── utils/              # ユーティリティ（ロガー）
├── __tests__/          # テスト
│   ├── unit/           # ユニットテスト
│   ├── integration/    # 統合テスト
│   └── e2e/            # E2E テスト
└── app.ts              # Express アプリケーション
dashboard/
├── src/
│   ├── components/     # UI コンポーネント
│   ├── hooks/          # React フック
│   ├── lib/            # API クライアント
│   └── pages/          # ページコンポーネント
└── package.json
migrations/             # DB マイグレーション（10 ファイル）
```
