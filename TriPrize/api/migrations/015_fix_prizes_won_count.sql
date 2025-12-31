-- Migration: 015_fix_prizes_won_count
-- Date: 2025-12-31
-- Purpose: Fix users.prizes_won count by recalculating from lottery_results table
-- Description: 
--   This migration fixes a bug where prizes_won was not being updated correctly
--   during lottery draws. It recalculates the count from actual lottery_results records.

BEGIN;

-- =======================
-- 1. Log current state for debugging
-- =======================
DO $$
DECLARE
  user_record RECORD;
BEGIN
  RAISE NOTICE '=== Current prizes_won values ===';
  FOR user_record IN 
    SELECT user_id, email, prizes_won FROM users WHERE prizes_won >= 0 ORDER BY prizes_won DESC LIMIT 10
  LOOP
    RAISE NOTICE 'User: %, Email: %, prizes_won: %', 
      user_record.user_id, user_record.email, user_record.prizes_won;
  END LOOP;
END $$;

-- =======================
-- 2. Show lottery_results counts per user
-- =======================
DO $$
DECLARE
  result_record RECORD;
BEGIN
  RAISE NOTICE '=== lottery_results counts per user ===';
  FOR result_record IN 
    SELECT lr.user_id, u.email, COUNT(*) as actual_wins
    FROM lottery_results lr
    LEFT JOIN users u ON lr.user_id::text = u.user_id::text
    GROUP BY lr.user_id, u.email
    ORDER BY actual_wins DESC
  LOOP
    RAISE NOTICE 'User: %, Email: %, actual_wins: %', 
      result_record.user_id, result_record.email, result_record.actual_wins;
  END LOOP;
END $$;

-- =======================
-- 3. Update prizes_won based on lottery_results
-- =======================
-- 目的: lottery_results テーブルから当選数を再計算して users.prizes_won を更新
-- 注意点: user_id の型が異なる可能性があるため、テキストとして比較
UPDATE users u
SET 
  prizes_won = COALESCE(lr_count.win_count, 0),
  updated_at = NOW()
FROM (
  SELECT 
    lr.user_id::text as user_id_text,
    COUNT(*) as win_count
  FROM lottery_results lr
  GROUP BY lr.user_id::text
) lr_count
WHERE u.user_id::text = lr_count.user_id_text
  AND u.prizes_won != lr_count.win_count;

-- =======================
-- 4. Log updated state
-- =======================
DO $$
DECLARE
  user_record RECORD;
BEGIN
  RAISE NOTICE '=== Updated prizes_won values ===';
  FOR user_record IN 
    SELECT user_id, email, prizes_won FROM users WHERE prizes_won > 0 ORDER BY prizes_won DESC
  LOOP
    RAISE NOTICE 'User: %, Email: %, prizes_won: %', 
      user_record.user_id, user_record.email, user_record.prizes_won;
  END LOOP;
END $$;

COMMIT;

-- 説明:
-- このマイグレーションは lottery_results テーブルから当選数を再計算して
-- users.prizes_won を正しい値に更新します。
-- これにより、過去の抽選で更新されなかった prizes_won が修正されます。

