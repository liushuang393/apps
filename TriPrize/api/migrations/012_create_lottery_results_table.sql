-- Migration: 012_create_lottery_results_table
-- Date: 2025-12-13
-- Purpose: Create lottery_results table for storing lottery draw results
-- Description: This table stores the results of lottery draws, including which positions won which prizes

BEGIN;

-- =======================
-- 1. Drop table if exists (for re-running migration)
-- =======================
DROP TABLE IF EXISTS lottery_results;

-- =======================
-- 2. Create lottery_results table
-- =======================
-- 注意: user_id使用VARCHAR类型，因为users表的user_id在测试环境中可能使用VARCHAR
CREATE TABLE lottery_results (
  result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  position_id UUID NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  prize_id UUID NOT NULL,
  prize_rank INTEGER NOT NULL CHECK (prize_rank > 0),
  drawn_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMP,
  claimed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(campaign_id, position_id)  -- Each position can only win once per campaign
);

-- =======================
-- 3. Create indexes
-- =======================
CREATE INDEX idx_lottery_results_campaign ON lottery_results(campaign_id);
CREATE INDEX idx_lottery_results_user ON lottery_results(user_id);
CREATE INDEX idx_lottery_results_position ON lottery_results(position_id);
CREATE INDEX idx_lottery_results_drawn_at ON lottery_results(drawn_at);

COMMIT;

