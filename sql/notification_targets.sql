-- Notification target model (robust replacement for the guestbook quick-fix routing).
--
-- Every notification gets a clear target: the thing the notification is *about*
-- (a profile, a guestbook entry, a journal, etc.) so the client can navigate
-- reliably instead of guessing from the sender.
--
-- DEPLOYMENT ORDER: run this migration in Supabase BEFORE deploying the new
-- server/client. The server fetch + insert are written to fall back gracefully
-- if these columns are missing, so notifications won't break either way — but
-- targets only take effect once this has run.

-- ── Columns (all nullable; safe + additive) ──────────────────────────────────
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_type text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_id uuid;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Allowed target types (NULL allowed for legacy rows) ──────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
  CHECK (target_type IS NULL OR target_type IN (
    'user_profile',
    'own_profile',
    'profile_guestbook',
    'journal',
    'opinion',
    'comment_thread',
    'constellation',
    'unknown'
  ));

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS notifications_receiver_created_idx
  ON notifications(receiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_target_type_idx
  ON notifications(target_type);

CREATE INDEX IF NOT EXISTS notifications_target_user_idx
  ON notifications(target_user_id);

-- ── Backfill existing rows (idempotent; only touches rows with no target yet) ─
-- follow → the follower's (actor's) profile
UPDATE notifications
   SET target_type = 'user_profile', target_user_id = sender_id
 WHERE type = 'follow' AND target_type IS NULL;

-- theme_remix → the remixer's (actor's) profile
UPDATE notifications
   SET target_type = 'user_profile', target_user_id = sender_id
 WHERE type = 'theme_remix' AND target_type IS NULL;

-- guestbook (legacy rows have no entry id) → the owner's guestbook, with the
-- actor recorded so the client can highlight their latest loaded note.
UPDATE notifications
   SET target_type = 'profile_guestbook',
       target_user_id = receiver_id,
       target_metadata = jsonb_build_object('fallbackActorId', sender_id)
 WHERE type = 'guestbook' AND target_type IS NULL;

-- content notifications (comment/reply/like/reaction/repost/mention) → the journal
UPDATE notifications
   SET target_type = 'journal', target_id = journal_id
 WHERE journal_id IS NOT NULL AND target_type IS NULL;

-- anything left → unknown (safe fallback; client uses legacy routing)
UPDATE notifications
   SET target_type = 'unknown'
 WHERE target_type IS NULL;
