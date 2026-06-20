-- Phase 2 fix: allow the new social notification types.
--
-- Phase 2 added `guestbook` (signing a guestbook) and `theme_remix` (using
-- someone's profile theme) notifications, but never extended the notifications
-- type CHECK constraint. Inserting those types violates `notifications_type_check`,
-- so the INSERT is rejected — and because the guestbook/remix services treat the
-- notification insert as non-fatal, the profile owner silently never gets notified.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'like', 'comment', 'reply', 'repost', 'follow', 'reaction',
    'hottest_post', 'hottest_post_replaced',
    'constellation_request', 'constellation_accepted',
    'mention',
    'guestbook', 'theme_remix'
  ));
