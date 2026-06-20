-- Profile Guestbook (Phase 2)
-- Visitors leave short plain-text messages on a user's profile.

CREATE TABLE IF NOT EXISTS profile_guestbook_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message text NOT NULL,
    created_at timestamptz DEFAULT now(),
    deleted_at timestamptz
);

-- Recent entries for a profile (non-deleted ordered newest first).
CREATE INDEX IF NOT EXISTS idx_guestbook_profile_created
    ON profile_guestbook_entries (profile_user_id, created_at DESC);

-- An author's own entries.
CREATE INDEX IF NOT EXISTS idx_guestbook_author_created
    ON profile_guestbook_entries (author_user_id, created_at DESC);
