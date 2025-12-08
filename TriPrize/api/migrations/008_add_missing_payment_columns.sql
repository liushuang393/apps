-- Migration: 008_add_missing_payment_columns
-- Purpose: Add missing columns to payment_transactions table required by payment.service.ts
-- Created: 2025-12-02
-- 
-- Root cause: payment.service.ts uses columns (user_id, metadata, paid_at, error_message, refunded_amount)
-- that were not defined in 001_initial_schema.sql

BEGIN;

-- =======================
-- 1. Add user_id column (REQUIRED - main cause of test failures)
-- =======================
-- 目的: payment.service.ts の createPaymentIntent で user_id カラムへの INSERT を行う
-- Note: Not adding foreign key constraint to avoid issues with existing data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN user_id UUID;

    COMMENT ON COLUMN payment_transactions.user_id IS 'Reference to the user who made the payment';
  END IF;
END $$;

-- =======================
-- 2. Add metadata column (for Stripe metadata storage)
-- =======================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN metadata JSONB;
    
    COMMENT ON COLUMN payment_transactions.metadata IS 'Stripe PaymentIntent metadata';
  END IF;
END $$;

-- =======================
-- 3. Add paid_at column (timestamp when payment succeeded)
-- =======================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'paid_at'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN paid_at TIMESTAMP;
    
    COMMENT ON COLUMN payment_transactions.paid_at IS 'Timestamp when payment was successfully completed';
  END IF;
END $$;

-- =======================
-- 4. Add error_message column (for failure details)
-- =======================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN error_message TEXT;
    
    COMMENT ON COLUMN payment_transactions.error_message IS 'Error message when payment fails';
  END IF;
END $$;

-- =======================
-- 5. Add refunded_amount column (for partial refunds)
-- =======================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'refunded_amount'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN refunded_amount INTEGER DEFAULT 0;
    
    COMMENT ON COLUMN payment_transactions.refunded_amount IS 'Amount refunded (for partial or full refunds)';
  END IF;
END $$;

-- =======================
-- 6. Create index on user_id for getUserTransactions query
-- =======================
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON payment_transactions(user_id);

COMMIT;

