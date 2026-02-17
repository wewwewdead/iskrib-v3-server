-- Galaxy Gravity System: Embedding-based spatial clustering
-- Run this in the Supabase SQL editor
-- Safe to re-run (uses DROP IF EXISTS + IF NOT EXISTS)

-- 1. Galaxy centroids table
CREATE TABLE IF NOT EXISTS public.galaxy_centroids (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    mean_embedding vector(384),
    galaxy_x FLOAT,
    galaxy_y FLOAT,
    post_count INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Galaxy similarity edges
CREATE TABLE IF NOT EXISTS public.galaxy_edges (
    user_a UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    user_b UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    similarity FLOAT NOT NULL,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
);

-- 3. Settled star positions on journals
ALTER TABLE public.journals
ADD COLUMN IF NOT EXISTS settled_x FLOAT,
ADD COLUMN IF NOT EXISTS settled_y FLOAT;

-- 4. Index for viewport queries on settled coords
CREATE INDEX IF NOT EXISTS journals_settled_coords_idx
ON public.journals (settled_x, settled_y)
WHERE settled_x IS NOT NULL AND settled_y IS NOT NULL AND privacy = 'public';

-- 5. RPC: viewport query (includes both display and original universe coords)
DROP FUNCTION IF EXISTS public.get_universe_posts_viewport;
CREATE FUNCTION public.get_universe_posts_viewport(
    vp_min_x FLOAT, vp_max_x FLOAT,
    vp_min_y FLOAT, vp_max_y FLOAT,
    max_count INT DEFAULT 200
)
RETURNS TABLE (
    id UUID, title TEXT, content TEXT, post_type TEXT,
    canvas_doc JSONB, created_at TIMESTAMPTZ,
    display_x FLOAT, display_y FLOAT,
    universe_x FLOAT, universe_y FLOAT,
    user_id UUID, user_name TEXT, user_image_url TEXT, user_badge TEXT,
    like_count BIGINT
)
LANGUAGE sql STABLE AS $$
    SELECT j.id, j.title, j.content, j.post_type, j.canvas_doc, j.created_at,
           COALESCE(j.settled_x, j.universe_x) AS display_x,
           COALESCE(j.settled_y, j.universe_y) AS display_y,
           j.universe_x, j.universe_y,
           u.id, u.name, u.image_url, u.badge,
           COALESCE(lc.cnt, 0)
    FROM public.journals j
    LEFT JOIN public.users u ON u.id = j.user_id
    LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM public.likes WHERE journal_id = j.id) lc ON true
    WHERE j.privacy = 'public'
      AND COALESCE(j.settled_x, j.universe_x) BETWEEN vp_min_x AND vp_max_x
      AND COALESCE(j.settled_y, j.universe_y) BETWEEN vp_min_y AND vp_max_y
    ORDER BY j.created_at DESC
    LIMIT GREATEST(max_count, 1);
$$;

-- 6. RPC: find similar post pairs for semantic bridges
DROP FUNCTION IF EXISTS public.find_similar_post_pairs;
CREATE FUNCTION public.find_similar_post_pairs(
    post_ids UUID[],
    threshold FLOAT DEFAULT 0.9,
    max_pairs INT DEFAULT 50
)
RETURNS TABLE (post_a UUID, post_b UUID, similarity FLOAT)
LANGUAGE sql STABLE AS $$
    SELECT a.id, b.id, 1 - (a.embeddings <=> b.embeddings)
    FROM public.journals a
    JOIN public.journals b ON b.id > a.id
    WHERE a.id = ANY(post_ids) AND b.id = ANY(post_ids)
      AND a.embeddings IS NOT NULL AND b.embeddings IS NOT NULL
      AND 1 - (a.embeddings <=> b.embeddings) >= threshold
    ORDER BY 3 DESC
    LIMIT max_pairs;
$$;

-- 7. RPC: compute star-to-galaxy pulls for visible posts
DROP FUNCTION IF EXISTS public.get_star_galaxy_pulls;
CREATE FUNCTION public.get_star_galaxy_pulls(
    post_ids UUID[],
    min_similarity FLOAT DEFAULT 0.4,
    max_pulls INT DEFAULT 500
)
RETURNS TABLE (post_id UUID, galaxy_user_id UUID, similarity FLOAT)
LANGUAGE sql STABLE AS $$
    SELECT j.id, gc.user_id, 1 - (j.embeddings <=> gc.mean_embedding)
    FROM public.journals j
    CROSS JOIN public.galaxy_centroids gc
    WHERE j.id = ANY(post_ids)
      AND j.embeddings IS NOT NULL
      AND gc.mean_embedding IS NOT NULL
      AND j.user_id != gc.user_id
      AND 1 - (j.embeddings <=> gc.mean_embedding) >= min_similarity
    ORDER BY 3 DESC
    LIMIT max_pulls;
$$;

-- 8. RPC: find wormhole pairs (semantically identical posts far apart)
DROP FUNCTION IF EXISTS public.find_wormhole_pairs;
CREATE FUNCTION public.find_wormhole_pairs(
    similarity_threshold FLOAT DEFAULT 0.85,
    min_distance FLOAT DEFAULT 0,
    max_pairs INT DEFAULT 15
)
RETURNS TABLE (
    post_a UUID, post_b UUID, similarity FLOAT,
    a_x FLOAT, a_y FLOAT, b_x FLOAT, b_y FLOAT,
    a_title TEXT, b_title TEXT
)
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
    SELECT DISTINCT ON (LEAST(a.id, b.id), GREATEST(a.id, b.id))
        a.id, b.id,
        1 - (a.embeddings <=> b.embeddings),
        COALESCE(a.settled_x, a.universe_x),
        COALESCE(a.settled_y, a.universe_y),
        COALESCE(b.settled_x, b.universe_x),
        COALESCE(b.settled_y, b.universe_y),
        a.title, b.title
    FROM public.journals a
    CROSS JOIN LATERAL (
        SELECT j.id, j.title, j.user_id, j.embeddings,
               j.settled_x, j.settled_y, j.universe_x, j.universe_y
        FROM public.journals j
        WHERE j.privacy = 'public'
          AND j.embeddings IS NOT NULL
          AND j.user_id != a.user_id
        ORDER BY j.embeddings <=> a.embeddings
        LIMIT 5
    ) b
    WHERE a.privacy = 'public'
      AND a.embeddings IS NOT NULL
      AND 1 - (a.embeddings <=> b.embeddings) >= similarity_threshold
    ORDER BY LEAST(a.id, b.id), GREATEST(a.id, b.id),
             1 - (a.embeddings <=> b.embeddings) DESC
    LIMIT max_pairs;
$$;