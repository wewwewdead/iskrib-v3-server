-- Stories embedding support (384-dim vectors via Supabase/gte-small)
-- Run in Supabase SQL Editor after stories.sql

-- 1. Add embedding column
ALTER TABLE public.stories
ADD COLUMN IF NOT EXISTS embedding vector(384);

-- 2. IVFFlat index for cosine similarity on public stories
CREATE INDEX IF NOT EXISTS stories_embedding_ivfflat_idx
ON public.stories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100)
WHERE privacy = 'public' AND embedding IS NOT NULL;

-- 3. RPC function for similarity search (mirrors match_public_journals)
CREATE OR REPLACE FUNCTION public.match_public_stories(
    query_embedding vector(384),
    match_count int DEFAULT 20,
    similarity_threshold float DEFAULT 0.35
)
RETURNS TABLE (
    id uuid,
    similarity float
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        s.id,
        1 - (s.embedding <=> query_embedding) AS similarity
    FROM public.stories s
    WHERE s.privacy = 'public'
      AND s.embedding IS NOT NULL
      AND 1 - (s.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY s.embedding <=> query_embedding
    LIMIT greatest(match_count, 1);
$$;
