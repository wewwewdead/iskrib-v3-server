-- Semantic search setup for Supabase pgvector + Supabase/gte-small (384 dimensions)
-- Run this in the Supabase SQL editor.

create extension if not exists vector;

create index if not exists journals_embeddings_ivfflat_idx
on public.journals
using ivfflat (embeddings vector_cosine_ops)
with (lists = 100)
where privacy = 'public' and embeddings is not null;

create or replace function public.match_public_journals(
    query_embedding vector(384),
    match_count int default 20,
    similarity_threshold float default 0.35
)
returns table (
    id bigint,
    similarity float
)
language sql
stable
as $$
    select
        j.id,
        1 - (j.embeddings <=> query_embedding) as similarity
    from public.journals j
    where j.privacy = 'public'
      and j.embeddings is not null
      and 1 - (j.embeddings <=> query_embedding) >= similarity_threshold
    order by j.embeddings <=> query_embedding
    limit greatest(match_count, 1);
$$;
