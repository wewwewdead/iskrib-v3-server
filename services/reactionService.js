import supabase from "./supabase.js";

const VALID_REACTIONS = ['fire', 'heart', 'mind_blown', 'clap', 'laugh', 'sad'];

/**
 * Toggle a reaction on a post.
 * - Same emoji = remove reaction
 * - Different emoji = switch reaction
 * - No existing = add reaction
 */
export const toggleReactionService = async (journalId, receiverId, senderId, reactionType) => {
    if (!journalId || !senderId) {
        throw { status: 400, error: 'journalId and senderId are required' };
    }

    if (!VALID_REACTIONS.includes(reactionType)) {
        throw { status: 400, error: 'invalid reaction type' };
    }

    const isOwnContent = senderId === receiverId;

    // Check existing reaction
    const { data: existing, error: fetchErr } = await supabase
        .from('reactions')
        .select('id, reaction_type')
        .eq('user_id', senderId)
        .eq('journal_id', journalId)
        .maybeSingle();

    if (fetchErr) {
        console.error('error checking existing reaction:', fetchErr.message);
    }

    if (!existing) {
        // No existing reaction → insert new
        const insertReactionPromise = supabase
            .from('reactions')
            .insert({
                user_id: senderId,
                journal_id: journalId,
                reaction_type: reactionType,
            });

        const insertNotifPromise = supabase
            .from('notifications')
            .insert({
                sender_id: senderId,
                receiver_id: receiverId,
                journal_id: journalId,
                type: 'reaction',
                reaction_type: reactionType,
                read: false,
            });

        const [insertReaction, insertNotif] = await Promise.all([
            insertReactionPromise,
            isOwnContent ? Promise.resolve({ error: null }) : insertNotifPromise,
        ]);

        if (insertReaction.error) {
            console.error('error inserting reaction:', insertReaction.error.message);
            throw { status: 500, error: 'failed to add reaction' };
        }
        if (insertNotif?.error) {
            console.error('error inserting reaction notification:', insertNotif.error.message);
        }

        return { message: 'reacted', reaction_type: reactionType };
    }

    if (existing.reaction_type === reactionType) {
        // Same emoji → remove reaction
        const deleteReactionPromise = supabase
            .from('reactions')
            .delete()
            .eq('id', existing.id);

        const deleteNotifPromise = supabase
            .from('notifications')
            .delete()
            .eq('sender_id', senderId)
            .eq('receiver_id', receiverId)
            .eq('journal_id', journalId)
            .eq('type', 'reaction');

        const [deleteReaction, deleteNotif] = await Promise.all([
            deleteReactionPromise,
            deleteNotifPromise,
        ]);

        if (deleteReaction.error) {
            console.error('error deleting reaction:', deleteReaction.error.message);
            throw { status: 500, error: 'failed to remove reaction' };
        }

        return { message: 'unreacted', reaction_type: null };
    }

    // Different emoji → switch reaction
    const updateReactionPromise = supabase
        .from('reactions')
        .update({ reaction_type: reactionType })
        .eq('id', existing.id);

    // Update notification too
    const updateNotifPromise = supabase
        .from('notifications')
        .update({ reaction_type: reactionType })
        .eq('sender_id', senderId)
        .eq('receiver_id', receiverId)
        .eq('journal_id', journalId)
        .eq('type', 'reaction');

    const [updateReaction] = await Promise.all([
        updateReactionPromise,
        isOwnContent ? Promise.resolve({ error: null }) : updateNotifPromise,
    ]);

    if (updateReaction.error) {
        console.error('error updating reaction:', updateReaction.error.message);
        throw { status: 500, error: 'failed to switch reaction' };
    }

    return { message: 'switched', reaction_type: reactionType };
};

/**
 * Get detailed reactions breakdown for a post.
 */
export const getPostReactionsService = async (journalId) => {
    if (!journalId) {
        throw { status: 400, error: 'journalId is required' };
    }

    const { data, error } = await supabase.rpc('get_post_reactions', {
        p_journal_id: journalId,
    });

    if (error) {
        console.error('error getting post reactions:', error.message);
        throw { status: 500, error: 'failed to get reactions' };
    }

    return { reactions: data || [] };
};
