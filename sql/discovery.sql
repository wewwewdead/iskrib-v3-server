-- Discovery System: Related Posts Engine
-- Run this in the Supabase SQL editor
-- Safe to re-run (uses CREATE OR REPLACE)

-- find_related_posts: returns ranked related posts using composite scoring
-- 85% semantic similarity, 10% engagement (hot score), 5% recency
DROP FUNCTION IF EXISTS public.find_related_posts;
CREATE OR REPLACE FUNCTION public.find_related_posts(
    source_post_id UUID,
    match_count INT DEFAULT 8,
    similarity_floor FLOAT DEFAULT 0.40,
    recency_days INT DEFAULT 365
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    content JSONB,
    post_type TEXT,
    canvas_doc JSONB,
    created_at TIMESTAMPTZ,
    user_id UUID,
    user_name TEXT,
    user_image_url TEXT,
    user_badge TEXT,
    username TEXT,
    semantic_similarity FLOAT,
    hot_score BIGINT,
    composite_score FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    source_embedding vector(384);
    source_user_id UUID;
    max_hot BIGINT;
BEGIN
    -- Get the source post's embedding and author
    SELECT j.embeddings, j.user_id
    INTO source_embedding, source_user_id
    FROM public.journals j
    WHERE j.id = source_post_id;

    -- If no embedding, return empty
    IF source_embedding IS NULL THEN
        RETURN;
    END IF;

    -- Get max hot score for normalization
    SELECT COALESCE(MAX(
        COALESCE(j2.views, 0) * 6
        + j2.cached_reaction_count * 3
        + j2.cached_comment_count * 2
        + j2.cached_bookmark_count * 2
    ), 1)
    INTO max_hot
    FROM public.journals j2
    WHERE j2.privacy = 'public'
      AND j2.embeddings IS NOT NULL;

    RETURN QUERY
    WITH candidates AS (
        SELECT
            j.id,
            j.title,
            j.content::JSONB,
            j.post_type,
            j.canvas_doc,
            j.created_at,
            j.user_id,
            u.name AS user_name,
            u.image_url AS user_image_url,
            u.badge AS user_badge,
            u.username::TEXT,
            (1 - (j.embeddings <=> source_embedding))::FLOAT AS sem_sim,
            (
                COALESCE(j.views, 0) * 6
                + j.cached_reaction_count * 3
                + j.cached_comment_count * 2
                + j.cached_bookmark_count * 2
            )::BIGINT AS h_score
        FROM public.journals j
        LEFT JOIN public.users u ON u.id = j.user_id
        WHERE j.privacy = 'public'
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
        c.content,
        c.post_type,
        c.canvas_doc,
        c.created_at,
        c.user_id,
        c.user_name,
        c.user_image_url,
        c.user_badge,
        c.username,
        c.sem_sim AS semantic_similarity,
        c.h_score AS hot_score,
        (
            -- 85% semantic similarity
            0.85 * c.sem_sim
            -- 10% normalized engagement
            + 0.10 * (c.h_score::FLOAT / GREATEST(max_hot, 1))
            -- 5% recency (decay over recency_days)
            + 0.05 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - c.created_at)) / (recency_days * 86400.0))
        )
        -- Penalize same-author posts by 15%
        * CASE WHEN c.user_id = source_user_id THEN 0.85 ELSE 1.0 END
        AS composite_score
    FROM candidates c
    ORDER BY composite_score DESC
    LIMIT match_count;
END;
$$;
