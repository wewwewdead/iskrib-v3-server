import supabase from "../services/supabase.js";
import { asyncHandler } from "../utils/controllerHandler.js";
import { recordPublishForStreak } from "../services/streakService.js";

const OPINION_LIST_SELECT = `
    id,
    user_id,
    parent_id,
    opinion,
    reply_count,
    created_at,
    users(name, id, user_email, image_url, badge)
`;
const MY_OPINION_SELECT = `
    id,
    user_id,
    parent_id,
    opinion,
    reply_count,
    created_at
`;
const USER_OPINION_SELECT = `
    id,
    user_id,
    parent_id,
    opinion,
    reply_count,
    created_at,
    users(name, image_url, id, badge)
`;

const parseOpinionLimit = (raw) => {
    const parsed = parseInt(raw);
    if (isNaN(parsed) || parsed < 1 || parsed > 20) return null;
    return parsed;
};

export const addOpinionController = asyncHandler(async (req, res) => {
    const { opinion } = req.body;
    if (!opinion || opinion.length > 280) {
        return res.status(400).json({ error: 'no opinion or opinion is over 280 characters' });
    }
    const userId = req.userId;

    const { data: insertedOpinion, error } = await supabase
        .from('opinions')
        .insert({ user_id: userId, opinion })
        .select('id')
        .single();

    if (error) {
        console.error('supabase error:', error.message);
        return res.status(500).json({ error: 'supabase error' });
    }

    // Non-fatal: send @mention notifications
    try {
        const mentionMatches = opinion.match(/@([\w-]+)/g);
        if (mentionMatches && mentionMatches.length > 0) {
            const usernames = [...new Set(mentionMatches.map(m => m.slice(1)))].slice(0, 10);
            const { data: mentionedUsers } = await supabase
                .from('users')
                .select('id, username')
                .in('username', usernames);
            if (mentionedUsers && mentionedUsers.length > 0) {
                const notifs = mentionedUsers
                    .filter(u => u.id !== userId)
                    .map(u => ({
                        sender_id: userId,
                        receiver_id: u.id,
                        opinion_id: insertedOpinion.id,
                        type: 'mention',
                        read: false,
                    }));
                if (notifs.length > 0) {
                    await supabase.from('notification_opinions').insert(notifs);
                }
            }
        }
    } catch (mentionErr) {
        console.error('non-fatal: opinion mention notification error', mentionErr?.message);
    }

    // Non-fatal: record publish for writing streak
    try {
        recordPublishForStreak(userId).catch(err =>
            console.error('non-fatal: streak record failed:', err?.message || err)
        );
    } catch (streakErr) {
        console.error('non-fatal: streak record failed:', streakErr?.message || streakErr);
    }

    return res.status(200).json({ message: 'success' });
});

export const getOpinionsController = asyncHandler(async (req, res) => {
    const { before } = req.query;
    const parsedLimit = parseOpinionLimit(req.query.limit);
    if (parsedLimit == null) {
        return res.status(400).json({ error: 'limit should be number and it should be between 1 - 20' });
    }

    let query = supabase
        .from('opinions')
        .select(OPINION_LIST_SELECT)
        .is('parent_id', null)
        .order('id', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) query = query.lt('id', before);

    const { data: opinions, error } = await query;
    if (error) {
        console.error('supabase error:', error.message);
        return res.status(500).json({ error: 'supabase error on fetching opinions from database' });
    }

    const hasMore = opinions?.length > parsedLimit;
    const slicedData = hasMore ? opinions.slice(0, parsedLimit) : opinions;
    return res.status(200).json({ data: slicedData, hasMore });
});

export const getMyOpinionsController = asyncHandler(async (req, res) => {
    const { before } = req.query;
    const parsedLimit = parseOpinionLimit(req.query.limit);
    if (parsedLimit == null) {
        return res.status(400).json({ error: 'limit should be number and between 1 - 20' });
    }

    let query = supabase
        .from('opinions')
        .select(MY_OPINION_SELECT)
        .order('id', { ascending: false })
        .limit(parsedLimit + 1)
        .eq('user_id', req.userId)
        .is('parent_id', null);

    if (before) query = query.lt('id', before);

    const { data, error } = await query;
    if (error) {
        console.error('supabase error:', error.message);
        return res.status(500).json({ error: 'supabase error while fetching the users opinions' });
    }

    const hasMore = data.length > parsedLimit;
    const slicedData = hasMore ? data.slice(0, parsedLimit) : data;
    return res.status(200).json({ data: slicedData, hasMore });
});

export const getUserOpinionsController = asyncHandler(async (req, res) => {
    const { before, userId } = req.query;
    const parsedLimit = parseOpinionLimit(req.query.limit);
    if (parsedLimit == null) {
        return res.status(400).json({ error: 'limit should be number and not be greater than 20 or less than 1' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'no user id available!' });
    }

    let query = supabase
        .from('opinions')
        .select(USER_OPINION_SELECT)
        .limit(parsedLimit + 1)
        .eq('user_id', userId)
        .is('parent_id', null)
        .order('id', { ascending: false });

    if (before) query = query.lt('id', before);

    const { data, error } = await query;
    if (error) {
        console.error('supabase error:', error.message);
        return res.status(500).json({ error: 'supabase error while fetching opinions' });
    }

    const hasMore = data.length > parsedLimit;
    const slicedData = hasMore ? data.slice(0, parsedLimit) : data;
    return res.status(200).json({ data: slicedData, hasMore });
});
