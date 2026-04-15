-- ═══════════════════════════════════════════════════════════════════
-- Thread pagination (V3 — paginated "Continue this thought" reads)
--
-- Re-declares find_journal_thread to accept `page_limit` / `page_offset`
-- and expose a `total_count` column computed via `COUNT(*) OVER ()` so
-- the client knows in a single round trip how many rows exist in the
-- full thread beyond the current page.
--
-- Contract for callers:
--   - page_limit = NULL → return every row (preserves the old web-app
--     call shape exactly). `total_count` still comes back on every row.
--   - page_limit >= 1   → return up to page_limit rows starting at
--     page_offset (0-based). Mobile card uses limit=4 as a probe;
--     mobile ThreadScreen uses limit=20 with increasing offsets via
--     useInfiniteQuery.
--
-- Cross-user threading: threads may span multiple authors. The walk
-- follows parent_journal_id regardless of who owns each row; only the
-- per-row privacy check gates visibility at read time.
-- Additive migration. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.find_journal_thread(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.find_journal_thread(uuid, uuid, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.find_journal_thread(
    source_id UUID,
    viewer_user_id UUID DEFAULT NULL,
    max_depth INT DEFAULT 50,
    page_limit INT DEFAULT NULL,
    page_offset INT DEFAULT 0
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
    depth INT,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    thread_root UUID;
    effective_limit INT;
    effective_offset INT;
BEGIN
    SELECT COALESCE(j.root_journal_id, j.id)
    INTO thread_root
    FROM public.journals j
    WHERE j.id = source_id
      AND j.status = 'published';

    IF thread_root IS NULL THEN
        RETURN;
    END IF;

    effective_offset := GREATEST(COALESCE(page_offset, 0), 0);
    effective_limit := page_limit;  -- NULL means unlimited, handled by NULLIF below

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
    ),
    visible AS (
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
            u.username::TEXT AS username,
            c.d AS depth
        FROM descendants c
        JOIN public.journals j ON j.id = c.id
        LEFT JOIN public.users u ON u.id = j.user_id
        WHERE (j.privacy = 'public' OR j.user_id = viewer_user_id)
    ),
    counted AS (
        SELECT v.*, COUNT(*) OVER () AS total_count
        FROM visible v
    )
    SELECT
        counted.id,
        counted.parent_journal_id,
        counted.root_journal_id,
        counted.title,
        counted.preview_text,
        counted.thumbnail_url,
        counted.created_at,
        counted.user_id,
        counted.user_name,
        counted.user_image_url,
        counted.user_badge,
        counted.username,
        counted.depth,
        counted.total_count
    FROM counted
    ORDER BY counted.depth ASC, counted.created_at ASC
    LIMIT effective_limit  -- NULL means no limit in Postgres
    OFFSET effective_offset;
END;
$$;
