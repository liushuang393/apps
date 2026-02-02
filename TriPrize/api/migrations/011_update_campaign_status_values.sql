-- Migration: 011_update_campaign_status_values
-- Date: 2025-12-13
-- Purpose: Update campaign status check constraint to include 'closed' status
-- Description: The application uses 'closed' status instead of 'active' and 'sold_out'
--              This migration updates the constraint to match the application's status values

BEGIN;

-- Drop the old constraint
ALTER TABLE campaigns
DROP CONSTRAINT campaigns_status_check;

-- Add new constraint with updated status values
ALTER TABLE campaigns
ADD CONSTRAINT campaigns_status_check CHECK (
  status IN ('draft', 'published', 'closed', 'drawn')
);

COMMIT;

