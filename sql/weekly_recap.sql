-- ─── Weekly Recap RPC ───
-- Returns personal + group stats for a given user and week.
-- Week boundary: Monday 00:00 UTC → Sunday 23:59 UTC.
-- Recap windows are based on first publish time so drafts only appear after publishing.

CREATE OR REPLACE FUNCTION get_weekly_recap(p_user_id UUID, p_week_start TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_week_end TIMESTAMPTZ := p_week_start + INTERVAL '7 days';
    v_personal JSONB;
    v_group JSONB;
    v_best_post JSONB;
    v_most_active JSONB;
    v_most_reacted JSONB;
BEGIN
    -- ── Personal stats ──
    SELECT jsonb_build_object(
        'posts_written', COUNT(*)::INT,
        'total_words', COALESCE(SUM(
            GREATEST(length(COALESCE(j.content::TEXT, '')) / 5, 0)
        ), 0)::BIGINT,
        'reactions_received', COALESCE(SUM(j.cached_reaction_count), 0)::BIGINT,
        'views_received', COALESCE(SUM(COALESCE(j.views, 0)), 0)::BIGINT
    ) INTO v_personal
    FROM journals j
    WHERE j.user_id = p_user_id
      AND COALESCE(j.published_at, j.created_at) >= p_week_start
      AND COALESCE(j.published_at, j.created_at) < v_week_end
      AND j.privacy = 'public'
      AND j.status = 'published';

    -- ── Best personal post (most reactions) ──
    SELECT jsonb_build_object(
        'journal_id', j.id,
        'title', j.title,
        'reaction_count', j.cached_reaction_count,
        'view_count', COALESCE(j.views, 0)
    ) INTO v_best_post
    FROM journals j
    WHERE j.user_id = p_user_id
      AND COALESCE(j.published_at, j.created_at) >= p_week_start
      AND COALESCE(j.published_at, j.created_at) < v_week_end
      AND j.privacy = 'public'
      AND j.status = 'published'
    ORDER BY j.cached_reaction_count DESC, COALESCE(j.views, 0) DESC
    LIMIT 1;

    -- ── Group stats: total posts this week ──
    -- ── Most active writer ──
    SELECT jsonb_build_object(
        'total_posts', (
            SELECT COUNT(*)::INT FROM journals
            WHERE COALESCE(published_at, created_at) >= p_week_start
              AND COALESCE(published_at, created_at) < v_week_end
              AND privacy = 'public'
              AND status = 'published'
        ),
        'most_active_writer', (
            SELECT jsonb_build_object(
                'user_id', u.id,
                'name', u.name,
                'username', u.username,
                'avatar', u.image_url,
                'post_count', COUNT(*)::INT
            )
            FROM journals j2
            JOIN users u ON u.id = j2.user_id
            WHERE COALESCE(j2.published_at, j2.created_at) >= p_week_start
              AND COALESCE(j2.published_at, j2.created_at) < v_week_end
              AND j2.privacy = 'public'
              AND j2.status = 'published'
            GROUP BY u.id, u.name, u.username, u.image_url
            ORDER BY COUNT(*) DESC
            LIMIT 1
        ),
        'most_reacted_post', (
            SELECT jsonb_build_object(
                'journal_id', j3.id,
                'title', j3.title,
                'reaction_count', j3.cached_reaction_count,
                'author_name', u2.name,
                'author_avatar', u2.image_url
            )
            FROM journals j3
            JOIN users u2 ON u2.id = j3.user_id
            WHERE COALESCE(j3.published_at, j3.created_at) >= p_week_start
              AND COALESCE(j3.published_at, j3.created_at) < v_week_end
              AND j3.privacy = 'public'
              AND j3.status = 'published'
            ORDER BY j3.cached_reaction_count DESC
            LIMIT 1
        )
    ) INTO v_group;

    RETURN jsonb_build_object(
        'personal', v_personal || COALESCE(jsonb_build_object('best_post', v_best_post), '{}'::JSONB),
        'group', v_group,
        'week_start', p_week_start,
        'week_end', v_week_end
    );
END;
$$;
