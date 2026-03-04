-- Add reading_time column to journals table
-- Stores pre-computed reading time in minutes (based on 150 WPM)
ALTER TABLE journals ADD COLUMN IF NOT EXISTS reading_time integer DEFAULT 1;
