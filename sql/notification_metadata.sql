-- Notification metadata (Phase 2 follow-up)
--
-- Adds a small JSONB column so a notification can carry a type-specific target
-- payload. Currently used by guestbook notifications to store the signed
-- guestbook entry id, so the owner's notification can deep-link to (and
-- highlight) the exact note.
--
-- Safe + additive: existing notifications default to '{}'. The guestbook service
-- falls back to a metadata-less insert if this column is missing, so notifications
-- keep working even before this migration is applied (the entry just isn't
-- precisely highlighted).
--
-- Run this in the Supabase SQL editor.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
