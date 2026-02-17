-- Constellations feature: user-created links between stars in the Universe view

-- 1. Create constellations table
CREATE TABLE constellations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    star_id_a UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    star_id_b UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    user_id_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT different_users CHECK (user_id_a != user_id_b),
    CONSTRAINT different_stars CHECK (star_id_a != star_id_b),
    CONSTRAINT unique_star_pair UNIQUE (star_id_a, star_id_b)
);

CREATE INDEX idx_const_star_a ON constellations(star_id_a);
CREATE INDEX idx_const_star_b ON constellations(star_id_b);
CREATE INDEX idx_const_status ON constellations(status);

-- 2. Add constellation_id to notifications table
ALTER TABLE notifications
ADD COLUMN constellation_id UUID REFERENCES constellations(id) ON DELETE CASCADE DEFAULT NULL;

-- 3. RPC for viewport constellation fetch
DROP FUNCTION IF EXISTS get_viewport_constellations(UUID[]);
CREATE OR REPLACE FUNCTION get_viewport_constellations(post_ids UUID[])
RETURNS TABLE (
    id UUID, star_id_a UUID, star_id_b UUID,
    user_id_a UUID, user_id_b UUID,
    label TEXT, status TEXT, created_at TIMESTAMPTZ,
    a_universe_x REAL, a_universe_y REAL,
    b_universe_x REAL, b_universe_y REAL,
    a_title TEXT, b_title TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.star_id_a, c.star_id_b, c.user_id_a, c.user_id_b,
           c.label, c.status, c.created_at,
           ja.universe_x AS a_universe_x, ja.universe_y AS a_universe_y,
           jb.universe_x AS b_universe_x, jb.universe_y AS b_universe_y,
           ja.title::TEXT AS a_title, jb.title::TEXT AS b_title
    FROM constellations c
    JOIN journals ja ON ja.id = c.star_id_a
    JOIN journals jb ON jb.id = c.star_id_b
    WHERE c.status IN ('accepted', 'pending')
      AND (c.star_id_a = ANY(post_ids) OR c.star_id_b = ANY(post_ids));
END;
$$ LANGUAGE plpgsql STABLE;
