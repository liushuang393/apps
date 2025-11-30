-- TriPrize Database Schema
-- Migration: 002_update_user_role
-- Created: 2025-11-24
-- 目的: ユーザーの役割を'user'から'customer'に更新

-- =======================
-- 1. 既存のユーザーロールを更新
-- =======================
-- 'user'ロールを持つ全ユーザーを'customer'に変更
UPDATE users 
SET role = 'customer' 
WHERE role = 'user';

-- =======================
-- 2. ロール制約を更新
-- =======================
-- 既存の制約を削除
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS users_role_check;

-- 新しい制約を追加（'customer'と'admin'のみ許可）
ALTER TABLE users 
ADD CONSTRAINT users_role_check 
CHECK (role IN ('customer', 'admin'));

-- =======================
-- 3. デフォルト値を更新
-- =======================
-- デフォルトロールを'customer'に変更
ALTER TABLE users 
ALTER COLUMN role SET DEFAULT 'customer';

-- 確認用: 更新されたユーザー数を表示
DO $$
DECLARE
  customer_count INTEGER;
  admin_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO customer_count FROM users WHERE role = 'customer';
  SELECT COUNT(*) INTO admin_count FROM users WHERE role = 'admin';
  
  RAISE NOTICE '✅ Migration 002 completed successfully';
  RAISE NOTICE 'Customer users: %', customer_count;
  RAISE NOTICE 'Admin users: %', admin_count;
END $$;

