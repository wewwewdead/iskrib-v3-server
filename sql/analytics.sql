-- ─── Writer Analytics RPC ───
-- Returns comprehensive analytics for a writer within a date range.
-- Aggregates views, reactions, top posts, publishing frequency, and streaks.

CREATE OR REPLACE FUNCTION get_writer_analytics(
    p_user_id UUID,
    p_range_start TIMESTAMPTZ,
    p_range_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_summary JSONB;
    v_views_series JSONB;
    v_reactions_series JSONB;
    v_reaction_breakdown JSONB;
    v_top_posts JSONB;
    v_publishing_freq JSONB;
    v_streak JSONB;
BEGIN
    -- ── Summary: totals for this writer within date range ──
    SELECT jsonb_build_object(
        'total_posts', COUNT(*)::INT,
        'total_views', COALESCE(SUM(COALESCE(j.views, 0)), 0)::INT,
        'total_reactions', COALESCE(SUM(COALESCE(j.cached_reaction_count, 0)), 0)::INT,
        'total_comments', COALESCE(SUM(COALESCE(j.cached_comment_count, 0)), 0)::INT,
        'total_bookmarks', COALESCE(SUM(COALESCE(j.cached_bookmark_count, 0)), 0)::INT,
        'avg_engagement_rate', CASE
            WHEN COALESCE(SUM(COALESCE(j.views, 0)), 0) = 0 THEN 0
            ELSE ROUND(
                (COALESCE(SUM(COALESCE(j.cached_reaction_count, 0)), 0)::NUMERIC
                 + COALESCE(SUM(COALESCE(j.cached_comment_count, 0)), 0)::NUMERIC
                 + COALESCE(SUM(COALESCE(j.cached_bookmark_count, 0)), 0)::NUMERIC)
                / NULLIF(SUM(COALESCE(j.views, 0)), 0)::NUMERIC * 100, 1
            )
        END
    ) INTO v_summary
    FROM journals j
    WHERE j.user_id = p_user_id
      AND j.privacy = 'public'
      AND j.created_at >= p_range_start
      AND j.created_at < p_range_end;

    -- ── Views time series: daily counts from journal_views ──
    SELECT COALESCE(jsonb_agg(row_data ORDER BY day), '[]'::JSONB)
    INTO v_views_series
    FROM (
        SELECT jsonb_build_object(
            'date', d.day::DATE,
            'count', COALESCE(v.cnt, 0)
        ) AS row_data, d.day
        FROM generate_series(p_range_start::DATE, p_range_end::DATE, '1 day'::INTERVAL) AS d(day)
        LEFT JOIN (
            SELECT DATE(jv.created_at) AS view_date, COUNT(*)::INT AS cnt
            FROM journal_views jv
            JOIN journals j ON j.id = jv.journal_id
            WHERE j.user_id = p_user_id
              AND jv.created_at >= p_range_start
              AND jv.created_at < p_range_end
            GROUP BY DATE(jv.created_at)
        ) v ON v.view_date = d.day::DATE
    ) sub;

    -- ── Reactions time series: daily counts ──
    SELECT COALESCE(jsonb_agg(row_data ORDER BY day), '[]'::JSONB)
    INTO v_reactions_series
    FROM (
        SELECT jsonb_build_object(
            'date', d.day::DATE,
            'count', COALESCE(r.cnt, 0)
        ) AS row_data, d.day
        FROM generate_series(p_range_start::DATE, p_range_end::DATE, '1 day'::INTERVAL) AS d(day)
        LEFT JOIN (
            SELECT DATE(rx.created_at) AS react_date, COUNT(*)::INT AS cnt
            FROM reactions rx
            JOIN journals j ON j.id = rx.journal_id
            WHERE j.user_id = p_user_id
              AND rx.created_at >= p_range_start
              AND rx.created_at < p_range_end
            GROUP BY DATE(rx.created_at)
        ) r ON r.react_date = d.day::DATE
    ) sub;

    -- ── Reaction breakdown by type ──
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type', rx.reaction_type,
        'count', rx.cnt
    ) ORDER BY rx.cnt DESC), '[]'::JSONB)
    INTO v_reaction_breakdown
    FROM (
        SELECT r.reaction_type, COUNT(*)::INT AS cnt
        FROM reactions r
        JOIN journals j ON j.id = r.journal_id
        WHERE j.user_id = p_user_id
          AND r.created_at >= p_range_start
          AND r.created_at < p_range_end
        GROUP BY r.reaction_type
    ) rx;

    -- ── Top 10 posts by engagement score within range ──
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'journal_id', t.id,
        'title', t.title,
        'created_at', t.created_at,
        'views', t.views,
        'reactions', t.cached_reaction_count,
        'comments', t.cached_comment_count,
        'bookmarks', t.cached_bookmark_count,
        'preview_text', t.preview_text,
        'thumbnail_url', t.thumbnail_url,
        'score', t.score
    ) ORDER BY t.score DESC), '[]'::JSONB)
    INTO v_top_posts
    FROM (
        SELECT j.id, j.title, j.created_at, COALESCE(j.views, 0) AS views,
               COALESCE(j.cached_reaction_count, 0) AS cached_reaction_count,
               COALESCE(j.cached_comment_count, 0) AS cached_comment_count,
               COALESCE(j.cached_bookmark_count, 0) AS cached_bookmark_count,
               j.preview_text, j.thumbnail_url,
               (COALESCE(j.views, 0) * 1
                + COALESCE(j.cached_reaction_count, 0) * 3
                + COALESCE(j.cached_comment_count, 0) * 2
                + COALESCE(j.cached_bookmark_count, 0) * 2) AS score
        FROM journals j
        WHERE j.user_id = p_user_id
          AND j.privacy = 'public'
          AND j.created_at >= p_range_start
          AND j.created_at < p_range_end
        ORDER BY score DESC
        LIMIT 10
    ) t;

    -- ── Publishing frequency: posts per week within range ──
    SELECT COALESCE(jsonb_agg(row_data ORDER BY week_start), '[]'::JSONB)
    INTO v_publishing_freq
    FROM (
        SELECT jsonb_build_object(
            'week_start', d.week_start::DATE,
            'count', COALESCE(p.cnt, 0)
        ) AS row_data, d.week_start
        FROM generate_series(
            DATE_TRUNC('week', p_range_start::DATE),
            DATE_TRUNC('week', p_range_end::DATE),
            '1 week'::INTERVAL
        ) AS d(week_start)
        LEFT JOIN (
            SELECT DATE_TRUNC('week', j.created_at)::DATE AS pub_week, COUNT(*)::INT AS cnt
            FROM journals j
            WHERE j.user_id = p_user_id
              AND j.privacy = 'public'
              AND j.created_at >= p_range_start
              AND j.created_at < p_range_end
            GROUP BY DATE_TRUNC('week', j.created_at)::DATE
        ) p ON p.pub_week = d.week_start::DATE
    ) sub;

    -- ── Streak data ──
    SELECT jsonb_build_object(
        'current_streak', COALESCE(ws.current_streak, 0),
        'longest_streak', COALESCE(ws.longest_streak, 0)
    ) INTO v_streak
    FROM writing_streaks ws
    WHERE ws.user_id = p_user_id;

    -- If no streak row, default
    IF v_streak IS NULL THEN
        v_streak := jsonb_build_object('current_streak', 0, 'longest_streak', 0);
    END IF;

    RETURN jsonb_build_object(
        'summary', v_summary,
        'views_series', v_views_series,
        'reactions_series', v_reactions_series,
        'reaction_breakdown', v_reaction_breakdown,
        'top_posts', v_top_posts,
        'publishing_frequency', v_publishing_freq,
        'streak', v_streak
    );
END;
$$;
