-- Following Feed: Scalable RPC function
-- Run this in the Supabase SQL editor
-- Safe to re-run (uses CREATE OR REPLACE)
--
-- Replaces the old approach of fetching all following IDs in JS
-- and sending them in a massive IN() clause. Instead, uses a
-- subquery so the IDs never leave the database.

-- Recommended index for this query:
-- CREATE INDEX IF NOT EXISTS idx_journals_following_feed
-- ON journals(user_id, privacy, created_at DESC)
-- WHERE privacy = 'public';

DROP FUNCTION IF EXISTS public.get_following_feed;
CREATE OR REPLACE FUNCTION public.get_following_feed(
    p_user_id UUID,
    p_limit INT DEFAULT 5,
    p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    title TEXT,
    content JSONB,
    post_type TEXT,
    canvas_doc JSONB,
    created_at TIMESTAMPTZ,
    privacy TEXT,
    views INT,
    is_repost BOOLEAN,
    repost_source_journal_id UUID,
    repost_caption TEXT,
    prompt_id INTEGER,
    user_name TEXT,
    user_image_url TEXT,
    user_badge TEXT,
    user_obj_id UUID,
    like_count BIGINT,
    reaction_count BIGINT,
    comment_count BIGINT,
    bookmark_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        j.id,
        j.user_id,
        j.title,
        j.content::JSONB,
        j.post_type,
        j.canvas_doc,
        j.created_at,
        j.privacy,
        j.views,
        j.is_repost,
        j.repost_source_journal_id,
        j.repost_caption,
        j.prompt_id,
        u.name AS user_name,
        u.image_url AS user_image_url,
        u.badge AS user_badge,
        u.id AS user_obj_id,
        (SELECT COUNT(*) FROM public.likes l WHERE l.journal_id = j.id) AS like_count,
        (SELECT COUNT(*) FROM public.reactions r WHERE r.journal_id = j.id) AS reaction_count,
        (SELECT COUNT(*) FROM public.comments c WHERE c.post_id = j.id) AS comment_count,
        (SELECT COUNT(*) FROM public.bookmarks b WHERE b.journal_id = j.id) AS bookmark_count
    FROM public.journals j
    INNER JOIN public.follows f ON f.following_id = j.user_id AND f.follower_id = p_user_id
    LEFT JOIN public.users u ON u.id = j.user_id
    WHERE j.privacy = 'public'
      AND (p_before IS NULL OR j.created_at < p_before)
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT p_limit;
$$;


CREATE INDEX idx_journals_following_feed
  ON journals(user_id, privacy, created_at DESC)
  WHERE privacy = 'public';