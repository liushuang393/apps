-- Migration: 002_fix_purchases_schema
-- Purpose: Fix purchases table schema to match code implementation
-- Created: 2025-11-15

BEGIN;

-- =======================
-- 1. Add missing columns
-- =======================

-- Add updated_at column (used in code but missing in schema)
ALTER TABLE purchases
ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Add quantity column (used in code but missing in schema)
ALTER TABLE purchases
ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0);

-- Add price_per_position column (used in code but missing in schema)
ALTER TABLE purchases
ADD COLUMN price_per_position INTEGER NOT NULL DEFAULT 0 CHECK (price_per_position >= 100);

-- Add total_amount column (used in code but missing in schema)
ALTER TABLE purchases
ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 100);

-- =======================
-- 2. Rename and modify existing columns
-- =======================

-- Rename request_id to idempotency_key
ALTER TABLE purchases
RENAME COLUMN request_id TO idempotency_key;

-- Make idempotency_key nullable (it's optional in code)
ALTER TABLE purchases
ALTER COLUMN idempotency_key DROP NOT NULL;

-- =======================
-- 3. Update status enum to include 'cancelled'
-- =======================

-- Drop old constraint
ALTER TABLE purchases
DROP CONSTRAINT IF EXISTS purchases_status_check;

-- Add new constraint with 'cancelled' status
ALTER TABLE purchases
ADD CONSTRAINT purchases_status_check CHECK (
  status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded')
);

-- =======================
-- 4. Remove unused columns
-- =======================

-- Remove request_body_hash (no longer used)
ALTER TABLE purchases
DROP COLUMN IF EXISTS request_body_hash;

-- Remove reserved_at (not used in code)
ALTER TABLE purchases
DROP COLUMN IF EXISTS reserved_at;

-- =======================
-- 5. Update indexes
-- =======================

-- Drop old index on request_id
DROP INDEX IF EXISTS idx_purchases_request_id;

-- Create new index on idempotency_key
CREATE INDEX idx_purchases_idempotency_key ON purchases(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =======================
-- 6. Add unique constraint on idempotency_key
-- =======================

-- Add unique constraint (allows NULL values, but prevents duplicate non-NULL values)
ALTER TABLE purchases
ADD CONSTRAINT purchases_idempotency_key_unique
UNIQUE (idempotency_key);

-- =======================
-- 7. Create trigger for updated_at
-- =======================

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_purchase_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER trg_purchase_updated_at
BEFORE UPDATE ON purchases
FOR EACH ROW
EXECUTE FUNCTION update_purchase_timestamp();

-- =======================
-- 8. Update existing data
-- =======================

-- Update price_per_position and total_amount for existing records
UPDATE purchases
SET price_per_position = price,
    total_amount = price * quantity
WHERE price_per_position = 0;

-- =======================
-- 9. Drop old price column
-- =======================

-- Drop old price column (replaced by price_per_position)
ALTER TABLE purchases
DROP COLUMN IF EXISTS price;

COMMIT;

