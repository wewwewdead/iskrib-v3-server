-- Profile Theme Remixes (Phase 2)
-- Records when a user copies ("uses") another user's profile theme.

CREATE TABLE IF NOT EXISTS profile_theme_remixes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remixer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_theme_remixes_source_created
    ON profile_theme_remixes (source_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_theme_remixes_remixer_created
    ON profile_theme_remixes (remixer_user_id, created_at DESC);
