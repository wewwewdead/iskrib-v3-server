-- Onboarding wizard columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS writing_interests text[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS writing_goal text;

-- Backfill: mark all existing users as onboarded
UPDATE users SET onboarding_completed = true WHERE onboarding_completed IS NULL;
