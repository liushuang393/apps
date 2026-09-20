-- Migration: 016_add_timestamps_to_layers.sql
-- 目的: layers / positions / prizes テーブルに created_at / updated_at を追加する
-- 背景: campaign.service.ts などは INSERT/UPDATE で両列を指定しているが
--       001_initial_schema.sql では定義されておらず、キャンペーン作成が必ず失敗していた
-- 注意点: 既存行には作成時刻が残っていないため NOW() を初期値として補完する

ALTER TABLE layers
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE positions
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE prizes
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

COMMENT ON COLUMN layers.created_at IS 'レコード作成時刻';
COMMENT ON COLUMN layers.updated_at IS 'レコード更新時刻';
COMMENT ON COLUMN positions.created_at IS 'レコード作成時刻';
COMMENT ON COLUMN positions.updated_at IS 'レコード更新時刻';
COMMENT ON COLUMN prizes.created_at IS 'レコード作成時刻';
COMMENT ON COLUMN prizes.updated_at IS 'レコード更新時刻';

-- 更新時刻を自動維持する（他テーブルと同じ方針）
CREATE OR REPLACE FUNCTION update_row_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_layer_updated_at ON layers;
CREATE TRIGGER trg_layer_updated_at
BEFORE UPDATE ON layers
FOR EACH ROW
EXECUTE FUNCTION update_row_timestamp();

DROP TRIGGER IF EXISTS trg_position_updated_at ON positions;
CREATE TRIGGER trg_position_updated_at
BEFORE UPDATE ON positions
FOR EACH ROW
EXECUTE FUNCTION update_row_timestamp();

DROP TRIGGER IF EXISTS trg_prize_updated_at ON prizes;
CREATE TRIGGER trg_prize_updated_at
BEFORE UPDATE ON prizes
FOR EACH ROW
EXECUTE FUNCTION update_row_timestamp();
