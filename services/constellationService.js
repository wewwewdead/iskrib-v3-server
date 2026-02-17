import supabase from "./supabase.js";

export const requestConstellationService = async (senderId, starIdA, starIdB, label) => {
    if (!senderId || !starIdA || !starIdB) {
        throw { status: 400, error: 'senderId, starIdA, and starIdB are required' };
    }

    // Verify starIdA belongs to sender
    const { data: starA, error: errorStarA } = await supabase
        .from('journals')
        .select('id, user_id')
        .eq('id', starIdA)
        .maybeSingle();

    if (errorStarA) {
        console.error('supabase error checking starA ownership:', errorStarA.message);
        throw { status: 500, error: 'error checking star ownership' };
    }
    if (!starA || starA.user_id !== senderId) {
        throw { status: 403, error: 'starIdA does not belong to you' };
    }

    // Get starIdB owner
    const { data: starB, error: errorStarB } = await supabase
        .from('journals')
        .select('id, user_id')
        .eq('id', starIdB)
        .maybeSingle();

    if (errorStarB) {
        console.error('supabase error checking starB:', errorStarB.message);
        throw { status: 500, error: 'error checking target star' };
    }
    if (!starB) {
        throw { status: 404, error: 'target star not found' };
    }

    const receiverId = starB.user_id;
    if (receiverId === senderId) {
        throw { status: 400, error: 'cannot create constellation with your own stars' };
    }

    // Normalize pair order to avoid duplicate check issues
    const [normA, normB] = starIdA < starIdB ? [starIdA, starIdB] : [starIdB, starIdA];
    const [normUserA, normUserB] = starIdA < starIdB ? [senderId, receiverId] : [receiverId, senderId];

    // Insert constellation
    const { data: constellation, error: errorInsert } = await supabase
        .from('constellations')
        .insert({
            star_id_a: normA,
            star_id_b: normB,
            user_id_a: normUserA,
            user_id_b: normUserB,
            label: label || '',
            status: 'pending',
        })
        .select()
        .single();

    if (errorInsert) {
        if (errorInsert.code === '23505') {
            throw { status: 409, error: 'a constellation link between these stars already exists' };
        }
        console.error('supabase error inserting constellation:', errorInsert.message);
        throw { status: 500, error: 'error creating constellation' };
    }

    // Insert notification for the receiver
    const { error: errorNotif } = await supabase
        .from('notifications')
        .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            journal_id: starIdB,
            type: 'constellation_request',
            constellation_id: constellation.id,
            read: false,
        });

    if (errorNotif) {
        console.error('supabase error inserting constellation notification:', errorNotif.message);
    }

    return { message: 'constellation request sent', constellationId: constellation.id };
};

export const respondConstellationService = async (userId, constellationId, accept) => {
    if (!userId || !constellationId) {
        throw { status: 400, error: 'userId and constellationId are required' };
    }

    const { data: constellation, error: errorFetch } = await supabase
        .from('constellations')
        .select('*')
        .eq('id', constellationId)
        .maybeSingle();

    if (errorFetch) {
        console.error('supabase error fetching constellation:', errorFetch.message);
        throw { status: 500, error: 'error fetching constellation' };
    }
    if (!constellation) {
        throw { status: 404, error: 'constellation not found' };
    }
    if (constellation.status !== 'pending') {
        throw { status: 400, error: 'constellation has already been responded to' };
    }

    // The responder must be the user who did NOT initiate
    const isRecipient = constellation.user_id_a === userId || constellation.user_id_b === userId;
    if (!isRecipient) {
        throw { status: 403, error: 'you are not a participant of this constellation' };
    }

    // Determine who the initiator was (the sender of the request notification)
    // The initiator is the one who is NOT the current user responding
    const initiatorId = constellation.user_id_a === userId ? constellation.user_id_b : constellation.user_id_a;

    const newStatus = accept ? 'accepted' : 'declined';

    const { error: errorUpdate } = await supabase
        .from('constellations')
        .update({ status: newStatus })
        .eq('id', constellationId);

    if (errorUpdate) {
        console.error('supabase error updating constellation:', errorUpdate.message);
        throw { status: 500, error: 'error updating constellation status' };
    }

    // If accepted, notify the initiator
    if (accept) {
        const { error: errorNotif } = await supabase
            .from('notifications')
            .insert({
                sender_id: userId,
                receiver_id: initiatorId,
                journal_id: constellation.star_id_a,
                type: 'constellation_accepted',
                constellation_id: constellationId,
                read: false,
            });

        if (errorNotif) {
            console.error('supabase error inserting acceptance notification:', errorNotif.message);
        }
    }

    return { message: accept ? 'constellation accepted' : 'constellation declined' };
};

export const getViewportConstellationsService = async (postIds) => {
    if (!Array.isArray(postIds) || postIds.length === 0) {
        return [];
    }

    const { data, error } = await supabase.rpc('get_viewport_constellations', {
        post_ids: postIds,
    });

    if (error) {
        console.error('supabase error fetching viewport constellations:', error.message);
        throw { status: 500, error: 'error fetching constellations' };
    }

    return data || [];
};

export const deleteConstellationService = async (userId, constellationId) => {
    if (!userId || !constellationId) {
        throw { status: 400, error: 'userId and constellationId are required' };
    }

    const { data: constellation, error: errorFetch } = await supabase
        .from('constellations')
        .select('user_id_a, user_id_b')
        .eq('id', constellationId)
        .maybeSingle();

    if (errorFetch) {
        console.error('supabase error fetching constellation for delete:', errorFetch.message);
        throw { status: 500, error: 'error fetching constellation' };
    }
    if (!constellation) {
        throw { status: 404, error: 'constellation not found' };
    }

    const isParticipant = constellation.user_id_a === userId || constellation.user_id_b === userId;
    if (!isParticipant) {
        throw { status: 403, error: 'you are not a participant of this constellation' };
    }

    const { error: errorDelete } = await supabase
        .from('constellations')
        .delete()
        .eq('id', constellationId);

    if (errorDelete) {
        console.error('supabase error deleting constellation:', errorDelete.message);
        throw { status: 500, error: 'error deleting constellation' };
    }

    return { message: 'constellation deleted' };
};
