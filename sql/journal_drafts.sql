-- Journal Drafts: Add status column + published_at to journals
-- Run this in the Supabase SQL editor
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE)
-- Zero-downtime: DEFAULT 'published' means all existing rows are immediately correct

-- 1. Add status column
ALTER TABLE public.journals
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';

-- Add check constraint (idempotent via DO block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'journals_status_check'
    ) THEN
        ALTER TABLE public.journals
        ADD CONSTRAINT journals_status_check CHECK (status IN ('draft', 'published'));
    END IF;
END $$;

-- 2. Add updated_at column (journals table didn't have one)
ALTER TABLE public.journals
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill updated_at for existing rows
UPDATE public.journals
SET updated_at = created_at
WHERE updated_at = now() AND created_at IS NOT NULL;

-- Auto-update trigger (reuse if already exists from stories)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_journals_updated_at ON public.journals;
CREATE TRIGGER trigger_journals_updated_at
    BEFORE UPDATE ON public.journals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Add published_at column
ALTER TABLE public.journals
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ DEFAULT NULL;

-- 4. Backfill published_at for existing published posts
UPDATE public.journals
SET published_at = created_at
WHERE status = 'published' AND published_at IS NULL;

-- 5. Indexes for draft queries
CREATE INDEX IF NOT EXISTS idx_journals_drafts
ON public.journals(user_id, status, updated_at DESC)
WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_journals_published_feed
ON public.journals(privacy, created_at DESC)
WHERE status = 'published' AND privacy = 'public';

-- 6. Update RPCs to exclude drafts

-- 5a. get_following_feed
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
    preview_text TEXT,
    thumbnail_url TEXT,
    post_type TEXT,
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
        j.preview_text,
        j.thumbnail_url,
        j.post_type,
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
        j.cached_reaction_count::bigint AS like_count,
        j.cached_reaction_count::bigint AS reaction_count,
        j.cached_comment_count::bigint AS comment_count,
        j.cached_bookmark_count::bigint AS bookmark_count
    FROM public.journals j
    INNER JOIN public.follows f ON f.following_id = j.user_id AND f.follower_id = p_user_id
    LEFT JOIN public.users u ON u.id = j.user_id
    WHERE j.privacy = 'public'
      AND j.status = 'published'
      AND (p_before IS NULL OR j.created_at < p_before)
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT p_limit;
$$;

-- 5b. get_for_you_feed
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
    SELECT u.interests_embedding
    INTO user_embedding
    FROM public.users u
    WHERE u.id = p_user_id;

    IF user_embedding IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(MAX(
        COALESCE(j2.views, 0)::bigint * 6
        + j2.cached_reaction_count::bigint * 3
        + j2.cached_comment_count::bigint * 2
        + j2.cached_bookmark_count::bigint * 2
    ), 1)
    INTO max_hot
    FROM public.journals j2
    WHERE j2.privacy = 'public'
      AND j2.status = 'published'
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
      AND j.status = 'published'
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

-- 5c. get_interest_posts
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
    SELECT COALESCE(MAX(
        COALESCE(j2.views, 0)::bigint * 6
        + j2.cached_reaction_count::bigint * 3
        + j2.cached_comment_count::bigint * 2
        + j2.cached_bookmark_count::bigint * 2
    ), 1)
    INTO max_hot
    FROM public.journals j2
    WHERE j2.privacy = 'public'
      AND j2.status = 'published'
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
          AND j.status = 'published'
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

-- 5d. get_monthly_hottest_journals
DROP FUNCTION IF EXISTS public.get_monthly_hottest_journals(integer);
CREATE OR REPLACE FUNCTION public.get_monthly_hottest_journals(
    p_limit int default 10
)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    title text,
    preview_text text,
    thumbnail_url text,
    post_type text,
    created_at timestamptz,
    privacy text,
    views bigint,
    is_repost boolean,
    repost_source_journal_id uuid,
    repost_caption text,
    user_name text,
    user_image_url text,
    user_badge text,
    like_count bigint,
    comment_count bigint,
    bookmark_count bigint,
    hot_score bigint
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
        j.preview_text,
        j.thumbnail_url,
        j.post_type,
        j.created_at,
        j.privacy,
        coalesce(j.views, 0)::bigint as views,
        j.is_repost,
        j.repost_source_journal_id,
        j.repost_caption,
        u.name as user_name,
        u.image_url as user_image_url,
        u.badge as user_badge,
        j.cached_reaction_count::bigint as like_count,
        j.cached_comment_count::bigint as comment_count,
        j.cached_bookmark_count::bigint as bookmark_count,
        (coalesce(j.views, 0)::bigint * 6)
            + (j.cached_reaction_count::bigint * 3)
            + (j.cached_comment_count::bigint * 2)
            + (j.cached_bookmark_count::bigint * 2) as hot_score
    FROM public.journals j
    INNER JOIN public.users u ON u.id = j.user_id
    WHERE j.privacy = 'public'
      AND j.status = 'published'
      AND j.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
      AND j.created_at <  (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC'
    ORDER BY hot_score DESC, j.created_at DESC, j.id DESC
    LIMIT p_limit;
$$;

-- 5e. find_related_posts (discovery)
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
    SELECT j.embeddings, j.user_id
    INTO source_embedding, source_user_id
    FROM public.journals j
    WHERE j.id = source_post_id;

    IF source_embedding IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(MAX(
        COALESCE(j2.views, 0) * 6
        + j2.cached_reaction_count * 3
        + j2.cached_comment_count * 2
        + j2.cached_bookmark_count * 2
    ), 1)
    INTO max_hot
    FROM public.journals j2
    WHERE j2.privacy = 'public'
      AND j2.status = 'published'
      AND j2.embeddings IS NOT NULL;

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
        c.h_score AS hot_score,
        (
            0.85 * c.sem_sim
            + 0.10 * (c.h_score::FLOAT / GREATEST(max_hot, 1))
            + 0.05 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - c.created_at)) / (recency_days * 86400.0))
        )
        * CASE WHEN c.user_id = source_user_id THEN 0.85 ELSE 1.0 END
        AS composite_score
    FROM candidates c
    ORDER BY composite_score DESC
    LIMIT match_count;
END;
$$;

-- 5f. match_public_journals (semantic search)
DROP FUNCTION IF EXISTS public.match_public_journals(vector, integer, double precision);
CREATE OR REPLACE FUNCTION public.match_public_journals(
    query_embedding vector(384),
    match_count int default 20,
    similarity_threshold float default 0.35
)
RETURNS TABLE (
    id uuid,
    similarity float
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        j.id,
        1 - (j.embeddings <=> query_embedding) as similarity
    FROM public.journals j
    WHERE j.privacy = 'public'
      AND j.status = 'published'
      AND j.embeddings IS NOT NULL
      AND 1 - (j.embeddings <=> query_embedding) >= similarity_threshold
    ORDER BY j.embeddings <=> query_embedding
    LIMIT greatest(match_count, 1);
$$;
