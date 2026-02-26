-- Emoji Reactions table (replaces likes)
CREATE TABLE IF NOT EXISTS reactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    journal_id UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL CHECK (reaction_type IN ('fire','heart','mind_blown','clap','laugh','sad')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (journal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_journal_id ON reactions(journal_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user_id ON reactions(user_id);

-- Add cached_reaction_count to journals
ALTER TABLE journals ADD COLUMN IF NOT EXISTS cached_reaction_count INT NOT NULL DEFAULT 0;

-- Add reaction_type to notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reaction_type TEXT;

-- ─── Trigger to maintain cached_reaction_count ───
CREATE OR REPLACE FUNCTION trg_update_journal_reaction_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE journals SET cached_reaction_count = cached_reaction_count + 1
        WHERE id = NEW.journal_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE journals SET cached_reaction_count = GREATEST(cached_reaction_count - 1, 0)
        WHERE id = OLD.journal_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Reaction type changed, count stays the same
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reactions_count ON reactions;
CREATE TRIGGER trg_reactions_count
    AFTER INSERT OR DELETE ON reactions
    FOR EACH ROW EXECUTE FUNCTION trg_update_journal_reaction_count();

-- ─── Migrate existing likes → reactions (type='heart') ───
-- Run this ONCE to backfill:
-- INSERT INTO reactions (journal_id, user_id, reaction_type, created_at)
-- SELECT journal_id, user_id, 'heart', created_at
-- FROM likes
-- ON CONFLICT (journal_id, user_id) DO NOTHING;

-- ─── Backfill cached_reaction_count from reactions table ───
-- UPDATE journals j SET cached_reaction_count = (
--     SELECT COUNT(*) FROM reactions r WHERE r.journal_id = j.id
-- );

-- ─── RPC: get reactions breakdown for a post ───
CREATE OR REPLACE FUNCTION get_post_reactions(p_journal_id UUID)
RETURNS JSONB AS $$
BEGIN
    RETURN (
        SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
        FROM (
            SELECT jsonb_build_object(
                'reaction_type', r.reaction_type,
                'count', COUNT(*),
                'reactors', jsonb_agg(
                    jsonb_build_object(
                        'user_id', r.user_id,
                        'name', u.name,
                        'image_url', u.image_url
                    )
                    ORDER BY r.created_at DESC
                )
            ) AS row_data
            FROM reactions r
            JOIN users u ON u.id = r.user_id
            WHERE r.journal_id = p_journal_id
            GROUP BY r.reaction_type
            ORDER BY COUNT(*) DESC
        ) sub
    );
END;
$$ LANGUAGE plpgsql;
