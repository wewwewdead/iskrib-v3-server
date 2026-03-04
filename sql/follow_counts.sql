-- Consolidate getFollowsData into a single RPC call.
-- Returns followers_count, following_count, and is_following in one query.
-- Run once in Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.get_follow_data(
    p_user_id UUID,
    p_logged_in_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_followers_count BIGINT;
    v_following_count BIGINT;
    v_is_following BOOLEAN := FALSE;
BEGIN
    SELECT COUNT(*) INTO v_followers_count
    FROM public.follows
    WHERE following_id = p_user_id;

    SELECT COUNT(*) INTO v_following_count
    FROM public.follows
    WHERE follower_id = p_user_id;

    IF p_logged_in_user_id IS NOT NULL THEN
        SELECT EXISTS(
            SELECT 1 FROM public.follows
            WHERE follower_id = p_logged_in_user_id
              AND following_id = p_user_id
        ) INTO v_is_following;
    END IF;

    RETURN json_build_object(
        'followersCount', v_followers_count,
        'followingsCount', v_following_count,
        'isFollowing', v_is_following
    );
END;
$$;
