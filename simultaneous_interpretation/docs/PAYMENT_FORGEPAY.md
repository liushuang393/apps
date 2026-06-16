# 決済システム（ForgePay 連携）設計・運用ガイド

本アプリ（VoiceTranslate Pro / 同時通訳）の課金は、自前で Stripe を実装せず
**共通決済サービス ForgePay** 経由で行う。Stripe の鍵・Webhook・商品管理はすべて
ForgePay 側が担い、本アプリは「決済を依頼する」「権限を照会する」だけに徹する。

---

## 0. 前提条件（各システムの拥有者が「一度だけ」設定する）

決済を動かす前に、**アプリのコード外**で次の 2 つを設定しておくこと。
どちらも一度きりの設定で、設定後は全アプリ・全ユーザーで共用される。

### 0-1. ForgePay 側（決済システムの拥有者）
- ForgePay サーバの `.env` に **グローバル Stripe 鍵** を設定して再起動する:
  - テスト: `STRIPE_TEST_SECRET_KEY=sk_test_...`
  - 本番:   `STRIPE_LIVE_SECRET_KEY=sk_live_...`（`STRIPE_MODE=live`）
  - 対応箇所: `ForgePay/src/config/index.ts` → `config.stripe.secretKey`
- 未設定だと、アプリ側が正しくても **quickpay も商品作成も `internal_error`** になる。
  （ForgePay の `StripeClientFactory` は開発者が個別鍵を持たない場合この鍵にフォールバックする）
- アプリ用の開発者 API キー（`fpb_test_...`）を発行して渡す。

### 0-2. 身分管理（このアプリ側）— Supabase は不要
公式実装指南 §0-3 の通り **ForgePay は Supabase トークンを一切読みません**。本アプリも
Supabase 認証は使わず、`purchase_intent_id`（端末で生成・保持する UUID）で購入を識別する。

- `purchase_intent_id` … 初回起動時に `crypto.randomUUID()` で生成し chrome.storage / localStorage に保持。
- 決済直後の確実な確認は ForgePay が success_url に付与する **`unlock_token`（1 回限り JWT）** で行う（指南 §6）。
- （任意）コールバック通知を使うなら、ForgePay 側で `callback_url` と `callback_secret` を登録する。

### 0-3. なぜこれだけ？
- 「誰が有料か」＝ ForgePay の entitlement（Stripe を ForgePay が一元管理）。
- 「どの購入か」＝ アプリ発行の `purchase_intent_id`（不透明 UUID）と決済時の `unlock_token`。
- アプリは **Stripe 鍵を持たず、ForgePay へは `fpb_` キーで認証するだけ**。

---

## 1. 全体構成

```
拡張 / Electron (クライアント)
        │  ① POST /api/create-checkout-session { userId, plan }
        ▼
こちらの Vercel サーバレス関数 (api/*.js)   ← ForgePay API キーはここだけが保持
        │  ② POST /api/v1/quickpay (X-API-Key)
        ▼
     ForgePay  ──③──>  Stripe Checkout
        ▲                    │ ④ 支払い
        │ ⑤ Stripe Webhook   ▼
        └──────────── ForgePay が受信・署名検証・冪等化
        │
        │ ⑥ POST /api/forgepay-callback（任意・監査用）
        ▼
こちらのサーバ（状態は持たない）

権限照会（真実の源）:
クライアント → /api/check-subscription → ForgePay GET /api/v1/entitlements/verify
```

### 責務分離
| 担当 | 内容 |
|---|---|
| ForgePay | Stripe 鍵管理 / Checkout 作成 / Webhook 署名検証・冪等化 / entitlement 管理 / 返金検知 |
| こちらのサーバ (api/*.js) | ForgePay への仲介（API キー秘匿）/ 重複課金ガード / 権限照会 |
| クライアント | プラン選択・checkout_url への遷移・状態表示。**Stripe にも ForgePay にも直接触れない** |

---

## 2. ファイル一覧

| ファイル | 役割 |
|---|---|
| `api/_forgepay.js` | ForgePay REST クライアント（createPayment / verifyEntitlement） |
| `api/create-checkout-session.js` | 決済セッション作成。subscription / onetime。**重複課金防止（既 active は 409）** |
| `api/check-subscription.js` | entitlement 照会 → `{ isActive, status, expiresAt, productId }` |
| `api/forgepay-callback.js` | ForgePay 通知受信（payment.completed / refund.completed）。冪等化・任意シークレット検証 |
| `subscription.js` / `subscription.html` | プラン選択 → バックエンド呼び出し → checkout_url へ遷移 |
| `success.js` | 決済後に entitlement を確認して保存 |
| `scripts/forgepay-provision.mjs` | 開発者登録・Stripe 鍵・商品・設定の一括セットアップ |
| `scripts/e2e-forgepay.mjs` | 実フローのライブ E2E |
| `tests/api/*.test.js` | Jest 統合テスト（ForgePay を fetch モック） |

※ 旧 `api/stripe-webhook.js` は削除（Stripe Webhook は ForgePay が受ける）。
※ `package.json` から `stripe` / `micro` 依存を削除。

---

## 3. セキュリティ設計

1. **API キー秘匿**: ForgePay の `fpb_*` キーはサーバ環境変数のみ。クライアント（拡張/Electron）には絶対に置かない。
2. **重複課金防止**: checkout 作成前に `verifyEntitlement` で既存 active を確認し、ある場合は 409 で新規作成を拒否。Stripe 側もセッション単位で二重課金を防ぐ。
3. **返金（回退）**: 返金は ForgePay/Stripe 側で実行 → ForgePay が entitlement を revoke。クライアントは次回 `verify` で失効を検知（＝アクセス停止）。`refund.completed` コールバックも受信。
4. **コールバック偽装耐性**: 「誰が有料か」の真実の源は ForgePay entitlement であり、コールバックではない。よって偽コールバックでは権限は付与されない。加えて `FORGEPAY_CALLBACK_SECRET` 設定時は `X-Forgepay-Secret` ヘッダーを検証。
5. **冪等性**: コールバックは `event_id` で重複排除。最終的な冪等性は ForgePay が担保。

---

## 4. ローカルで動かす（先に本地跑通）

> **重要な前提**: Stripe 鍵は **共通システム(ForgePay)側で設定**する。アプリ側は持たない。
> ForgePay は開発者が個別 Stripe 鍵を持たない場合、サーバの **グローバル Stripe 鍵**
> （ForgePay 側 `.env` の `STRIPE_TEST_SECRET_KEY` → `config.stripe.secretKey`）に
> フォールバックする（`src/services/StripeClientFactory.ts` の `getGlobalClient()`）。
> したがって ForgePay の `.env` に `STRIPE_TEST_SECRET_KEY` が設定済みなら、
> このアプリは `fpb_` API キーで認証するだけでよい。
> （未設定だと quickpay も商品作成も `internal_error` になる ＝ これは ForgePay 側の設定問題）

```bash
# 0) ForgePay を起動（別リポジトリ）。.env に STRIPE_TEST_SECRET_KEY を設定しておくこと
cd ../ForgePay && npm run docker:up && npm run migrate:up && npm run dev   # :3000
cd dashboard && npm run dev                                                # :3001

# 1) Stripe Webhook 転送（ForgePay 向け）
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe

# 2) こちらの開発者・商品をプロビジョニング（Stripe 鍵は渡さない＝グローバルを使用）
cd ../simultaneous_interpretation
FORGEPAY_API_URL=http://localhost:3000 \
FORGEPAY_DEV_EMAIL=you@example.com \
APP_PUBLIC_URL=https://your-app.example.com \
node scripts/forgepay-provision.mjs
#  → 出力された FORGEPAY_API_KEY / 商品 ID を .env に貼る
#  （個別の Stripe アカウントを使う場合のみ STRIPE_TEST_SECRET_KEY=sk_test_xxx を付ける）

# 3) 統合テスト（外部通信なし・モック）
npx jest tests/api

# 4) ライブ E2E（実際に Stripe テストカードで支払う）
node scripts/e2e-forgepay.mjs
```

> 注意: ForgePay は `success_url` / `cancel_url` に **https** を要求する（http://localhost は不可）。
> ローカルでも `APP_PUBLIC_URL` は https を指定するか、ForgePay ダッシュボード既定値を使う。
> クライアント（拡張/Electron）から叩くバックエンド URL は `config.js` の `api.baseUrl`。
> ローカルのサーバレス関数を試す場合は `vercel dev` 等で起動し baseUrl をそこに向ける。

---

## 5. 本番リリース時の URL 差し替え（注意: 本番要改）

| 場所 | ローカル | 本番 |
|---|---|---|
| `FORGEPAY_API_URL`（サーバ env） | `http://localhost:3000` | `https://<forgepay 本番>` |
| `FORGEPAY_API_KEY`（サーバ env） | `fpb_test_...` | `fpb_live_...` |
| `APP_PUBLIC_URL`（サーバ env） | https テスト URL | `https://<本アプリ本番>` |
| `config.js` の `api.baseUrl`（クライアント） | ローカル or Vercel | 本番 Vercel URL |
| ForgePay ダッシュボード「通知先 URL」 | `…/api/forgepay-callback` | 本番の同パス |
| ForgePay の Stripe モード | test | live（ForgePay 側 .env で切替） |

本番では ForgePay 開発者アカウントの Stripe を live 鍵に切り替え、商品も live で作り直す
（`scripts/forgepay-provision.mjs` を本番 URL・live 鍵で再実行）。

---

## 6. 環境変数（サーバ側のみ）

`.env.example` の「決済（ForgePay）」節を参照。要点:

- `FORGEPAY_API_URL` / `FORGEPAY_API_KEY` … 接続情報
- `FORGEPAY_SUBSCRIPTION_PRODUCT_ID` / `FORGEPAY_ONETIME_PRODUCT_ID` … 商品
- `FORGEPAY_ONETIME_AMOUNT` / `FORGEPAY_CURRENCY` … 商品未設定時のアドホック一回払い
- `APP_PUBLIC_URL` … success/cancel の遷移先
- `FORGEPAY_CALLBACK_SECRET` … コールバック検証（任意）
