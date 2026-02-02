-- Migration: 007_fix_payment_transactions_schema
-- Purpose: Fix payment_transactions table schema to match code implementation
-- Created: 2025-12-01

BEGIN;

-- =======================
-- 1. Rename columns to match code
-- =======================

-- Rename payment_method_type to payment_method
ALTER TABLE payment_transactions
RENAME COLUMN payment_method_type TO payment_method;

-- Rename status to payment_status
ALTER TABLE payment_transactions
RENAME COLUMN status TO payment_status;

-- =======================
-- 2. Update constraints
-- =======================

-- Drop old constraint
ALTER TABLE payment_transactions
DROP CONSTRAINT IF EXISTS payment_transactions_status_check;

-- Add new constraint with correct column name
ALTER TABLE payment_transactions
ADD CONSTRAINT payment_transactions_payment_status_check CHECK (
  payment_status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'requires_action')
);

-- =======================
-- 3. Update indexes
-- =======================

-- Drop old index on status
DROP INDEX IF EXISTS idx_payment_transactions_status;

-- Create new index on payment_status
CREATE INDEX idx_payment_transactions_payment_status ON payment_transactions(payment_status);

COMMIT;
