-- Add 'mention' to the notifications type CHECK constraint
-- Run this in the Supabase SQL Editor

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'like', 'comment', 'reply', 'repost', 'follow', 'reaction',
    'hottest_post', 'hottest_post_replaced',
    'constellation_request', 'constellation_accepted',
    'mention'
  ));

-- Add 'mention' to the notification_opinions type CHECK constraint
ALTER TABLE notification_opinions DROP CONSTRAINT IF EXISTS notification_opinions_type_check;
ALTER TABLE notification_opinions ADD CONSTRAINT notification_opinions_type_check
  CHECK (type IN ('reply', 'mention'));
