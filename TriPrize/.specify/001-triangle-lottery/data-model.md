# データモデル: 三角形抽選販売アプリケーション

**日付**: 2025-11-11 | **フィーチャー**: [spec.md](./spec.md)

このドキュメントはPhase 1（設計）の成果物で、システムの全データエンティティのスキーマ定義を記載します。

---

## 概要

三角形抽選販売システムは8つの主要エンティティで構成されています:

1. **Campaign（キャンペーン）**: 抽選イベント全体を管理
2. **Layer（レイヤー）**: 三角形の各層の情報
3. **Position（ポジション）**: 購入可能な個別マス目
4. **Prize（賞品）**: キャンペーンの賞品情報
5. **Purchase（購入）**: ユーザーのポジション購入記録
6. **PaymentTransaction（決済トランザクション）**: Stripe決済の詳細記録
7. **User（ユーザー）**: Firebase Authユーザーの補足情報
8. **Notification（通知）**: プッシュ通知の送信履歴

---

## 1. Campaign（キャンペーン）

### 説明
抽選イベント全体を管理するマスターエンティティ。管理者が作成し、ユーザーがポジションを購入する対象。

### スキーマ

```sql
CREATE TABLE campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 基本情報
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url VARCHAR(500) NOT NULL,

  -- 三角形構造
  base_length INTEGER NOT NULL CHECK (base_length BETWEEN 3 AND 50),
  positions_total INTEGER NOT NULL,
  positions_sold INTEGER NOT NULL DEFAULT 0,

  -- 料金設定
  layer_prices JSONB NOT NULL,  -- {1: 1000, 2: 1500, 3: 2000, ...}
  total_revenue INTEGER NOT NULL DEFAULT 0,
  profit_margin_percent DECIMAL(5,2) NOT NULL,

  -- 購入制限
  purchase_limit INTEGER CHECK (purchase_limit > 0),  -- NULL = 制限なし

  -- ステータス管理
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'published', 'active', 'sold_out', 'drawn', 'completed', 'cancelled')
  ),

  -- 日時
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP,
  sold_out_at TIMESTAMP,
  drawn_at TIMESTAMP,

  -- 管理者情報
  created_by UUID NOT NULL REFERENCES users(user_id),

  -- 制約
  CONSTRAINT positions_sold_not_exceed_total CHECK (positions_sold <= positions_total),
  CONSTRAINT start_before_end CHECK (start_date < end_date),
  CONSTRAINT profit_margin_valid CHECK (profit_margin_percent >= 0 AND profit_margin_percent <= 100)
);

-- インデックス
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_dates ON campaigns(start_date, end_date);
CREATE INDEX idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX idx_campaigns_sold_out ON campaigns(sold_out_at) WHERE sold_out_at IS NOT NULL;
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| campaign_id | UUID | ✓ | 主キー |
| name | VARCHAR(255) | ✓ | キャンペーン名 |
| description | TEXT | ✓ | キャンペーン説明 |
| image_url | VARCHAR(500) | ✓ | メイン画像URL (S3) |
| base_length | INTEGER | ✓ | 三角形の底辺マス数 (3-50) |
| positions_total | INTEGER | ✓ | 総ポジション数 (計算値) |
| positions_sold | INTEGER | ✓ | 販売済みポジション数 |
| layer_prices | JSONB | ✓ | 層ごとの価格設定 |
| total_revenue | INTEGER | ✓ | 現在の総売上（円） |
| profit_margin_percent | DECIMAL(5,2) | ✓ | 利益率 (%) |
| purchase_limit | INTEGER | | ユーザーあたり購入上限 (NULL=無制限) |
| status | VARCHAR(20) | ✓ | ステータス |
| start_date | TIMESTAMP | ✓ | 販売開始日時 |
| end_date | TIMESTAMP | ✓ | 販売終了日時 |
| created_at | TIMESTAMP | ✓ | 作成日時 |
| updated_at | TIMESTAMP | ✓ | 更新日時 |
| published_at | TIMESTAMP | | 公開日時 |
| sold_out_at | TIMESTAMP | | 完売日時 |
| drawn_at | TIMESTAMP | | 抽選実行日時 |
| created_by | UUID | ✓ | 作成者ユーザーID |

### ステータス遷移

```
draft (下書き)
  → published (公開済み)
  → active (販売中)
  → sold_out (完売)
  → drawn (抽選済み)
  → completed (完了)

cancelled (キャンセル) は任意のステータスから遷移可能
```

### バリデーションルール

- **FR-003**: base_length は 3 以上 50 以下
- **FR-004**: layer_prices は全レイヤーの価格を含む完全なJSONB
- **FR-009**: profit_margin_percent < 15% の場合、作成時に警告
- **FR-001**: 作成時は status = 'draft'

### 更新トリガー

```sql
CREATE OR REPLACE FUNCTION update_campaign_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaign_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW
EXECUTE FUNCTION update_campaign_timestamp();
```

---

## 2. Layer（レイヤー）

### 説明
三角形の各層の情報。各キャンペーンは base_length 個のレイヤーを持つ。

### スキーマ

```sql
CREATE TABLE layers (
  layer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,

  -- レイヤー情報
  layer_number INTEGER NOT NULL CHECK (layer_number > 0),
  positions_count INTEGER NOT NULL CHECK (positions_count > 0),
  price INTEGER NOT NULL CHECK (price >= 100),

  -- 統計
  positions_sold INTEGER NOT NULL DEFAULT 0,
  positions_available INTEGER NOT NULL,

  -- 制約
  CONSTRAINT positions_sold_not_exceed_count CHECK (positions_sold <= positions_count),
  CONSTRAINT positions_available_consistent CHECK (positions_available = positions_count - positions_sold),
  UNIQUE(campaign_id, layer_number)
);

-- インデックス
CREATE INDEX idx_layers_campaign ON layers(campaign_id);
CREATE INDEX idx_layers_available ON layers(campaign_id, positions_available) WHERE positions_available > 0;
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| layer_id | UUID | ✓ | 主キー |
| campaign_id | UUID | ✓ | 親キャンペーン |
| layer_number | INTEGER | ✓ | レイヤー番号 (1が底辺、頂点に向かって増加) |
| positions_count | INTEGER | ✓ | このレイヤーのポジション数 |
| price | INTEGER | ✓ | このレイヤーの価格（円） |
| positions_sold | INTEGER | ✓ | 販売済みポジション数 |
| positions_available | INTEGER | ✓ | 利用可能ポジション数 |

### 生成ルール

- **FR-006**: layer_number = 1（底辺）の positions_count = base_length
- **FR-006**: 上層に向かって positions_count が1ずつ減少
- **FR-005**: price は layer_prices から取得

### 更新トリガー

```sql
CREATE OR REPLACE FUNCTION update_layer_availability()
RETURNS TRIGGER AS $$
BEGIN
  NEW.positions_available = NEW.positions_count - NEW.positions_sold;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_layer_availability
BEFORE INSERT OR UPDATE ON layers
FOR EACH ROW
EXECUTE FUNCTION update_layer_availability();
```

---

## 3. Position（ポジション）

### 説明
購入可能な個別のマス目。三角形の各セルに対応。

### スキーマ

```sql
CREATE TABLE positions (
  position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  layer_id UUID NOT NULL REFERENCES layers(layer_id) ON DELETE CASCADE,

  -- 座標情報
  layer_number INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  col_number INTEGER NOT NULL,

  -- 価格
  price INTEGER NOT NULL CHECK (price >= 100),

  -- ステータス管理
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (
    status IN ('available', 'reserved', 'sold', 'expired')
  ),

  -- 所有者情報
  user_id UUID REFERENCES users(user_id),
  reserved_at TIMESTAMP,
  sold_at TIMESTAMP,

  -- ユニーク制約
  UNIQUE(campaign_id, row_number, col_number),

  -- 整合性チェック
  CONSTRAINT position_user_consistency CHECK (
    (status = 'available' AND user_id IS NULL) OR
    (status IN ('reserved', 'sold') AND user_id IS NOT NULL)
  ),
  CONSTRAINT sold_timestamp_consistency CHECK (
    (status = 'sold' AND sold_at IS NOT NULL) OR
    (status != 'sold' AND sold_at IS NULL)
  )
);

-- インデックス
CREATE INDEX idx_positions_campaign_layer ON positions(campaign_id, layer_number);
CREATE INDEX idx_positions_allocation ON positions(campaign_id, layer_number, status)
  WHERE status = 'available';
CREATE INDEX idx_positions_user ON positions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_positions_reserved ON positions(reserved_at) WHERE status = 'reserved';
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| position_id | UUID | ✓ | 主キー |
| campaign_id | UUID | ✓ | 親キャンペーン |
| layer_id | UUID | ✓ | 親レイヤー |
| layer_number | INTEGER | ✓ | レイヤー番号 |
| row_number | INTEGER | ✓ | 行座標 (0始まり) |
| col_number | INTEGER | ✓ | 列座標 (0始まり) |
| price | INTEGER | ✓ | 価格（円） |
| status | VARCHAR(20) | ✓ | ステータス |
| user_id | UUID | | 所有者（reserved/sold時） |
| reserved_at | TIMESTAMP | | 予約日時 |
| sold_at | TIMESTAMP | | 販売確定日時 |

### ステータス遷移

```
available (利用可能)
  → reserved (予約中) [決済処理中]
  → sold (販売済み) [決済成功]

reserved → available (タイムアウト/決済失敗時)
reserved → expired (予約期限切れ)
```

### 座標計算ルール

```typescript
// 三角形の座標生成ロジック
function generatePositions(baseLength: number): Position[] {
  const positions: Position[] = [];

  for (let layer = 1; layer <= baseLength; layer++) {
    const positionsInLayer = baseLength - layer + 1;

    for (let col = 0; col < positionsInLayer; col++) {
      positions.push({
        layer_number: layer,
        row_number: layer - 1,
        col_number: col,
      });
    }
  }

  return positions;
}
```

### 重要なクエリパターン

#### ポジション割り当て（並行購入対応）

```sql
-- FOR UPDATE SKIP LOCKED で並行性を最適化
SELECT position_id, layer_number, row_number, col_number, price
FROM positions
WHERE campaign_id = $1
  AND layer_number = $2
  AND status = 'available'
ORDER BY RANDOM()
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

---

## 4. Prize（賞品）

### 説明
キャンペーンの賞品情報。各キャンペーンに複数の賞品を設定可能。

### スキーマ

```sql
CREATE TABLE prizes (
  prize_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,

  -- 賞品情報
  rank INTEGER NOT NULL CHECK (rank > 0),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url VARCHAR(500),
  value INTEGER NOT NULL CHECK (value >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- 当選ポジション
  winning_layer_number INTEGER CHECK (winning_layer_number > 0),
  winning_position_id UUID REFERENCES positions(position_id),
  winner_user_id UUID REFERENCES users(user_id),

  -- ステータス
  awarded BOOLEAN NOT NULL DEFAULT FALSE,
  awarded_at TIMESTAMP,

  UNIQUE(campaign_id, rank)
);

-- インデックス
CREATE INDEX idx_prizes_campaign ON prizes(campaign_id);
CREATE INDEX idx_prizes_winner ON prizes(winner_user_id) WHERE winner_user_id IS NOT NULL;
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| prize_id | UUID | ✓ | 主キー |
| campaign_id | UUID | ✓ | 親キャンペーン |
| rank | INTEGER | ✓ | 賞品順位 (1=1等, 2=2等...) |
| name | VARCHAR(255) | ✓ | 賞品名 |
| description | TEXT | ✓ | 賞品説明 |
| image_url | VARCHAR(500) | | 賞品画像URL |
| value | INTEGER | ✓ | 賞品価値（円） |
| quantity | INTEGER | ✓ | 数量 |
| winning_layer_number | INTEGER | | 当選レイヤー番号 |
| winning_position_id | UUID | | 当選ポジションID |
| winner_user_id | UUID | | 当選者ユーザーID |
| awarded | BOOLEAN | ✓ | 授与済みフラグ |
| awarded_at | TIMESTAMP | | 授与日時 |

### バリデーションルール

- **FR-002**: 1等賞品は必須（rank = 1）
- **FR-002**: 賞品の総額 < キャンペーン総売上の85%（利益率15%確保）

---

## 5. Purchase（購入）

### 説明
ユーザーのポジション購入記録。決済トランザクションと1対1で関連。

### スキーマ

```sql
CREATE TABLE purchases (
  purchase_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 関連エンティティ
  user_id UUID NOT NULL REFERENCES users(user_id),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id),
  position_id UUID NOT NULL REFERENCES positions(position_id),

  -- 購入情報
  price INTEGER NOT NULL CHECK (price >= 100),
  purchase_method VARCHAR(20) NOT NULL CHECK (
    purchase_method IN ('credit_card', 'debit_card', 'konbini')
  ),

  -- ステータス管理
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'reserved', 'completed', 'failed', 'refunded', 'cancelled')
  ),

  -- 冪等性キー
  request_id VARCHAR(255) NOT NULL,  -- クライアント生成UUID
  request_body_hash VARCHAR(64) NOT NULL,  -- SHA-256ハッシュ

  -- Stripe連携
  payment_intent_id VARCHAR(255),

  -- 日時
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reserved_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,

  -- ユニーク制約
  UNIQUE(request_id),
  UNIQUE(position_id)  -- 1ポジション = 1購入のみ
);

-- インデックス
CREATE INDEX idx_purchases_user ON purchases(user_id);
CREATE INDEX idx_purchases_campaign ON purchases(campaign_id);
CREATE INDEX idx_purchases_user_campaign ON purchases(user_id, campaign_id)
  WHERE status IN ('reserved', 'completed');
CREATE INDEX idx_purchases_request_id ON purchases(request_id);
CREATE INDEX idx_purchases_payment_intent ON purchases(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX idx_purchases_status ON purchases(status);
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| purchase_id | UUID | ✓ | 主キー |
| user_id | UUID | ✓ | 購入者ユーザーID |
| campaign_id | UUID | ✓ | キャンペーンID |
| position_id | UUID | ✓ | 購入ポジションID |
| price | INTEGER | ✓ | 購入価格（円） |
| purchase_method | VARCHAR(20) | ✓ | 決済方法 |
| status | VARCHAR(20) | ✓ | ステータス |
| request_id | VARCHAR(255) | ✓ | 冪等性キー（UUID） |
| request_body_hash | VARCHAR(64) | ✓ | リクエストボディSHA-256 |
| payment_intent_id | VARCHAR(255) | | Stripe PaymentIntent ID |
| created_at | TIMESTAMP | ✓ | 作成日時 |
| reserved_at | TIMESTAMP | | 予約日時 |
| completed_at | TIMESTAMP | | 完了日時 |
| cancelled_at | TIMESTAMP | | キャンセル日時 |

### ステータス遷移

```
pending (作成直後)
  → reserved (ポジション確保)
  → completed (決済成功)

pending → failed (ポジション確保失敗/決済失敗)
reserved → failed (決済失敗)
completed → refunded (返金)
任意 → cancelled (ユーザーキャンセル/管理者キャンセル)
```

### 冪等性保証

**FR-016**: `request_id` と `request_body_hash` で重複リクエストを検出

```sql
-- 冪等性チェッククエリ
SELECT purchase_id, status, position_id
FROM purchases
WHERE request_id = $1;

-- ハッシュ検証
SELECT request_body_hash = $1 as hash_matches
FROM purchases
WHERE request_id = $2;
```

### 購入制限チェック

```sql
-- ユーザーの購入数チェック (FR-014)
SELECT COUNT(*) as purchase_count
FROM purchases
WHERE campaign_id = $1
  AND user_id = $2
  AND status IN ('reserved', 'completed');

-- キャンペーンの purchase_limit と比較
```

---

## 6. PaymentTransaction（決済トランザクション）

### 説明
Stripe決済の詳細記録。Webhook受信情報を含む。

### スキーマ

```sql
CREATE TABLE payment_transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 関連購入
  purchase_id UUID NOT NULL REFERENCES purchases(purchase_id),

  -- Stripe情報
  stripe_payment_intent_id VARCHAR(255) NOT NULL,
  stripe_charge_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),

  -- 決済情報
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'JPY',
  payment_method_type VARCHAR(50) NOT NULL,  -- card, konbini

  -- ステータス
  status VARCHAR(50) NOT NULL CHECK (
    status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded')
  ),

  -- コンビニ決済情報
  konbini_store_name VARCHAR(50),  -- familymart, lawson, ministop, seicomart
  konbini_confirmation_number VARCHAR(20),
  konbini_payment_deadline TIMESTAMP,
  konbini_receipt_url VARCHAR(500),

  -- Webhook受信情報
  webhook_received_at TIMESTAMP,
  webhook_event_id VARCHAR(255),

  -- エラー情報
  failure_code VARCHAR(100),
  failure_message TEXT,

  -- 日時
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  succeeded_at TIMESTAMP,
  failed_at TIMESTAMP,

  UNIQUE(stripe_payment_intent_id)
);

-- インデックス
CREATE INDEX idx_payment_transactions_purchase ON payment_transactions(purchase_id);
CREATE INDEX idx_payment_transactions_stripe_id ON payment_transactions(stripe_payment_intent_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX idx_payment_transactions_webhook ON payment_transactions(webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;
CREATE INDEX idx_payment_transactions_konbini_deadline ON payment_transactions(konbini_payment_deadline)
  WHERE konbini_payment_deadline IS NOT NULL AND status = 'pending';
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| transaction_id | UUID | ✓ | 主キー |
| purchase_id | UUID | ✓ | 親購入レコード |
| stripe_payment_intent_id | VARCHAR(255) | ✓ | Stripe PaymentIntent ID |
| stripe_charge_id | VARCHAR(255) | | Stripe Charge ID |
| stripe_customer_id | VARCHAR(255) | | Stripe Customer ID |
| amount | INTEGER | ✓ | 決済金額（円） |
| currency | VARCHAR(3) | ✓ | 通貨コード（JPY固定） |
| payment_method_type | VARCHAR(50) | ✓ | 決済手段タイプ |
| status | VARCHAR(50) | ✓ | 決済ステータス |
| konbini_store_name | VARCHAR(50) | | コンビニ店舗名 |
| konbini_confirmation_number | VARCHAR(20) | | 受付番号 |
| konbini_payment_deadline | TIMESTAMP | | 支払期限 |
| konbini_receipt_url | VARCHAR(500) | | 払込票URL |
| webhook_received_at | TIMESTAMP | | Webhook受信日時 |
| webhook_event_id | VARCHAR(255) | | Stripe Event ID |
| failure_code | VARCHAR(100) | | エラーコード |
| failure_message | TEXT | | エラーメッセージ |
| created_at | TIMESTAMP | ✓ | 作成日時 |
| updated_at | TIMESTAMP | ✓ | 更新日時 |
| succeeded_at | TIMESTAMP | | 成功日時 |
| failed_at | TIMESTAMP | | 失敗日時 |

### Webhook処理

**FR-022**: payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled を処理

```sql
-- Webhook受信時の更新
UPDATE payment_transactions
SET
  status = $1,
  webhook_received_at = NOW(),
  webhook_event_id = $2,
  succeeded_at = CASE WHEN $1 = 'succeeded' THEN NOW() ELSE NULL END,
  failed_at = CASE WHEN $1 = 'failed' THEN NOW() ELSE NULL END
WHERE stripe_payment_intent_id = $3;
```

---

## 7. User（ユーザー）

### 説明
Firebase Authenticationユーザーの補足情報。認証はFirebaseで管理し、アプリ固有データのみ保存。

### スキーマ

```sql
CREATE TABLE users (
  user_id UUID PRIMARY KEY,  -- Firebase Auth UIDをそのまま使用

  -- プロフィール
  display_name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20),
  photo_url VARCHAR(500),

  -- ロール
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (
    role IN ('user', 'admin')
  ),

  -- プッシュ通知
  fcm_token VARCHAR(500),
  notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- 統計
  total_purchases INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  prizes_won INTEGER NOT NULL DEFAULT 0,

  -- 日時
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP,

  UNIQUE(email)
);

-- インデックス
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_fcm_token ON users(fcm_token) WHERE fcm_token IS NOT NULL;
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| user_id | UUID | ✓ | 主キー（Firebase Auth UID） |
| display_name | VARCHAR(255) | | 表示名 |
| email | VARCHAR(255) | ✓ | メールアドレス |
| phone_number | VARCHAR(20) | | 電話番号 |
| photo_url | VARCHAR(500) | | プロフィール写真URL |
| role | VARCHAR(20) | ✓ | ロール |
| fcm_token | VARCHAR(500) | | FCMトークン |
| notification_enabled | BOOLEAN | ✓ | プッシュ通知有効フラグ |
| total_purchases | INTEGER | ✓ | 総購入回数 |
| total_spent | INTEGER | ✓ | 総購入金額（円） |
| prizes_won | INTEGER | ✓ | 当選回数 |
| created_at | TIMESTAMP | ✓ | アカウント作成日時 |
| updated_at | TIMESTAMP | ✓ | 更新日時 |
| last_login_at | TIMESTAMP | | 最終ログイン日時 |

### Firebase Auth連携

- **FR-033**: Firebase AuthenticationのUIDを `user_id` として使用
- **FR-035**: プロフィール情報はFirebase Authから取得し、必要に応じてテーブルを更新
- **FR-034**: Custom Claimsで `role` を管理

### 統計更新トリガー

```sql
CREATE OR REPLACE FUNCTION update_user_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
    UPDATE users
    SET
      total_purchases = total_purchases + 1,
      total_spent = total_spent + NEW.price
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_user_stats
AFTER INSERT OR UPDATE ON purchases
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION update_user_stats();
```

---

## 8. Notification（通知）

### 説明
プッシュ通知の送信履歴。Firebase Cloud Messaging (FCM) 経由で送信。

### スキーマ

```sql
CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 受信者
  user_id UUID NOT NULL REFERENCES users(user_id),

  -- 通知内容
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  notification_type VARCHAR(50) NOT NULL CHECK (
    notification_type IN ('purchase_confirmed', 'payment_pending', 'lottery_drawn',
                          'prize_won', 'campaign_ending', 'admin_message')
  ),

  -- 関連エンティティ
  campaign_id UUID REFERENCES campaigns(campaign_id),
  purchase_id UUID REFERENCES purchases(purchase_id),
  prize_id UUID REFERENCES prizes(prize_id),

  -- ペイロード
  data JSONB,  -- Deep link用のカスタムデータ

  -- 送信情報
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMP,
  fcm_message_id VARCHAR(255),

  -- エラー情報
  error_code VARCHAR(100),
  error_message TEXT,

  -- 既読
  read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX idx_notifications_sent ON notifications(sent, sent_at);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_campaign ON notifications(campaign_id) WHERE campaign_id IS NOT NULL;
```

### フィールド説明

| フィールド | 型 | 必須 | 説明 |
|---------|---|-----|-----|
| notification_id | UUID | ✓ | 主キー |
| user_id | UUID | ✓ | 受信者ユーザーID |
| title | VARCHAR(255) | ✓ | 通知タイトル |
| body | TEXT | ✓ | 通知本文 |
| notification_type | VARCHAR(50) | ✓ | 通知タイプ |
| campaign_id | UUID | | 関連キャンペーン |
| purchase_id | UUID | | 関連購入 |
| prize_id | UUID | | 関連賞品 |
| data | JSONB | | カスタムデータ |
| sent | BOOLEAN | ✓ | 送信済みフラグ |
| sent_at | TIMESTAMP | | 送信日時 |
| fcm_message_id | VARCHAR(255) | | FCMメッセージID |
| error_code | VARCHAR(100) | | エラーコード |
| error_message | TEXT | | エラーメッセージ |
| read | BOOLEAN | ✓ | 既読フラグ |
| read_at | TIMESTAMP | | 既読日時 |
| created_at | TIMESTAMP | ✓ | 作成日時 |

### 通知タイプ

| タイプ | 説明 | トリガー |
|------|-----|---------|
| purchase_confirmed | 購入確定 | 決済成功時 |
| payment_pending | コンビニ決済待ち | コンビニ決済選択時 |
| lottery_drawn | 抽選実施 | 抽選実行後 |
| prize_won | 当選通知 | 抽選結果確定後 |
| campaign_ending | キャンペーン終了間近 | 終了1日前 |
| admin_message | 管理者メッセージ | 管理者が送信 |

### Deep Linkペイロード例

```json
{
  "screen": "purchase_detail",
  "purchase_id": "uuid",
  "campaign_id": "uuid"
}
```

---

## エンティティ関係図（ER図）

```
┌─────────────────┐
│     User        │
│ (Firebase Auth) │
└────────┬────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐         ┌─────────────────┐
│    Campaign     │◄────────│     Prize       │
│                 │ 1:N     │                 │
└────────┬────────┘         └─────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐
│     Layer       │
└────────┬────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐         ┌─────────────────┐
│    Position     │◄────────│    Purchase     │
│                 │ 1:1     │                 │
└─────────────────┘         └────────┬────────┘
                                     │
                                     │ 1:1
                                     ▼
                            ┌─────────────────┐
                            │PaymentTransaction│
                            └─────────────────┘

         User
          │
          │ 1:N
          ▼
┌─────────────────┐
│  Notification   │
└─────────────────┘
```

---

## データ整合性チェックリスト

### キャンペーン作成時
- [ ] base_length に基づいて Layer レコードを生成
- [ ] Layer に基づいて Position レコードを生成
- [ ] positions_total = Σ(layer.positions_count)
- [ ] Prize レコード（最低1等賞品）を作成
- [ ] 賞品総額 < 予想売上の85%

### ポジション購入時
- [ ] ユーザーの購入制限チェック（purchase_limit）
- [ ] ポジションのステータスが 'available'
- [ ] 冪等性キー（request_id）の重複チェック
- [ ] トランザクション内でポジションをロック（FOR UPDATE SKIP LOCKED）
- [ ] Purchase レコード作成
- [ ] Position.status → 'reserved'
- [ ] Layer.positions_sold +1
- [ ] Campaign.positions_sold +1

### 決済成功時
- [ ] PaymentTransaction.status → 'succeeded'
- [ ] Purchase.status → 'completed'
- [ ] Position.status → 'sold', sold_at 設定
- [ ] User.total_purchases +1, total_spent += price
- [ ] Campaign.total_revenue += price
- [ ] 完売チェック: positions_sold == positions_total → 抽選トリガー

### 抽選実行時
- [ ] Advisory Lock取得（重複実行防止）
- [ ] Campaign.status == 'sold_out'
- [ ] レイヤーごとに当選ポジションをランダム選択
- [ ] Prize.winning_position_id, winner_user_id 設定
- [ ] Notification レコード作成（全参加者）
- [ ] Campaign.status → 'drawn'

---

## パフォーマンス最適化

### 重要なインデックス

1. **Position割り当て**: `idx_positions_allocation` (campaign_id, layer_number, status)
2. **購入制限チェック**: `idx_purchases_user_campaign` (user_id, campaign_id)
3. **冪等性チェック**: `idx_purchases_request_id` (request_id)
4. **Webhook処理**: `idx_payment_transactions_stripe_id` (stripe_payment_intent_id)

### クエリ最適化

- **SELECT ... FOR UPDATE SKIP LOCKED** でポジション割り当て並行性を最大化
- **REPEATABLE READ** トランザクション分離レベルで過剰販売を防止
- **Advisory Lock** でキャンペーン単位の抽選実行を排他制御

---

## 次のステップ

Phase 1の残りの成果物:

1. **API契約**: OpenAPI 3.0仕様書（`/contracts/api-openapi.yaml`）
2. **Stripe Webhook契約**: Webhookイベント仕様（`/contracts/stripe-webhooks.md`）
3. **Firebase通知契約**: プッシュ通知ペイロード仕様（`/contracts/firebase-events.md`）
4. **クイックスタート**: ローカル開発環境セットアップ手順（`quickstart.md`）

---

**作成者**: Claude Code | **レビュー**: Phase 1完了後に技術リードが確認
