-- Migration: 013_add_ticket_price_and_prize_name.sql
-- 目的: キャンペーンに統一抽選価格、レイヤーに賞品名を追加
-- 注意点: ticket_price は管理者が設定した利益率から計算される統一価格

-- 1. campaigns テーブルに ticket_price を追加
-- ticket_price: 顧客が購入時に支払う統一価格（全レイヤー共通）
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS ticket_price INTEGER NOT NULL DEFAULT 0;

-- コメント: ticket_price は全ての層で同一の抽選チケット価格
COMMENT ON COLUMN campaigns.ticket_price IS '統一抽選チケット価格（円）- 顧客が支払う金額';

-- 2. layers テーブルに prize_name を追加
-- prize_name: 各層の賞品名（顧客に表示される）
ALTER TABLE layers
ADD COLUMN IF NOT EXISTS prize_name VARCHAR(255);

COMMENT ON COLUMN layers.prize_name IS '賞品名（顧客向け表示用）';

-- 3. 既存データの更新（ticket_price を計算）
-- 注意: 既存のキャンペーンは layer_prices と profit_margin_percent から再計算
-- 計算式: ticket_price = ceil(総賞品コスト / (1 - 利益率/100) / 総ポジション数)
UPDATE campaigns
SET ticket_price = CASE
  WHEN positions_total > 0 AND profit_margin_percent < 100 THEN
    CEIL(
      (SELECT COALESCE(SUM((kv.value::int) * (kv.key::int)), 0)
       FROM jsonb_each_text(layer_prices) kv)
      / (1 - profit_margin_percent / 100.0)
      / positions_total
    )
  ELSE 0
END
WHERE ticket_price = 0 OR ticket_price IS NULL;

-- 4. 既存のレイヤーに賞品名を設定（デフォルト: 「N等賞」）
UPDATE layers
SET prize_name = layer_number || '等賞'
WHERE prize_name IS NULL;

