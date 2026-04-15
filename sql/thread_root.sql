-- ═══════════════════════════════════════════════════════════════════
-- Thread root (V3 — branching "Continue this thought" threads)
--
-- Adds `root_journal_id` — a denormalized pointer to the root of the
-- thread a journal belongs to. Maintained app-side on insert:
--   - Root posts (no parent): root_journal_id = own id
--   - Child posts (has parent): root_journal_id = parent.root_journal_id
--                                                 ?? parent.id
--
-- With this column stored and indexed, finding every post in a thread
-- is a single equality scan instead of a recursive walk-up from each
-- member. The find_journal_thread RPC is re-declared below to take
-- advantage of it, with a fallback for any row whose root_journal_id
-- is still null (pre-migration safety).
--
-- Cross-user threading: threads may span multiple authors. The RPC
-- walks parent_journal_id regardless of ownership and relies only on
-- the per-row privacy check for visibility.
--
-- Additive migration. Safe to re-run. Superseded by thread_pagination.sql
-- in environments that have applied the 5-arg pagination migration.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add the column (nullable during backfill, practically always set after).
ALTER TABLE public.journals
    ADD COLUMN IF NOT EXISTS root_journal_id UUID
    REFERENCES public.journals(id) ON DELETE SET NULL;

-- 2. Index. Partial so it only covers rows that actually declare a root.
CREATE INDEX IF NOT EXISTS idx_journals_root_journal_id
    ON public.journals(root_journal_id)
    WHERE root_journal_id IS NOT NULL;

-- 3. Backfill: compute root_journal_id for every existing row.
--    Start from every current root (parent_journal_id IS NULL) and walk
--    down via parent_journal_id, propagating the root id through.
WITH RECURSIVE chain AS (
    SELECT id, parent_journal_id, id AS root
    FROM public.journals
    WHERE parent_journal_id IS NULL
    UNION ALL
    SELECT j.id, j.parent_journal_id, c.root
    FROM public.journals j
    JOIN chain c ON j.parent_journal_id = c.id
)
UPDATE public.journals j
SET root_journal_id = chain.root
FROM chain
WHERE j.id = chain.id
  AND j.root_journal_id IS NULL;

-- 4. Re-declare find_journal_thread with root_journal_id in the return
--    type, same-user enforcement, and the stored-root fast path.
DROP FUNCTION IF EXISTS public.find_journal_thread(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.find_journal_thread(
    source_id UUID,
    viewer_user_id UUID DEFAULT NULL,
    max_depth INT DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    parent_journal_id UUID,
    root_journal_id UUID,
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
    thread_root UUID;
BEGIN
    -- Prefer the stored root_journal_id; fall back to the source's own
    -- id if the row hasn't been backfilled yet (safety for pre-migration
    -- environments). The source must be published for us to return
    -- anything — drafts are never part of a thread view.
    SELECT COALESCE(j.root_journal_id, j.id)
    INTO thread_root
    FROM public.journals j
    WHERE j.id = source_id
      AND j.status = 'published';

    IF thread_root IS NULL THEN
        RETURN;
    END IF;

    -- Walk descendants from the root with depth tracking. Threads may
    -- span multiple authors; per-row privacy is enforced in the SELECT
    -- below.
    RETURN QUERY
    WITH RECURSIVE descendants AS (
        SELECT j.id, j.parent_journal_id, j.root_journal_id, 0 AS d
        FROM public.journals j
        WHERE j.id = thread_root
          AND j.status = 'published'
        UNION ALL
        SELECT j.id, j.parent_journal_id, j.root_journal_id, c.d + 1
        FROM public.journals j
        JOIN descendants c ON j.parent_journal_id = c.id
        WHERE c.d < max_depth
          AND j.status = 'published'
    )
    SELECT
        j.id,
        j.parent_journal_id,
        j.root_journal_id,
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
