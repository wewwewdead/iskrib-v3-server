-- Writing Streaks table
CREATE TABLE IF NOT EXISTS writing_streaks (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_publish_date DATE DEFAULT NULL,
    freeze_available BOOLEAN NOT NULL DEFAULT FALSE,
    freeze_last_granted DATE DEFAULT NULL,
    freeze_used_date DATE DEFAULT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_writing_streaks_last_publish
    ON writing_streaks(last_publish_date);
