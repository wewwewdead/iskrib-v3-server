-- Composite indexes for interaction lookups (likes, bookmarks, reactions)
-- These are queried on every feed load with (user_id, journal_id) filters.
-- Run once in Supabase SQL editor.

CREATE INDEX IF NOT EXISTS idx_likes_user_journal
    ON public.likes(user_id, journal_id);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_journal
    ON public.bookmarks(user_id, journal_id);

CREATE INDEX IF NOT EXISTS idx_reactions_user_journal
    ON public.reactions(user_id, journal_id);
