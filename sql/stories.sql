-- =============================================
-- Stories Feature – Full Schema Migration
-- Run in Supabase SQL Editor
-- =============================================

-- 1. Stories table
CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    cover_url TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed', 'hiatus')),
    tags TEXT[] DEFAULT '{}',
    privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private')),
    read_count INTEGER NOT NULL DEFAULT 0,
    vote_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_author ON stories(author_id);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_privacy ON stories(privacy);
CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at DESC);

-- 2. Chapters table
CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled Chapter',
    content JSONB DEFAULT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(story_id, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_chapters_story ON chapters(story_id);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status);

-- 3. Story comments (paragraph-level)
CREATE TABLE IF NOT EXISTS story_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_id UUID DEFAULT NULL REFERENCES story_comments(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    paragraph_index INTEGER NOT NULL DEFAULT -1,
    paragraph_fingerprint TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_comments_chapter ON story_comments(chapter_id);
CREATE INDEX IF NOT EXISTS idx_story_comments_paragraph ON story_comments(chapter_id, paragraph_index);
CREATE INDEX IF NOT EXISTS idx_story_comments_parent ON story_comments(parent_id);

-- FK to public.users so PostgREST can resolve users(...) joins
ALTER TABLE story_comments
ADD CONSTRAINT story_comments_user_id_public_fkey
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 4. Story votes
CREATE TABLE IF NOT EXISTS story_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_votes_story ON story_votes(story_id);
CREATE INDEX IF NOT EXISTS idx_story_votes_user ON story_votes(user_id);

-- 5. Reading progress
CREATE TABLE IF NOT EXISTS reading_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    scroll_position REAL DEFAULT 0,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id);

-- 6. Story library (reading list / bookmarks)
CREATE TABLE IF NOT EXISTS story_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_library_user ON story_library(user_id);

-- 7. Auto-update triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_stories_updated_at ON stories;
CREATE TRIGGER trigger_stories_updated_at
    BEFORE UPDATE ON stories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_chapters_updated_at ON chapters;
CREATE TRIGGER trigger_chapters_updated_at
    BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
