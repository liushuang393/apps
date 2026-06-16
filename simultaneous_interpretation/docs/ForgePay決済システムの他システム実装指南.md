# 他システム実装指南

> ForgePay 決済システムに**外部システム（他システム）を連携させる開発者**向けの実装手順書。
> このページの curl / コードをそのまま写経すれば連携が完成します。推測不要・コピペ前提で書いています。
>
> - API ベース URL: `https://<forgepay-host>/api/v1`（`<forgepay-host>` は運営者から受け取る）
> - 認証ヘッダ: すべての API 呼び出しに `X-API-Key: <あなたのAPIキー>` を付与
> - 関連資料: `INTEGRATION_GUIDE.md`（詳細版） / `docs/PYTHON_QUICKSTART.md`（Python SDK） / オンライン Swagger `https://<forgepay-host>/docs/api`

---

## 0. ゴールと前提

**ゴール**: 自分のアプリから「決済リンクを発行 → ユーザーが支払う → 支払い済みかを確認して有料機能を解放」できる状態にする。

**前提（運営者が事前に用意するもの）**:

1. ForgePay の到達可能な URL（`<forgepay-host>`）。
2. 課金に使う Stripe シークレットキー。**運営者がグローバルキーを設定済み**か、**各開発者が自分のキーを登録**するかのどちらか（§2 参照）。
3. Supabase の匿名ログインは**不要**。ForgePay は Supabase トークンを一切読みません。

---

## 1. 認証モデル — 3 つの鍵（まずこれだけ理解する）

| 誰が身元を証明するか | 何を使うか | 誰が検証するか |
| --- | --- | --- |
| **あなたのシステム → ForgePay** | `X-API-Key`（リクエストヘッダ） | ForgePay |
| **「ユーザーが支払い済み」である証明** | `unlock_token`（JWT・短命・1回限り） | ForgePay |
| **ForgePay → あなた（コールバック通知）** | `X-ForgePay-Signature: sha256=...`（HMAC） | あなた（`callback_secret` で検証） |

- `X-API-Key` はサーバー側でハッシュ保存され、紛失時は再取得不可（§3 の再発行 API を使う）。
- `unlock_token` は HS256 JWT。`jti` を DB で原子的に消費するため**再利用するとエラー**（リプレイ防止）。
- コールバック署名は**任意機能だが、有効化する場合は必須**（署名なし送信は fail-closed で拒否されます）。

---

## 2. Stripe キーの方針（どちらか必須）

決済（checkout / quickpay）を動かすには Stripe シークレットキーが必要です。空のままだと checkout 作成時に `internal_error` になります。

- **方針 A: 運営者のグローバルキー**を使う → 開発者側の作業は不要。運営者が ForgePay の `.env` に `STRIPE_TEST_SECRET_KEY=sk_test_...` を設定して再起動。
- **方針 B: 開発者が自分の Stripe キーを登録**（マルチテナント）→ §4 を実施。キーは AES-256-GCM で暗号化保存されます。

> どちらを使うかは運営者に確認してください。本手順書は方針 B（自分のキー登録）も含めて記載します。

---

## 3. STEP 1 — 開発者登録して API キーを取得

```bash
curl -X POST https://<forgepay-host>/api/v1/onboarding/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","testMode":true}'
```

レスポンス（201）:

```json
{
  "message": "Registration successful",
  "developer": { "id": "...", "email": "dev@example.com", "testMode": true, "createdAt": "..." },
  "apiKey": { "key": "fpb_test_xxxxxxxxxxxx", "prefix": "fpb_test" },
  "warning": "Save your API key now. It will not be shown again."
}
```

- `apiKey.key` は**この 1 回しか表示されません**。必ず安全な場所に保存してください。
- 以降すべてのリクエストに `X-API-Key: fpb_test_xxxxxxxxxxxx` を付けます。
- 紛失時: `POST /api/v1/onboarding/forgot-key`（メール再送） / `POST /api/v1/onboarding/api-key/regenerate`（再生成）。
- キーを連続で間違えると (キー接頭辞 + IP) 単位でロックアウト（429）されます。総当たり禁止。

---

## 4. STEP 2 —（方針 B のみ）自分の Stripe キーを登録

```bash
curl -X POST https://<forgepay-host>/api/v1/onboarding/stripe/keys \
  -H "X-API-Key: fpb_test_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "stripe_secret_key": "sk_test_xxxxxxxx",
    "stripe_publishable_key": "pk_test_xxxxxxxx",
    "stripe_webhook_secret": "whsec_xxxxxxxx"
  }'
```

- 必須は `stripe_secret_key`（`sk_test_` / `sk_live_` で始まること）。他の 2 つは任意。
- 方針 A（運営者グローバルキー）の場合、この STEP は不要です。

---

## 5. STEP 3 — 決済リンクを発行する（QuickPay）

`POST /api/v1/quickpay` は 1 回の呼び出しで Stripe Checkout URL を返す簡易エンドポイントです。3 モードに対応:

- **A: 商品 ID 指定** … `product_id`（ダッシュボードで作成済みの商品）
- **B: Stripe Price 直指定** … `price_id`
- **C: アドホック**（商品登録不要）… `name` + `amount` + `currency`

```bash
curl -X POST https://<forgepay-host>/api/v1/quickpay \
  -H "X-API-Key: fpb_test_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "purchase_intent_id": "order-12345",
    "name": "Premium Plan",
    "amount": 980,
    "currency": "jpy",
    "customer_email": "user@example.com",
    "success_url": "https://your-app.example.com/success",
    "cancel_url":  "https://your-app.example.com/cancel"
  }'
```

- 必須は `purchase_intent_id`（あなた側で一意な注文/意図 ID。後で入金確認に使う）。
- `success_url` / `cancel_url` は省略するとダッシュボードのデフォルト設定が使われます（未設定だとエラー）。https のみ許可。

レスポンス（201）:

```json
{
  "session_id": "cs_test_...",
  "checkout_url": "https://checkout.stripe.com/pay/cs_test_...",
  "expires_at": "2026-06-16T01:30:00Z"
}
```

`checkout_url` にユーザーをリダイレクト → Stripe が決済 → ForgePay が Stripe Webhook を受信 → `unlock_token` を自動発行。

> 厳密な商品フローが必要なら `POST /api/v1/checkout/sessions`（`product_id`+`price_id`+`success_url`+`cancel_url` 必須）も使えます。

---

## 6. STEP 4 — 入金確認＝権限検証（有料機能を解放する前に必ず実行）

支払い済みかどうかは `GET /api/v1/entitlements/verify` で確認します。2 通りのキーで照会できます。

**パターン A: `unlock_token` で照会**（ChatGPT App / 決済直後のリダイレクトで token を受け取る場合）

```bash
curl "https://<forgepay-host>/api/v1/entitlements/verify?unlock_token=<JWT>" \
  -H "X-API-Key: fpb_test_xxxxxxxxxxxx"
```

**パターン B: `purchase_intent_id` で照会**（自社 SaaS の Pro 機能ゲート。URL の token に依存しない）

```bash
curl "https://<forgepay-host>/api/v1/entitlements/verify?purchase_intent_id=order-12345" \
  -H "X-API-Key: fpb_test_xxxxxxxxxxxx"
```

レスポンス（200）:

```json
{
  "status": "active",
  "has_access": true,
  "entitlement_id": "...",
  "product_id": "...",
  "expires_at": "2027-06-16T00:00:00Z"
}
```

- `has_access === true` かつ `status === "active"` のときだけ有料機能を解放してください。
- `unlock_token` が無効・期限切れ・使用済みなら **401**（`{ "error": { "code": "invalid_token", ... } }`）。
- `unlock_token` は**1 回限り**。同じ token で 2 回検証すると 2 回目は失敗します。

---

## 7. STEP 5 —（任意）コールバック通知を受け取り、署名を検証する

ForgePay は決済イベント発生時に、登録された `callback_url` へ JSON を POST できます。利用するには運営者側で **`callback_url` と `callback_secret` の両方を登録**しておく必要があります（`callback_secret` 未設定だと送信は fail-closed で拒否）。

ForgePay が付与するヘッダ:

| ヘッダ | 内容 |
| --- | --- |
| `X-ForgePay-Event` | イベント種別（例 `payment.completed`） |
| `X-ForgePay-Timestamp` | 送信時刻（ISO 8601 文字列） |
| `X-ForgePay-Signature` | `sha256=<HMAC-SHA256 の16進>` |

ペイロード例:

```json
{
  "event_id": "evt_abc123",
  "event_type": "payment.completed",
  "timestamp": "2026-06-16T00:15:00Z",
  "product": { "id": "...", "name": "Premium Plan", "type": "one_time" },
  "customer": { "email": "user@example.com" },
  "amount": { "value": 980, "currency": "jpy", "formatted": "¥980" },
  "metadata": { "purchase_intent_id": "order-12345", "session_id": "cs_test_..." }
}
```

**署名の検証方法（必ず実装する）**:

1. 受信した生のボディ文字列 `body` と `X-ForgePay-Timestamp` の値 `timestamp` を取得。
2. 署名対象文字列 = `` `${timestamp}.${body}` ``。
3. それを `callback_secret` で HMAC-SHA256 → 16 進文字列にする。
4. `sha256=<その値>` が `X-ForgePay-Signature` と一致すれば本物。
5. リプレイ防止: `timestamp` の鮮度（±5 分以内）と `event_id`（nonce として重複排除）も確認する。

Node.js での検証例:

```js
import crypto from 'node:crypto';

function verify(rawBody, headers, callbackSecret) {
  const ts = headers['x-forgepay-timestamp'];
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', callbackSecret).update(`${ts}.${rawBody}`).digest('hex');
  const got = headers['x-forgepay-signature'] ?? '';
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}
```

実装のポイント: 正常受信したら常に `200` を返す（再送抑止）／同じ `event_id` の二重処理を弾く。

---

## 8. 言語別の最短実装

### 8A. 任意言語（REST 直叩き）— Node/TypeScript 参照実装

そのまま使えるサンプルが同梱されています:
`apps/common_services/forge_pay/examples/chatgpt-app-integration.ts`

```ts
// 1) 決済セッション作成
const res = await fetch(`${API}/quickpay`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
  body: JSON.stringify({ purchase_intent_id: 'order-12345', name: 'Premium', amount: 980, currency: 'jpy',
                         success_url: SUCCESS_URL, cancel_url: CANCEL_URL }),
});
const { checkout_url } = await res.json(); // → ユーザーをここへリダイレクト

// 2) 入金確認
const v = await fetch(`${API}/entitlements/verify?unlock_token=${encodeURIComponent(token)}`,
  { headers: { 'X-API-Key': API_KEY } });
const ent = await v.json();
if (ent.has_access && ent.status === 'active') { /* 有料機能を解放 */ }
```

### 8B. Python アプリ（SDK 利用が最短）

```bash
conda run -n agentflow pip install -e infrastructure/payment_client
```

`.env`（最小設定）:

```env
FORGE_PAY_API_URL=https://<forgepay-host>
FORGE_PAY_API_KEY=fpb_test_xxxxxxxxxxxx
FORGE_PAY_CALLBACK_SECRET=<コールバックを使う場合のみ>
```

Pro 機能ゲート（数行で完成）:

```python
from fastapi import FastAPI, Depends
from infrastructure.payment_client import require_entitlement

app = FastAPI()
pro_gate = require_entitlement(token_header="x-unlock-token", fallback_on_error="deny")

@app.post("/api/feature/pro")
async def pro_feature(_: None = Depends(pro_gate)) -> dict:
    return {"ok": True}
```

権限検証を明示的に呼ぶ場合 / コールバック受信:

```python
from infrastructure.payment_client import build_payment_client, verify_forge_pay_webhook
from infrastructure.payment_client.webhooks import CallbackVerificationError

client = build_payment_client()
result = await client.verify_entitlement(purchase_intent_id="order-12345")
if result.has_access and result.status == "active":
    ...  # Pro 解放

@app.post("/api/billing/forge-pay/callback")
async def callback(request) -> dict:
    try:
        cb = await verify_forge_pay_webhook(request, callback_secret=SECRET)
    except CallbackVerificationError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return {"ok": True}
```

> 既存の連携実装（参考）: `apps/governance_risk_platform/modules/decision_governance/`, `apps/sales_support_platform/modules/faq_knowledge_chat/`。

---

## 9. テスト（Stripe テストカード）

`testMode: true` で登録し、Checkout 画面で以下のカードを使います。

| カード番号 | 結果 |
| --- | --- |
| `4242 4242 4242 4242` | 決済成功 |
| `4000 0000 0000 0002` | カード拒否 |
| `4000 0025 0000 3155` | 3D Secure 要求 |

有効期限: 未来の任意の日付 / CVC: 任意の 3 桁。

---

## 10. 本番移行チェックリスト

- [ ] `testMode` を `false` に切替（`POST /api/v1/onboarding/mode` `{"testMode":false}`）。
- [ ] API キーを `fpb_live_...` に差し替え（再登録または mode 切替後の再発行）。
- [ ] Stripe を live キーに切替（方針 A: 運営者の `.env` / 方針 B: `sk_live_...` を再登録）。
- [ ] `success_url` / `cancel_url` / `callback_url` を本番ドメイン（https）に更新。
- [ ] コールバックを使う場合、署名検証が本番 `callback_secret` で通ることを確認。

---

## 11. よくあるエラーと対処

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| checkout 作成で `internal_error` | Stripe シークレットキー未設定 | §2 の方針 A か B でキーを用意 |
| 401 `Missing API key` | `X-API-Key` ヘッダ無し | 全リクエストにヘッダを付与 |
| 401 `invalid_token` | `unlock_token` が無効/期限切れ/使用済み | 再決済させるか `purchase_intent_id` で照会 |
| 429 `too_many_attempts` | API キー誤りの連続試行 | しばらく待つ。正しいキーを使う |
| コールバックが届かない | `callback_url` か `callback_secret` 未登録 | 運営者に両方の登録を依頼 |

---

## 付録: エンドポイント早見表（ベース `https://<forgepay-host>/api/v1`）

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| POST | `/onboarding/register` | 不要 | 開発者登録・API キー発行 |
| POST | `/onboarding/stripe/keys` | API Key | 自分の Stripe キー登録（方針 B） |
| POST | `/onboarding/mode` | API Key | test / live 切替 |
| POST | `/quickpay` | API Key | 簡易決済リンク生成 |
| POST | `/checkout/sessions` | API Key | 商品ベースの Checkout 作成 |
| GET | `/entitlements/verify` | API Key（任意） | 入金/権限の検証 |
| POST | `/webhooks/stripe` | 署名検証 | Stripe → ForgePay（自動） |
| （受信側） | あなたの `callback_url` | HMAC 署名 | ForgePay → あなたへの通知 |
