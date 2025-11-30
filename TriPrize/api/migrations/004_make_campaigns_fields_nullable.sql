-- Migration: Make campaigns fields nullable
-- Date: 2025-11-16
-- Description: Make image_url, description, start_date, and end_date nullable in campaigns table
--              These fields should be optional when creating a campaign

-- Make image_url nullable (can be uploaded later)
ALTER TABLE campaigns 
ALTER COLUMN image_url DROP NOT NULL;

-- Make description nullable (can be added later)
ALTER TABLE campaigns 
ALTER COLUMN description DROP NOT NULL;

-- Make start_date nullable (can be set when publishing)
ALTER TABLE campaigns 
ALTER COLUMN start_date DROP NOT NULL;

-- Make end_date nullable (can be set when publishing)
ALTER TABLE campaigns 
ALTER COLUMN end_date DROP NOT NULL;

-- Add comments
COMMENT ON COLUMN campaigns.image_url IS 'Campaign image URL (optional, can be uploaded later)';
COMMENT ON COLUMN campaigns.description IS 'Campaign description (optional)';
COMMENT ON COLUMN campaigns.start_date IS 'Campaign start date (optional, set when publishing)';
COMMENT ON COLUMN campaigns.end_date IS 'Campaign end date (optional, set when publishing)';

