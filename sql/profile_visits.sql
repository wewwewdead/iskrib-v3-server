-- Profile Visits (Phase 2)
-- Lightweight, throttled visit tracking. Anonymous visitors are recorded with a
-- privacy-safe hash (no IP/identity stored), logged-in visitors by user id.

CREATE TABLE IF NOT EXISTS profile_visits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visitor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    visitor_hash text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_visits_profile_created
    ON profile_visits (profile_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_visits_visitor_created
    ON profile_visits (visitor_user_id, created_at DESC);

-- Helps the 12h dedupe lookup for anonymous visitors.
CREATE INDEX IF NOT EXISTS idx_profile_visits_hash_created
    ON profile_visits (profile_user_id, visitor_hash, created_at DESC);
