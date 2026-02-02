# Stripe Webhook 契約仕様

**日付**: 2025-11-11 | **フィーチャー**: [spec.md](../spec.md) | **関連**: FR-022

このドキュメントはStripe Webhookイベントの処理仕様を定義します。

---

## 概要

Stripe Webhookエンドポイント: `POST /api/v1/webhooks/stripe`

### セキュリティ

**必須**: Stripe署名検証を実装すること

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Webhook署名検証
const signature = request.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  request.body,
  signature,
  endpointSecret
);
```

### 冪等性

- **Webhook Event ID**: `event.id` を使用してイベントの重複処理を防ぐ
- **データベース記録**: `payment_transactions.webhook_event_id` に記録
- **処理済みチェック**: イベント処理前に既存の `webhook_event_id` を検索

---

## 対応イベント

### 1. payment_intent.succeeded

#### 説明
決済が成功した際に送信されるイベント。クレジットカード決済の即時成功、またはコンビニ決済の支払い完了時。

#### タイミング
- **カード決済**: PaymentIntent作成から数秒以内
- **コンビニ決済**: ユーザーがコンビニで支払いを完了した時点（数分〜4日後）

#### ペイロード例

```json
{
  "id": "evt_1ABC2DefGHi3JKLm",
  "object": "event",
  "api_version": "2023-10-16",
  "created": 1699564800,
  "data": {
    "object": {
      "id": "pi_1ABC2DefGHi3JKLm",
      "object": "payment_intent",
      "amount": 2000,
      "amount_received": 2000,
      "currency": "jpy",
      "status": "succeeded",
      "payment_method": "pm_1ABC2DefGHi3JKLm",
      "payment_method_types": ["card"],
      "metadata": {
        "user_id": "uuid-user-id",
        "campaign_id": "uuid-campaign-id",
        "position_id": "uuid-position-id",
        "purchase_id": "uuid-purchase-id"
      },
      "charges": {
        "data": [
          {
            "id": "ch_1ABC2DefGHi3JKLm",
            "amount": 2000,
            "receipt_url": "https://pay.stripe.com/receipts/..."
          }
        ]
      }
    }
  },
  "type": "payment_intent.succeeded"
}
```

#### コンビニ決済の場合の追加フィールド

```json
{
  "data": {
    "object": {
      "payment_method_types": ["konbini"],
      "payment_method_options": {
        "konbini": {
          "confirmation_number": "123-456-789",
          "store": "familymart",
          "expires_at": 1699996800
        }
      }
    }
  }
}
```

#### 処理ロジック

```typescript
async function handlePaymentIntentSucceeded(event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  // 1. 冪等性チェック
  const existingTransaction = await db.query(
    'SELECT transaction_id FROM payment_transactions WHERE webhook_event_id = $1',
    [event.id]
  );
  if (existingTransaction.rows.length > 0) {
    console.log(`Event ${event.id} already processed`);
    return;
  }

  // 2. PaymentIntentの再取得（Webhook信頼性のため）
  const confirmedPaymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntent.id
  );
  if (confirmedPaymentIntent.status !== 'succeeded') {
    throw new Error('PaymentIntent status mismatch');
  }

  // 3. トランザクション開始
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 4. PaymentTransactionの更新
    await client.query(`
      UPDATE payment_transactions
      SET
        status = 'succeeded',
        webhook_received_at = NOW(),
        webhook_event_id = $1,
        succeeded_at = NOW(),
        stripe_charge_id = $2
      WHERE stripe_payment_intent_id = $3
    `, [event.id, paymentIntent.charges.data[0].id, paymentIntent.id]);

    // 5. Purchaseのステータス更新
    const purchaseId = paymentIntent.metadata.purchase_id;
    await client.query(`
      UPDATE purchases
      SET
        status = 'completed',
        completed_at = NOW()
      WHERE purchase_id = $1
    `, [purchaseId]);

    // 6. Positionのステータス更新
    const positionId = paymentIntent.metadata.position_id;
    await client.query(`
      UPDATE positions
      SET
        status = 'sold',
        sold_at = NOW()
      WHERE position_id = $1
    `, [positionId]);

    // 7. Userの統計更新（トリガーで自動実行）

    // 8. Campaignの売上更新
    const campaignId = paymentIntent.metadata.campaign_id;
    await client.query(`
      UPDATE campaigns
      SET
        total_revenue = total_revenue + $1
      WHERE campaign_id = $2
    `, [paymentIntent.amount, campaignId]);

    // 9. 完売チェック
    const campaignResult = await client.query(`
      SELECT positions_sold, positions_total
      FROM campaigns
      WHERE campaign_id = $1
    `, [campaignId]);

    const campaign = campaignResult.rows[0];
    if (campaign.positions_sold >= campaign.positions_total) {
      // 完売 → 抽選トリガー
      await client.query(`
        UPDATE campaigns
        SET status = 'sold_out', sold_out_at = NOW()
        WHERE campaign_id = $1
      `, [campaignId]);

      // 抽選実行は非同期で別プロセスに委譲
      await triggerLotteryDraw(campaignId);
    }

    await client.query('COMMIT');

    // 10. プッシュ通知送信（非同期）
    await sendNotification({
      userId: paymentIntent.metadata.user_id,
      type: 'purchase_confirmed',
      title: '購入が完了しました',
      body: 'ポジションの購入が確定しました。',
      data: {
        purchaseId: purchaseId,
        campaignId: campaignId,
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

#### 期待される結果

- `payment_transactions.status` → `'succeeded'`
- `purchases.status` → `'completed'`
- `positions.status` → `'sold'`
- `campaigns.total_revenue` 増加
- ユーザーへプッシュ通知送信

---

### 2. payment_intent.payment_failed

#### 説明
決済が失敗した際に送信されるイベント。カード残高不足、カード拒否、コンビニ決済期限切れなど。

#### タイミング
- **カード決済**: PaymentIntent作成時に即座（数秒以内）
- **コンビニ決済**: 支払期限切れ時（4日後）

#### ペイロード例

```json
{
  "id": "evt_2XYZ3AbcDEf4GHIj",
  "object": "event",
  "created": 1699564900,
  "data": {
    "object": {
      "id": "pi_2XYZ3AbcDEf4GHIj",
      "object": "payment_intent",
      "amount": 2000,
      "currency": "jpy",
      "status": "requires_payment_method",
      "last_payment_error": {
        "code": "card_declined",
        "message": "Your card was declined.",
        "type": "card_error"
      },
      "metadata": {
        "user_id": "uuid-user-id",
        "campaign_id": "uuid-campaign-id",
        "position_id": "uuid-position-id",
        "purchase_id": "uuid-purchase-id"
      }
    }
  },
  "type": "payment_intent.payment_failed"
}
```

#### エラーコード例

| コード | 説明 | ユーザーメッセージ |
|-------|-----|-----------------|
| `card_declined` | カード拒否 | カードが拒否されました。別のカードをお試しください。 |
| `insufficient_funds` | 残高不足 | カード残高が不足しています。 |
| `expired_card` | カード期限切れ | カードの有効期限が切れています。 |
| `incorrect_cvc` | CVC不正 | セキュリティコードが正しくありません。 |
| `processing_error` | 処理エラー | 決済処理中にエラーが発生しました。再試行してください。 |
| `konbini_timeout` | コンビニ期限切れ | コンビニ決済の支払期限が切れました。 |

#### 処理ロジック

```typescript
async function handlePaymentIntentFailed(event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  // 1. 冪等性チェック
  const existingEvent = await db.query(
    'SELECT transaction_id FROM payment_transactions WHERE webhook_event_id = $1',
    [event.id]
  );
  if (existingEvent.rows.length > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. PaymentTransactionの更新
    await client.query(`
      UPDATE payment_transactions
      SET
        status = 'failed',
        webhook_received_at = NOW(),
        webhook_event_id = $1,
        failed_at = NOW(),
        failure_code = $2,
        failure_message = $3
      WHERE stripe_payment_intent_id = $4
    `, [
      event.id,
      paymentIntent.last_payment_error?.code,
      paymentIntent.last_payment_error?.message,
      paymentIntent.id
    ]);

    // 3. Purchaseのステータス更新
    const purchaseId = paymentIntent.metadata.purchase_id;
    await client.query(`
      UPDATE purchases
      SET status = 'failed'
      WHERE purchase_id = $1
    `, [purchaseId]);

    // 4. Positionの解放
    const positionId = paymentIntent.metadata.position_id;
    await client.query(`
      UPDATE positions
      SET
        status = 'available',
        user_id = NULL,
        reserved_at = NULL
      WHERE position_id = $1
    `, [positionId]);

    // 5. Layer統計の更新
    await client.query(`
      UPDATE layers
      SET positions_sold = positions_sold - 1
      WHERE layer_id = (
        SELECT layer_id FROM positions WHERE position_id = $1
      )
    `, [positionId]);

    // 6. Campaign統計の更新
    const campaignId = paymentIntent.metadata.campaign_id;
    await client.query(`
      UPDATE campaigns
      SET positions_sold = positions_sold - 1
      WHERE campaign_id = $1
    `, [campaignId]);

    await client.query('COMMIT');

    // 7. ユーザーへ通知（非同期）
    await sendNotification({
      userId: paymentIntent.metadata.user_id,
      type: 'payment_failed',
      title: '決済に失敗しました',
      body: getFailureMessage(paymentIntent.last_payment_error?.code),
      data: {
        purchaseId: purchaseId,
        errorCode: paymentIntent.last_payment_error?.code,
      },
    });

    // 8. エラーログ記録（監視用）
    logger.error('Payment failed', {
      paymentIntentId: paymentIntent.id,
      errorCode: paymentIntent.last_payment_error?.code,
      userId: paymentIntent.metadata.user_id,
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function getFailureMessage(errorCode: string | undefined): string {
  const messages: Record<string, string> = {
    card_declined: 'カードが拒否されました。別のカードをお試しください。',
    insufficient_funds: 'カード残高が不足しています。',
    expired_card: 'カードの有効期限が切れています。',
    incorrect_cvc: 'セキュリティコードが正しくありません。',
    konbini_timeout: 'コンビニ決済の支払期限が切れました。',
  };
  return messages[errorCode || ''] || '決済処理中にエラーが発生しました。';
}
```

#### 期待される結果

- `payment_transactions.status` → `'failed'`
- `purchases.status` → `'failed'`
- `positions.status` → `'available'` （解放）
- `campaigns.positions_sold` 減少
- ユーザーへエラー通知送信

---

### 3. payment_intent.canceled

#### 説明
PaymentIntentがキャンセルされた際に送信されるイベント。ユーザーまたは管理者によるキャンセル。

#### タイミング
- ユーザーが購入をキャンセル
- 管理者がキャンペーンをキャンセル
- システムがタイムアウトでキャンセル（予約期限切れ）

#### ペイロード例

```json
{
  "id": "evt_3PQR4StuvWX5YZab",
  "object": "event",
  "created": 1699565000,
  "data": {
    "object": {
      "id": "pi_3PQR4StuvWX5YZab",
      "object": "payment_intent",
      "amount": 2000,
      "currency": "jpy",
      "status": "canceled",
      "cancellation_reason": "requested_by_customer",
      "metadata": {
        "user_id": "uuid-user-id",
        "campaign_id": "uuid-campaign-id",
        "position_id": "uuid-position-id",
        "purchase_id": "uuid-purchase-id"
      }
    }
  },
  "type": "payment_intent.canceled"
}
```

#### キャンセル理由

| 理由 | 説明 |
|-----|-----|
| `requested_by_customer` | ユーザーリクエスト |
| `abandoned` | 放置（タイムアウト） |
| `duplicate` | 重複 |
| `fraudulent` | 不正検知 |

#### 処理ロジック

```typescript
async function handlePaymentIntentCanceled(event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  // 冪等性チェック
  const existingEvent = await db.query(
    'SELECT transaction_id FROM payment_transactions WHERE webhook_event_id = $1',
    [event.id]
  );
  if (existingEvent.rows.length > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. PaymentTransactionの更新
    await client.query(`
      UPDATE payment_transactions
      SET
        status = 'canceled',
        webhook_received_at = NOW(),
        webhook_event_id = $1
      WHERE stripe_payment_intent_id = $2
    `, [event.id, paymentIntent.id]);

    // 2. Purchaseのステータス更新
    const purchaseId = paymentIntent.metadata.purchase_id;
    await client.query(`
      UPDATE purchases
      SET
        status = 'cancelled',
        cancelled_at = NOW()
      WHERE purchase_id = $1
    `, [purchaseId]);

    // 3. Positionの解放
    const positionId = paymentIntent.metadata.position_id;
    await client.query(`
      UPDATE positions
      SET
        status = 'available',
        user_id = NULL,
        reserved_at = NULL
      WHERE position_id = $1
    `, [positionId]);

    // 4. Campaign統計の更新
    await client.query(`
      UPDATE campaigns
      SET positions_sold = positions_sold - 1
      WHERE campaign_id = $1
    `, [paymentIntent.metadata.campaign_id]);

    await client.query('COMMIT');

    // 5. ユーザーへ通知（必要な場合）
    if (paymentIntent.cancellation_reason === 'abandoned') {
      await sendNotification({
        userId: paymentIntent.metadata.user_id,
        type: 'payment_cancelled',
        title: '購入がキャンセルされました',
        body: '予約期限が切れたため、購入がキャンセルされました。',
        data: { purchaseId },
      });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

---

## エラーハンドリング

### Webhook処理失敗時の対応

```typescript
app.post('/api/v1/webhooks/stripe', async (req, res) => {
  let event: Stripe.Event;

  // 1. 署名検証
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Webhook signature verification failed', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2. イベント処理
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event);
        break;
      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(event);
        break;
      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    // 3. 即座に200を返す（重要: タイムアウト防止）
    res.status(200).json({ received: true });

  } catch (err) {
    logger.error('Webhook processing failed', {
      eventId: event.id,
      eventType: event.type,
      error: err,
    });

    // 4. エラーでも200を返す（Stripeの再送を避けるため、冪等性でカバー）
    res.status(200).json({ received: true, error: err.message });

    // 5. エラーキューに追加（後で再処理）
    await addToErrorQueue({
      eventId: event.id,
      eventType: event.type,
      payload: event,
      error: err.message,
    });
  }
});
```

### 再試行戦略

Stripeは以下のスケジュールでWebhookを再送します:

1. 即座
2. 5分後
3. 30分後
4. 2時間後
5. 5時間後
6. 10時間後
7. 10時間後（最大3日間）

**対策**:
- 冪等性キー（`webhook_event_id`）で重複を防ぐ
- 200ステータスを即座に返す（200ms以内）
- 重い処理はバックグラウンドジョブに委譲

---

## テスト戦略

### ローカルテスト（Stripe CLI使用）

```bash
# Stripe CLIのインストール
brew install stripe/stripe-cli/stripe

# Webhookリスニング開始
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe

# イベントトリガー
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
stripe trigger payment_intent.canceled
```

### 契約テスト

```typescript
// tests/contract/stripe-webhook.test.ts
import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import stripe from 'stripe';

describe('Stripe Webhook Contract Tests', () => {
  it('should handle payment_intent.succeeded', async () => {
    const payload = {
      id: 'evt_test_123',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_123',
          amount: 2000,
          status: 'succeeded',
          metadata: {
            purchase_id: 'test-purchase-id',
          },
        },
      },
    };

    const signature = stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(payload),
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });

    const response = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', signature)
      .send(payload);

    expect(response.status).toBe(200);
  });
});
```

---

## 監視とアラート

### 重要なメトリクス

1. **Webhook受信率**: 99.9%以上を維持
2. **処理レイテンシ**: p95 < 200ms
3. **エラー率**: < 0.1%
4. **冪等性違反**: 0件（重複イベントの正常処理）

### アラート条件

- Webhook処理失敗率 > 1%（5分間）
- Webhook処理レイテンシ p95 > 500ms（5分間）
- 署名検証失敗 > 10件/分（不正アクセスの可能性）

---

## 次のステップ

Phase 1の残りの成果物:

1. **Firebase通知契約**: プッシュ通知ペイロード仕様（`firebase-events.md`）
2. **クイックスタート**: ローカル開発環境セットアップ手順（`quickstart.md`）

---

**作成者**: Claude Code | **レビュー**: Phase 1完了後に技術リードが確認
