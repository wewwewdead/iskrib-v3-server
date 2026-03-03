-- Content Previews: Server-side preview_text and thumbnail_url
-- Run this in the Supabase SQL editor BEFORE deploying the code changes.
-- Safe to re-run (uses IF NOT EXISTS).
--
-- These columns store pre-computed preview data so feed queries
-- no longer need to return the full Lexical JSON content field.

ALTER TABLE public.journals
ADD COLUMN IF NOT EXISTS preview_text TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Index for potential future queries filtering by thumbnail presence
-- (e.g. "posts with images" filter)
CREATE INDEX IF NOT EXISTS idx_journals_preview_text_null
ON public.journals (id)
WHERE preview_text IS NULL;
