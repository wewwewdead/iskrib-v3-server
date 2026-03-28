-- Pinned Posts: allow users to pin up to 3 posts to the top of their profile
-- Composite PK prevents duplicate pins. Position column controls display order.
-- FK CASCADE handles cleanup on journal or user deletion.

CREATE TABLE IF NOT EXISTS pinned_posts (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    journal_id UUID NOT NULL REFERENCES public.journals(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 1,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, journal_id)
);

-- Fast lookup of a user's pinned posts ordered by position
CREATE INDEX IF NOT EXISTS idx_pinned_posts_user_position
    ON public.pinned_posts(user_id, position ASC);

-- Enable RLS
ALTER TABLE public.pinned_posts ENABLE ROW LEVEL SECURITY;

-- Users can read their own pins
CREATE POLICY "Users can read own pins"
    ON public.pinned_posts FOR SELECT
    USING (auth.uid() = user_id);

-- Anyone can read pins (for visited profiles)
CREATE POLICY "Anyone can read pins"
    ON public.pinned_posts FOR SELECT
    USING (true);

-- Users can insert their own pins
CREATE POLICY "Users can insert own pins"
    ON public.pinned_posts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own pins (reorder)
CREATE POLICY "Users can update own pins"
    ON public.pinned_posts FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own pins
CREATE POLICY "Users can delete own pins"
    ON public.pinned_posts FOR DELETE
    USING (auth.uid() = user_id);
