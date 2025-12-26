-- Migration: 014_add_manual_ticket_price.sql
-- 目的: キャンペーンに手動設定用の抽選単価フィールドを追加
-- 注意点: manual_ticket_price が設定されている場合、自動計算値より優先される

-- 1. campaigns テーブルに manual_ticket_price を追加
-- manual_ticket_price: 管理者が手動で設定する抽選単価（NULL = 自動計算を使用）
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS manual_ticket_price INTEGER;

-- コメント: manual_ticket_price は管理者が手動で設定した抽選価格（円）
-- NULL の場合は ticket_price（自動計算値）が使用される
COMMENT ON COLUMN campaigns.manual_ticket_price IS '手動設定の抽選単価（円）- NULLの場合は自動計算値を使用';

-- 2. 有効な抽選単価を取得するためのビュー関数（参考用）
-- 実際のロジックはアプリケーション層で処理
-- effective_ticket_price = COALESCE(manual_ticket_price, ticket_price)

