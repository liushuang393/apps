-- Migration: 006_add_auto_draw_to_campaigns
-- Created: 2025-01-XX
-- Purpose: Add auto_draw column to campaigns table for automatic lottery drawing

-- Add auto_draw column with default value true (自動開獎)
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS auto_draw BOOLEAN NOT NULL DEFAULT TRUE;

-- Add comment
COMMENT ON COLUMN campaigns.auto_draw IS '自動開獎フラグ: trueの場合、購買完了後に自動的に開獎を実行';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_campaigns_auto_draw ON campaigns(auto_draw) WHERE auto_draw = TRUE;
