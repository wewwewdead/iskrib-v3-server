-- Run this in Supabase SQL Editor
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username));
