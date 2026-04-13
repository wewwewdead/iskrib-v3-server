-- ═══════════════════════════════════════════════════════════════════
-- Echo Bloom — user-scoped semantic similarity
--
-- find_user_echoes(source_post_id, source_user_id, match_count, similarity_floor)
--   Same algorithm as find_related_posts (pgvector cosine on gte-small 384-dim
--   embeddings) but strictly filtered to posts authored by `source_user_id`.
--   Used by /journal/:id/user-echoes to surface a user's own prior posts
--   that are semantically close to a newly-published post.
--
-- Scoring intentionally simpler than find_related_posts:
--   - pure semantic similarity (no engagement weighting — the user's own
--     archive shouldn't be ranked by popularity)
--   - 5% recency decay boost (slightly prefers recent echoes when ties exist)
--
-- Additive-only migration. Safe to run against an existing database.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.find_user_echoes(uuid, uuid, integer, double precision);
CREATE OR REPLACE FUNCTION public.find_user_echoes(
    source_post_id UUID,
    source_user_id UUID,
    match_count INT DEFAULT 3,
    similarity_floor FLOAT DEFAULT 0.35
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    preview_text TEXT,
    thumbnail_url TEXT,
    post_type TEXT,
    created_at TIMESTAMPTZ,
    user_id UUID,
    user_name TEXT,
    user_image_url TEXT,
    user_badge TEXT,
    username TEXT,
    semantic_similarity FLOAT,
    composite_score FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    source_embedding vector(384);
BEGIN
    -- Fetch source embedding. We do NOT require the source to belong to
    -- source_user_id — the caller may ask "which of MY posts are similar
    -- to THIS post" even when the source was written by someone else.
    SELECT j.embeddings
    INTO source_embedding
    FROM public.journals j
    WHERE j.id = source_post_id;

    IF source_embedding IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT
            j.id,
            j.title,
            j.preview_text,
            j.thumbnail_url,
            j.post_type,
            j.created_at,
            j.user_id,
            u.name AS user_name,
            u.image_url AS user_image_url,
            u.badge AS user_badge,
            u.username::TEXT,
            (1 - (j.embeddings <=> source_embedding))::FLOAT AS sem_sim
        FROM public.journals j
        LEFT JOIN public.users u ON u.id = j.user_id
        WHERE j.user_id = source_user_id
          AND j.status = 'published'
          AND j.embeddings IS NOT NULL
          AND j.id != source_post_id
          AND COALESCE(j.is_repost, false) = false
          AND (1 - (j.embeddings <=> source_embedding)) >= similarity_floor
        ORDER BY j.embeddings <=> source_embedding
        LIMIT match_count * 4
    )
    SELECT
        c.id,
        c.title,
        c.preview_text,
        c.thumbnail_url,
        c.post_type,
        c.created_at,
        c.user_id,
        c.user_name,
        c.user_image_url,
        c.user_badge,
        c.username,
        c.sem_sim AS semantic_similarity,
        (
            0.95 * c.sem_sim
            + 0.05 * GREATEST(
                0,
                1.0 - EXTRACT(EPOCH FROM (now() - c.created_at)) / (365 * 86400.0)
            )
        ) AS composite_score
    FROM candidates c
    ORDER BY composite_score DESC
    LIMIT match_count;
END;
$$;
