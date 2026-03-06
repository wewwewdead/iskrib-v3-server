-- Personalized Feed: For You + Interest-Based Explore
-- Run this in the Supabase SQL editor
-- Safe to re-run (uses CREATE OR REPLACE / IF NOT EXISTS)

-- 1. Add interests_embedding column to users
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS interests_embedding vector(384);

-- 2. Create topic_embeddings lookup table (canonical topics from onboarding)
CREATE TABLE IF NOT EXISTS public.topic_embeddings (
    topic TEXT PRIMARY KEY,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. IVFFlat index on users.interests_embedding for fast cosine similarity
-- (lists=10 is fine for < 50k users; bump to sqrt(n) when user base grows)
CREATE INDEX IF NOT EXISTS idx_users_interests_embedding
ON public.users
USING ivfflat (interests_embedding vector_cosine_ops)
WITH (lists = 10);

-- 4. RPC: get_for_you_feed
-- Cosine similarity between user's interests_embedding and journal embeddings
-- Composite score: 80% semantic + 10% engagement + 10% recency (90-day window)
-- Excludes own posts & reposts, minimum 0.30 similarity floor, cursor pagination
DO $$ BEGIN
    DROP FUNCTION IF EXISTS public.get_for_you_feed(UUID, INT, TIMESTAMPTZ);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
    DROP FUNCTION IF EXISTS public.get_for_you_feed(UUID, INT, INT);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.get_for_you_feed(
    p_user_id UUID,
    p_limit INT DEFAULT 10,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    title TEXT,
    preview_text TEXT,
    thumbnail_url TEXT,
    post_type TEXT,
    created_at TIMESTAMPTZ,
    privacy TEXT,
    views BIGINT,
    is_repost BOOLEAN,
    repost_source_journal_id UUID,
    repost_caption TEXT,
    prompt_id INTEGER,
    user_obj_id UUID,
    user_name TEXT,
    user_image_url TEXT,
    user_badge TEXT,
    like_count BIGINT,
    reaction_count BIGINT,
    comment_count BIGINT,
    bookmark_count BIGINT,
    semantic_similarity FLOAT,
    composite_score FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    user_embedding vector(384);
    max_hot BIGINT;
BEGIN
    -- Get user's interests embedding
    SELECT u.interests_embedding
    INTO user_embedding
    FROM public.users u
    WHERE u.id = p_user_id;

    -- If no embedding, return empty
    IF user_embedding IS NULL THEN
        RETURN;
    END IF;

    -- Get max hot score for normalization
    SELECT COALESCE(MAX(
        COALESCE(j2.views, 0)::bigint * 6
        + j2.cached_reaction_count::bigint * 3
        + j2.cached_comment_count::bigint * 2
        + j2.cached_bookmark_count::bigint * 2
    ), 1)
    INTO max_hot
    FROM public.journals j2
    WHERE j2.privacy = 'public'
      AND j2.embeddings IS NOT NULL
      AND j2.created_at >= now() - interval '90 days';

    RETURN QUERY
    SELECT
        j.id,
        j.user_id,
        j.title::TEXT,
        j.preview_text::TEXT,
        j.thumbnail_url::TEXT,
        j.post_type::TEXT,
        j.created_at,
        j.privacy::TEXT,
        coalesce(j.views, 0)::bigint AS views,
        j.is_repost,
        j.repost_source_journal_id,
        j.repost_caption::TEXT,
        j.prompt_id,
        u.id AS user_obj_id,
        u.name::TEXT AS user_name,
        u.image_url::TEXT AS user_image_url,
        u.badge::TEXT AS user_badge,
        j.cached_reaction_count::bigint AS like_count,
        j.cached_reaction_count::bigint AS reaction_count,
        j.cached_comment_count::bigint AS comment_count,
        j.cached_bookmark_count::bigint AS bookmark_count,
        (1 - (j.embeddings <=> user_embedding))::FLOAT AS semantic_similarity,
        (
            0.80 * (1 - (j.embeddings <=> user_embedding))::FLOAT
            + 0.10 * ((COALESCE(j.views, 0) * 6 + j.cached_reaction_count * 3 + j.cached_comment_count * 2 + j.cached_bookmark_count * 2)::FLOAT / GREATEST(max_hot, 1))
            + 0.10 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - j.created_at)) / (90 * 86400.0))
        ) AS composite_score
    FROM public.journals j
    LEFT JOIN public.users u ON u.id = j.user_id
    WHERE j.privacy = 'public'
      AND j.embeddings IS NOT NULL
      AND j.user_id != p_user_id
      AND COALESCE(j.is_repost, false) = false
      AND (1 - (j.embeddings <=> user_embedding)) >= 0.30
      AND j.created_at >= now() - interval '90 days'
    ORDER BY (
        0.80 * (1 - (j.embeddings <=> user_embedding))::FLOAT
        + 0.10 * ((COALESCE(j.views, 0) * 6 + j.cached_reaction_count * 3 + j.cached_comment_count * 2 + j.cached_bookmark_count * 2)::FLOAT / GREATEST(max_hot, 1))
        + 0.10 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - j.created_at)) / (90 * 86400.0))
    ) DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- 5. RPC: get_interest_posts
-- Finds posts matching a single topic embedding
-- Composite score: 50% semantic + 35% engagement + 15% recency, 30-day default window
DO $$ BEGIN
    DROP FUNCTION IF EXISTS public.get_interest_posts(vector(384), INT, INT);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.get_interest_posts(
    p_topic_embedding vector(384),
    p_limit INT DEFAULT 8,
    p_recency_days INT DEFAULT 30
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    title TEXT,
    preview_text TEXT,
    thumbnail_url TEXT,
    post_type TEXT,
    created_at TIMESTAMPTZ,
    views BIGINT,
    user_name TEXT,
    user_image_url TEXT,
    user_badge TEXT,
    username TEXT,
    like_count BIGINT,
    comment_count BIGINT,
    bookmark_count BIGINT,
    semantic_similarity FLOAT,
    composite_score FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    max_hot BIGINT;
BEGIN
    -- Get max hot score for normalization
    SELECT COALESCE(MAX(
        COALESCE(j2.views, 0)::bigint * 6
        + j2.cached_reaction_count::bigint * 3
        + j2.cached_comment_count::bigint * 2
        + j2.cached_bookmark_count::bigint * 2
    ), 1)
    INTO max_hot
    FROM public.journals j2
    WHERE j2.privacy = 'public'
      AND j2.embeddings IS NOT NULL
      AND j2.created_at >= now() - (p_recency_days || ' days')::interval;

    RETURN QUERY
    WITH candidates AS (
        SELECT
            j.id,
            j.user_id,
            j.title::TEXT,
            j.preview_text::TEXT,
            j.thumbnail_url::TEXT,
            j.post_type::TEXT,
            j.created_at,
            coalesce(j.views, 0)::bigint AS views,
            u.name::TEXT AS user_name,
            u.image_url::TEXT AS user_image_url,
            u.badge::TEXT AS user_badge,
            u.username::TEXT,
            j.cached_reaction_count::bigint AS like_count,
            j.cached_comment_count::bigint AS comment_count,
            j.cached_bookmark_count::bigint AS bookmark_count,
            (1 - (j.embeddings <=> p_topic_embedding))::FLOAT AS sem_sim,
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
          AND COALESCE(j.is_repost, false) = false
          AND (1 - (j.embeddings <=> p_topic_embedding)) >= 0.30
          AND j.created_at >= now() - (p_recency_days || ' days')::interval
        ORDER BY j.embeddings <=> p_topic_embedding
        LIMIT p_limit * 3
    )
    SELECT
        c.id,
        c.user_id,
        c.title,
        c.preview_text,
        c.thumbnail_url,
        c.post_type,
        c.created_at,
        c.views,
        c.user_name,
        c.user_image_url,
        c.user_badge,
        c.username,
        c.like_count,
        c.comment_count,
        c.bookmark_count,
        c.sem_sim AS semantic_similarity,
        (
            0.50 * c.sem_sim
            + 0.35 * (c.h_score::FLOAT / GREATEST(max_hot, 1))
            + 0.15 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - c.created_at)) / (p_recency_days * 86400.0))
        ) AS composite_score
    FROM candidates c
    ORDER BY (
        0.50 * c.sem_sim
        + 0.35 * (c.h_score::FLOAT / GREATEST(max_hot, 1))
        + 0.15 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - c.created_at)) / (p_recency_days * 86400.0))
    ) DESC
    LIMIT p_limit;
END;
$$;
