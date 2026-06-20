import supabase from "./supabase.js";
import { createMediaResponsePayload } from "../utils/mediaVariants.js";

const NOTIFICATION_LIMIT_MIN = 1;
const NOTIFICATION_LIMIT_MAX = 20;
const NOTIFICATION_DEFAULT_LIMIT = 5;

// Target columns are added Phase-2-followup. The fetch falls back to the base
// select if the migration (notification_targets.sql) hasn't run yet, so the
// notification list never breaks on a missing column.
const NOTIFICATION_TARGET_COLUMNS = `target_type, target_id, target_user_id, target_metadata`;

const buildNotificationJournalSelect = (withTargets) => `
    id,
    sender_id,
    receiver_id,
    journal_id,
    repost_journal_id,
    type,
    reaction_type,
    read,
    created_at,
    ${withTargets ? `${NOTIFICATION_TARGET_COLUMNS},` : ""}
    journals!journal_id(
        title,
        preview_text,
        thumbnail_url,
        created_at,
        users(id, name, image_url, badge)
    ),
    users!sender_id(id, name, username, image_url, badge)
`;

/**
 * True when a Postgres/PostgREST error indicates a notification target column
 * doesn't exist yet (migration not applied). Used to fall back safely.
 */
export const isMissingTargetColumnError = (error) => {
    if (!error) return false;
    const code = error.code || "";
    if (code === "42703" || code === "PGRST204") return true;
    const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
    return (
        message.includes("target_type") ||
        message.includes("target_id") ||
        message.includes("target_user_id") ||
        message.includes("target_metadata")
    );
};

/**
 * Central notification creator. Accepts an optional `target` (the object
 * returned by a notificationTargets builder) and spreads it into the insert.
 * If the target columns aren't present yet, it retries without them so the
 * notification is still created.
 */
export const createNotification = async ({ senderId, receiverId, type, target = null, read = false }) => {
    const base = { sender_id: senderId, receiver_id: receiverId, type, read };
    const payload = target ? { ...base, ...target } : base;

    let { error } = await supabase.from("notifications").insert(payload);

    if (error && target && isMissingTargetColumnError(error)) {
        ({ error } = await supabase.from("notifications").insert(base));
    }

    return { error };
};

const NOTIFICATION_OPINION_SELECT = `
    id,
    sender_id,
    receiver_id,
    opinion_id,
    type,
    read,
    created_at,
    opinions!opinion_id(id, opinion, user_id, created_at),
    users!sender_id(id, name, username, image_url, badge)
`;

export const parseLimitWithinRange = (value, min = NOTIFICATION_LIMIT_MIN, max = NOTIFICATION_LIMIT_MAX, fallback = NOTIFICATION_DEFAULT_LIMIT) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    if (parsed < min || parsed > max) return null;
    return parsed;
};

const decorateNotificationMedia = (notification) => {
    if (!notification || typeof notification !== 'object') return notification;

    const senderAvatarMedia = createMediaResponsePayload('avatars', notification.users?.image_url, 'card');
    const journalThumbnailMedia = createMediaResponsePayload('journal-images', notification.journals?.thumbnail_url, 'card');
    const journalUserAvatarMedia = createMediaResponsePayload('avatars', notification.journals?.users?.image_url, 'card');

    return {
        ...notification,
        users: notification.users ? {
            ...notification.users,
            image_url: senderAvatarMedia?.preferred_url || notification.users.image_url || null,
            avatar_media: senderAvatarMedia
        } : notification.users,
        journals: notification.journals ? {
            ...notification.journals,
            thumbnail_url: journalThumbnailMedia?.preferred_url || notification.journals.thumbnail_url || null,
            thumbnail_media: journalThumbnailMedia,
            users: notification.journals.users ? {
                ...notification.journals.users,
                image_url: journalUserAvatarMedia?.preferred_url || notification.journals.users.image_url || null,
                avatar_media: journalUserAvatarMedia
            } : notification.journals.users
        } : notification.journals
    };
};

/**
 * Unified notification fetcher.
 * @param {string} userId
 * @param {{ limit: number, before?: string, unreadOnly?: boolean }} options
 */
export const getNotificationsService = async (userId, { limit, before, unreadOnly = false }) => {
    const fetchLimit = limit + 1;

    const makeJournalQuery = (selectStr) => {
        let q = supabase
            .from('notifications')
            .select(selectStr)
            .eq('receiver_id', userId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(fetchLimit);
        if (unreadOnly) q = q.eq('read', false);
        if (before) q = q.lt('created_at', before);
        return q;
    };

    let opinionQuery = supabase
        .from('notification_opinions')
        .select(NOTIFICATION_OPINION_SELECT)
        .eq('receiver_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(fetchLimit);

    if (unreadOnly) {
        opinionQuery = opinionQuery.eq('read', false);
    }

    if (before) {
        opinionQuery = opinionQuery.lt('created_at', before);
    }

    let [journalResult, opinionResult] = await Promise.all([
        makeJournalQuery(buildNotificationJournalSelect(true)),
        opinionQuery,
    ]);

    // Fall back to the target-less select if the migration hasn't run yet.
    if (journalResult.error && isMissingTargetColumnError(journalResult.error)) {
        journalResult = await makeJournalQuery(buildNotificationJournalSelect(false));
    }

    if (journalResult.error) {
        console.error('error fetching notifications:', journalResult.error);
        throw { status: 500, error: 'error fetching data from notification table' };
    }
    if (opinionResult.error) {
        console.error('error fetching opinion notifications:', opinionResult.error);
        throw { status: 500, error: 'error fetching data from notification_opinions table' };
    }

    const journalNotifs = (journalResult.data || []).map(n => ({ ...n, source: 'journal' }));
    const opinionNotifs = (opinionResult.data || []).map(n => ({ ...n, source: 'opinion' }));

    const merged = [...journalNotifs, ...opinionNotifs]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Likes/bookmarks lookup only for journal notifications
    const journalIds = [...new Set(
        merged
            .filter(n => n.source === 'journal')
            .map(n => n.journal_id)
            .filter(Boolean)
    )];

    let hasLikedResult = [];
    let hasBookMarkedResult = [];
    if (journalIds.length > 0) {
        const [hasLiked, hasBookMarked] = await Promise.all([
            supabase.from('likes').select('journal_id').in('journal_id', journalIds).eq('user_id', userId),
            supabase.from('bookmarks').select('journal_id').in('journal_id', journalIds).eq('user_id', userId)
        ]);

        if (hasLiked.error || hasBookMarked.error) {
            console.error('supabase error fetching likes/bookmarks:', hasLiked.error || hasBookMarked.error);
        }
        hasLikedResult = hasLiked.data || [];
        hasBookMarkedResult = hasBookMarked.data || [];
    }

    const likedSet = new Set(hasLikedResult.map(l => l.journal_id));
    const bookmarkedSet = new Set(hasBookMarkedResult.map(b => b.journal_id));

    const formatted = merged.map(notif => decorateNotificationMedia({
        ...notif,
        hasLiked: notif.source === 'journal' ? likedSet.has(notif.journal_id) : false,
        hasBookMarked: notif.source === 'journal' ? bookmarkedSet.has(notif.journal_id) : false
    }));

    const hasMore = formatted.length > limit;
    const data = hasMore ? formatted.slice(0, limit) : formatted;

    return { data, hasMore };
};

export const getCountNotificationsService = async (userId) => {
    const { data, error } = await supabase.rpc('get_unread_notification_count', {
        p_user_id: userId,
    });

    if (error) {
        console.error('get_unread_notification_count rpc error:', error.message);
        throw { status: 500, error: 'error fetching count in notifications table' };
    }

    return { count: data ?? 0 };
};

export const readNotificationService = async (userId, notifId, source) => {
    const tableName = source === 'opinion' ? 'notification_opinions' : 'notifications';

    const { error } = await supabase
        .from(tableName)
        .update({ read: true })
        .eq('receiver_id', userId)
        .eq('id', notifId);

    if (error) {
        console.error('error updating notification read status:', error);
        throw { status: 500, error: 'error updating the notification read status' };
    }

    return { message: 'notification was read!' };
};

export const deleteNotificationService = async (userId, notifId, source) => {
    if (!notifId) {
        throw { status: 400, error: 'notifId is required' };
    }

    const tableName = source === 'opinion' ? 'notification_opinions' : 'notifications';

    const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('receiver_id', userId)
        .eq('id', notifId);

    if (error) {
        console.error('supabase error while deleting notification:', error.message);
        throw { status: 500, error: 'supabase error while deleting notification' };
    }

    return { message: 'success' };
};

export { NOTIFICATION_LIMIT_MIN, NOTIFICATION_LIMIT_MAX, NOTIFICATION_DEFAULT_LIMIT };
