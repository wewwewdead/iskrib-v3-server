import supabase from "../services/supabase.js";
import { asyncHandler } from "../utils/controllerHandler.js";
import { isValidUsername, RESERVED_USERNAMES } from "../utils/validation.js";
import { getUserByUsernameService } from "../services/getUserDataService.js";
import { getStreakService } from "../services/streakService.js";

const COMMENT_REPLY_SELECT = `
    id,
    post_id,
    parent_id,
    user_id,
    comment,
    reply_count,
    created_at,
    users(name, image_url, id, badge)
`;

export const addViewsController = asyncHandler(async (req, res) => {
    const { journalId } = req.body;
    if (!journalId) {
        return res.status(400).json({ error: 'no journalId!' });
    }
    const viewerId = req.userId;

    const { error: errorAddViews } = await supabase
        .from('journal_views')
        .insert({ viewer_id: viewerId, journal_id: journalId });

    if (errorAddViews) {
        const isDuplicateView =
            errorAddViews?.code === '23505' ||
            (errorAddViews?.message || '').includes('unique_journal_views');

        if (isDuplicateView) {
            return res.status(200).json({ message: 'success!', counted: false });
        }

        console.error('error:', errorAddViews.message);
        return res.status(500).json({ error: 'error adding views' });
    }

    const { error: incrementError } = await supabase.rpc('increment_journal_view', { j_post_id: journalId });
    if (incrementError) {
        console.error('error incrementing journal view:', incrementError.message);
        return res.status(500).json({ error: 'error incrementing views' });
    }

    return res.status(200).json({ message: 'success!', counted: true });
});

export const updatePrivacyController = asyncHandler(async (req, res) => {
    const { journalId, privacy } = req.body;
    if (!journalId) {
        return res.status(400).json({ error: 'no journalId' });
    }
    if (!['public', 'private'].includes(privacy)) {
        return res.status(400).json({ error: 'invalid privacy value' });
    }

    const { error } = await supabase
        .from('journals')
        .update({ privacy })
        .eq('id', journalId)
        .eq('user_id', req.userId);

    if (error) {
        console.error('updating journal privacy error:', error);
        return res.status(500).json({ error: 'error updating journal privacy' });
    }

    return res.status(200).json({ message: 'success' });
});

export const submitReplyController = asyncHandler(async (req, res) => {
    const { parent_id, receiver_id, post_id } = req.params;
    const user_id = req.userId;
    const { reply } = req.body;
    const isOwner = user_id === receiver_id;

    if (!parent_id || !post_id || !receiver_id) {
        return res.status(400).json({ error: 'parent_id || post_id || receiver_id is missing' });
    }
    if (!reply || reply.length > 201 || typeof reply !== 'string') {
        return res.status(400).json({ error: 'reply is not a string or maybe undefined' });
    }

    const insertReplyPromise = supabase
        .from('comments')
        .insert({ post_id, user_id, comment: reply, parent_id });

    const insertNotifPromise = supabase
        .from('notifications')
        .insert({ sender_id: user_id, receiver_id, type: 'reply', journal_id: post_id, read: false });

    const [insertNotif, insertReply] = await Promise.all([
        isOwner ? Promise.resolve({ error: null }) : insertNotifPromise,
        insertReplyPromise
    ]);

    if (insertReply.error || insertNotif.error) {
        console.error('supabase error:', insertReply.error?.message || insertNotif.error?.message);
        return res.status(500).json({ error: 'supabase error' });
    }

    // Non-fatal: send @mention notifications
    try {
        const mentionMatches = reply.match(/@([\w-]+)/g);
        if (mentionMatches && mentionMatches.length > 0) {
            const usernames = [...new Set(mentionMatches.map(m => m.slice(1)))].slice(0, 10);

            const { data: mentionedUsers } = await supabase
                .from('users')
                .select('id, username')
                .in('username', usernames);

            if (mentionedUsers && mentionedUsers.length > 0) {
                const notifs = mentionedUsers
                    .filter(u => u.id !== user_id && u.id !== receiver_id)
                    .map(u => ({
                        sender_id: user_id,
                        receiver_id: u.id,
                        journal_id: post_id,
                        type: 'mention',
                        read: false,
                    }));

                if (notifs.length > 0) {
                    await supabase.from('notifications').insert(notifs);
                }
            }
        }
    } catch (mentionErr) {
        console.error('non-fatal: mention notification error', mentionErr?.message);
    }

    return res.status(200).json({ message: 'success' });
});

export const getPostRepliesController = asyncHandler(async (req, res) => {
    const { parent_id } = req.params;
    const { limit, before } = req.query;

    if (!parent_id) {
        return res.status(400).json({ error: 'parent_id is undefined' });
    }

    const parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
        return res.status(400).json({ error: 'limit should be integer or it should be between 1 to 20' });
    }

    let query = supabase
        .from('comments')
        .select(COMMENT_REPLY_SELECT)
        .eq('parent_id', parent_id)
        .order('id', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) query = query.lt('id', before);

    const { data, error } = await query;
    if (error) {
        console.error('supabase error while fetching replies:', error.message);
        return res.status(500).json({ error: 'supabase error while getting post replies' });
    }

    const hasMore = data.length > parsedLimit;
    const slicedData = hasMore ? data.slice(0, parsedLimit) : data;
    return res.status(200).json({ data: slicedData, hasMore });
});

export const getUserByUsernameController = asyncHandler(async (req, res) => {
    const data = await getUserByUsernameService(req.params.username);
    return res.status(200).json(data);
});

export const checkUsernameController = asyncHandler(async (req, res) => {
    const { username } = req.params;
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'username is required' });
    }

    const normalized = username.trim().toLowerCase();
    if (RESERVED_USERNAMES.has(normalized)) {
        return res.status(200).json({ available: false, reason: 'reserved' });
    }

    const { data: existing, error } = await supabase
        .from('users')
        .select('id')
        .ilike('username', normalized)
        .limit(1);

    if (error) {
        console.error('check-username error:', error.message);
        return res.status(500).json({ error: 'database error' });
    }

    return res.status(200).json({ available: !existing || existing.length === 0 });
});

export const updateUsernameController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'username is required' });
    }

    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 50) {
        return res.status(400).json({ error: 'username must be 3-50 characters' });
    }

    if (!isValidUsername(trimmed.toLowerCase())) {
        return res.status(400).json({ error: 'username must start/end with a letter or number and cannot have consecutive hyphens' });
    }

    const normalized = trimmed.toLowerCase();
    if (RESERVED_USERNAMES.has(normalized)) {
        return res.status(400).json({ error: 'this username is reserved' });
    }

    // Check uniqueness
    const { data: existing } = await supabase
        .from('users')
        .select('id')
        .ilike('username', normalized)
        .neq('id', userId)
        .limit(1);

    if (existing && existing.length > 0) {
        return res.status(409).json({ error: 'username is already taken' });
    }

    const { error: updateError } = await supabase
        .from('users')
        .update({ username: normalized })
        .eq('id', userId);

    if (updateError) {
        console.error('update-username error:', updateError.message);
        return res.status(500).json({ error: 'failed to update username' });
    }

    return res.status(200).json({ message: 'success', username: normalized });
});

export const getStreakController = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const streakData = await getStreakService(userId);
    return res.status(200).json(streakData);
});
