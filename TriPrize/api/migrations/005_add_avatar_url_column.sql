-- Migration: Add avatar_url column to users table
-- Date: 2025-11-24
-- Description: Add avatar_url column as an alias for photo_url to match code implementation

-- Add avatar_url column
ALTER TABLE users
ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

-- Copy existing photo_url data to avatar_url
UPDATE users
SET avatar_url = photo_url
WHERE photo_url IS NOT NULL;

-- Add comment
COMMENT ON COLUMN users.avatar_url IS 'User avatar/profile photo URL';

