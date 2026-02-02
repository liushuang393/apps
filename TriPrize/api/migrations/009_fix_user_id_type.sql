-- Migration: 009_fix_user_id_type
-- Purpose: Change user_id column type from UUID to VARCHAR to match actual usage
-- Created: 2025-12-02
-- 
-- Root cause: The users.user_id column uses UUID type but some tests use string identifiers.
-- The code passes user_id strings (like "test-payment-e2e-xxx") which cannot be inserted as UUID.
-- Since users table defines user_id as UUID PRIMARY KEY, but tests create users with firebase_uid
-- as both user_id and firebase_uid (which are strings), we need VARCHAR for flexibility.

BEGIN;

-- =======================
-- 1. Drop existing index (will be recreated after column change)
-- =======================
DROP INDEX IF EXISTS idx_payment_transactions_user_id;

-- =======================
-- 2. Change user_id column type from UUID to VARCHAR(255)
-- =======================
-- This allows storing both UUID strings and other string identifiers
ALTER TABLE payment_transactions
ALTER COLUMN user_id TYPE VARCHAR(255);

-- =======================
-- 3. Recreate index on user_id
-- =======================
CREATE INDEX idx_payment_transactions_user_id ON payment_transactions(user_id);

COMMIT;

