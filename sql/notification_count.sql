-- Consolidate notification count into a single RPC call.
-- Returns sum of unread notifications + notification_opinions.
-- This endpoint is polled frequently for the badge count.
-- Run once in Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
    p_user_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_journal_count BIGINT;
    v_opinion_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_journal_count
    FROM public.notifications
    WHERE receiver_id = p_user_id AND read = FALSE;

    SELECT COUNT(*) INTO v_opinion_count
    FROM public.notification_opinions
    WHERE receiver_id = p_user_id AND read = FALSE;

    RETURN COALESCE(v_journal_count, 0) + COALESCE(v_opinion_count, 0);
END;
$$;
