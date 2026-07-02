-- Enforce the "every user has a username" invariant at the database level.
-- Run in the Supabase SQL editor AFTER deploying the server username fix and
-- running: node --env-file=.env server/scripts/backfillUsernames.js
-- Safe to re-run.
--
-- Why: public profiles are addressed by /u/:username. A null username makes a
-- user unreachable (404) everywhere they're linked (search, name clicks,
-- notifications). uploadUserDataService now always assigns a username at signup;
-- this makes that guarantee structural instead of convention-only, so a future
-- code path that forgets to set username fails loudly at insert time.

-- 1. Safety net: give any straggler null/blank usernames a unique fallback so the
--    NOT NULL constraint below cannot fail. The JS backfill produces nicer
--    name-based handles; this only catches rows it somehow missed. The 8 hex
--    chars from the row id keep it unique against the existing
--    users_username_unique (lower(username)) index from add-username-column.sql.
UPDATE public.users
SET username = 'user-' || substr(replace(id::text, '-', ''), 1, 8)
WHERE username IS NULL OR btrim(username) = '';

-- 2. Enforce NOT NULL. Case-insensitive uniqueness is already enforced by the
--    users_username_unique index created in add-username-column.sql.
ALTER TABLE public.users
    ALTER COLUMN username SET NOT NULL;
