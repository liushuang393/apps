-- Migration: Add firebase_uid column to users table
-- Date: 2025-11-16
-- Description: Add firebase_uid column to support Firebase Authentication integration

-- Add firebase_uid column
ALTER TABLE users
ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255);

-- Add unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_firebase_uid_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_firebase_uid_unique UNIQUE (firebase_uid);
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);

-- Add comment
COMMENT ON COLUMN users.firebase_uid IS 'Firebase Authentication UID for user identification';

