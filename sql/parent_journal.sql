-- ═══════════════════════════════════════════════════════════════════
-- Parent-child journal linkage (V3 — "Continue this thought" threads)
--
-- Adds a nullable self-referential foreign key `parent_journal_id`
-- that lets a journal explicitly declare another journal as its
-- thread parent. This is DIFFERENT from:
--   - repost_source_journal_id (reposts — another user's post)
--   - remix_source_journal_id (remix — creative derivative)
-- Parent linkage is specifically for a user continuing their OWN
-- earlier thought. The upload service enforces same-author on insert.
--
-- Index is PARTIAL so it only covers the rows that actually declare
-- a parent — cheap to maintain, fast to walk.
--
-- Additive migration. Safe to re-run (IF NOT EXISTS / DROP FUNCTION
-- IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.journals
    ADD COLUMN IF NOT EXISTS parent_journal_id UUID
    REFERENCES public.journals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journals_parent_journal_id
    ON public.journals(parent_journal_id)
    WHERE parent_journal_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- find_journal_thread(source_id, viewer_user_id, max_depth)
--
-- Returns every post in the thread that contains `source_id`, ordered
-- from root to leaves by depth, then chronologically within a depth.
--
-- Algorithm:
--   1. Walk UP from source_id via parent_journal_id to find the root
--      (the journal with no parent). Depth cap `max_depth` protects
--      against pathological cycles or deep chains.
--   2. Walk DOWN from that root, collecting every descendant.
--
-- Privacy:
--   - `status = 'published'` — drafts never appear in threads.
--   - `(privacy = 'public' OR user_id = viewer_user_id)` — the viewer
--     always sees their own posts, even if private; other users'
--     private posts are omitted. This means a thread may have visible
--     "gaps" to outside viewers, which is the honest behavior: we
--     show what exists, we don't fabricate the gap.
--
-- If source_id does not exist or is a draft, the function returns an
-- empty set (safe default for a post that was just deleted).
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.find_journal_thread(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.find_journal_thread(
    source_id UUID,
    viewer_user_id UUID DEFAULT NULL,
    max_depth INT DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    parent_journal_id UUID,
    title TEXT,
    preview_text TEXT,
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ,
    user_id UUID,
    user_name TEXT,
    user_image_url TEXT,
    user_badge TEXT,
    username TEXT,
    depth INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    root_id UUID;
BEGIN
    -- Walk upward from the source to find the thread root.
    WITH RECURSIVE ancestors AS (
        SELECT j.id, j.parent_journal_id, 0 AS d
        FROM public.journals j
        WHERE j.id = source_id
          AND j.status = 'published'
        UNION ALL
        SELECT j.id, j.parent_journal_id, a.d + 1
        FROM public.journals j
        JOIN ancestors a ON j.id = a.parent_journal_id
        WHERE a.d < max_depth
          AND j.status = 'published'
    )
    SELECT a.id
    INTO root_id
    FROM ancestors a
    WHERE a.parent_journal_id IS NULL
    ORDER BY a.d DESC
    LIMIT 1;

    IF root_id IS NULL THEN
        RETURN;
    END IF;

    -- Walk downward from the root to collect the full thread.
    RETURN QUERY
    WITH RECURSIVE descendants AS (
        SELECT j.id, j.parent_journal_id, 0 AS d
        FROM public.journals j
        WHERE j.id = root_id
          AND j.status = 'published'
        UNION ALL
        SELECT j.id, j.parent_journal_id, c.d + 1
        FROM public.journals j
        JOIN descendants c ON j.parent_journal_id = c.id
        WHERE c.d < max_depth
          AND j.status = 'published'
    )
    SELECT
        j.id,
        j.parent_journal_id,
        j.title,
        j.preview_text,
        j.thumbnail_url,
        j.created_at,
        j.user_id,
        u.name AS user_name,
        u.image_url AS user_image_url,
        u.badge AS user_badge,
        u.username::TEXT,
        c.d AS depth
    FROM descendants c
    JOIN public.journals j ON j.id = c.id
    LEFT JOIN public.users u ON u.id = j.user_id
    WHERE (j.privacy = 'public' OR j.user_id = viewer_user_id)
    ORDER BY c.d ASC, j.created_at ASC;
END;
$$;
