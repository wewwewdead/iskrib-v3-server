import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";

export const likeService = async(journalId, receiverId, senderId) =>{
    if(!journalId || !receiverId){
        throw new AppError(400, 'journalId or receiverId is undefined');
    }

    if(!senderId){
        throw new AppError(400, 'senderId is undefined');
    }

    const isOwnContent = senderId === receiverId;

    const {data: existingLike, error: errorExistingLike} = await supabase
    .from('likes')
    .select('user_id')
    .eq('user_id', senderId)
    .eq('journal_id', journalId)
    .maybeSingle()

    if(errorExistingLike){
        console.error('supabase error while checking existing like')
    }

    if(!existingLike){
        const insertNotifPromise = supabase
        .from('notifications')
        .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            journal_id: journalId,
            type: 'like',
            read: false
        })

        const insertLikePromise = supabase
        .from('likes')
        .insert({
            user_id: senderId,
            journal_id: journalId,
        })

        const [insertNotif, insertLike ] = await Promise.all([
            isOwnContent ? Promise.resolve({error: null}) : insertNotifPromise,
            insertLikePromise
        ])

        const {error: errorInsertNotificationResult} = insertNotif;
        const {error: errorInserLikeResult} = insertLike;

        if(errorInsertNotificationResult || errorInserLikeResult){
            console.error('supabase error:', errorInserLikeResult?.message || errorInsertNotificationResult?.message);
            throw new AppError(500, 'supabase error while inserting likes');
        }

        return {message: 'liked'};
    } else {
        const deleteNotifPromise = supabase
        .from('notifications')
        .delete()
        .eq('receiver_id', receiverId)
        .eq('sender_id', senderId)
        .eq('journal_id', journalId)
        .eq('type', 'like')

        const deleteLikePromise = await supabase
        .from('likes')
        .delete()
        .eq('user_id', senderId)
        .eq('journal_id', journalId)

        const [deleteNotif, deleteLike] = await Promise.all([deleteNotifPromise, deleteLikePromise]);
        const {error: errorDeleteNotif} = deleteNotif;
        const {error: errorDeleteLike} = deleteLike;

        if(errorDeleteNotif || errorDeleteLike){
            console.error('supabase error while deleting like', errorDeleteLike?.message || errorDeleteNotif?.message);
            throw new AppError(500, 'supabase error while deleting like');
        }

        return {message: 'unliked'};
    }

}

export const addCommentService = async(userId, comments, postId, receiverId, parentId) => {
    if(!comments || !postId || !receiverId){
        throw new AppError(400, 'comments || postId || receiverId is undefined');
    }

    if(!userId){
        throw new AppError(400, 'userId is undefined');
    }
    const isOwnContent = userId === receiverId;

    const insertNotifPromise = supabase
    .from('notifications')
    .insert(
        {
            sender_id: userId,
            receiver_id: receiverId,
            journal_id: postId,
            read: false,
            type: 'comment'
        }
    )

    const insertCommentPromise = supabase
    .from('comments')
    .insert(
        {
            comment: comments,
            post_id: postId,
            user_id: userId,
            parent_id: parentId || null
        }
    )

    const [insertNotif, insertComment] = await Promise.all([
        isOwnContent ? Promise.resolve({error: null}) : insertNotifPromise,
        insertCommentPromise
    ])

    const {error: errorAddComment} = insertComment;
    const {error: errorAddNotif} = insertNotif;

    if(errorAddComment || errorAddNotif){
        console.error('supabase error while inserting comments or notifs', errorAddComment?.message || errorAddNotif?.message);
        throw new AppError(500, 'supabase error while inserting comments or notifs');
    }

    // Non-fatal: send @mention notifications
    try {
        const mentionMatches = comments.match(/@([\w-]+)/g);
        if (mentionMatches && mentionMatches.length > 0) {
            const usernames = [...new Set(mentionMatches.map(m => m.slice(1)))].slice(0, 10);

            const { data: mentionedUsers } = await supabase
                .from('users')
                .select('id, username')
                .in('username', usernames);

            if (mentionedUsers && mentionedUsers.length > 0) {
                const notifs = mentionedUsers
                    .filter(u => u.id !== userId && u.id !== receiverId)
                    .map(u => ({
                        sender_id: userId,
                        receiver_id: u.id,
                        journal_id: postId,
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

    return {message: 'success'};
}

export const addBookmarkService = async(userId, journalId) =>{
    if(!userId){
        throw new AppError(400, 'userId is undefined');
    }
    if(!journalId){
        throw new AppError(400, 'journalId is undefined');
    }

    const {data:checkExisting, error: errorCheckExisting} = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id',userId)
    .eq('journal_id', journalId)
    .maybeSingle()

    if(errorCheckExisting){
        console.error('supabase error while checking the existing bookmarks', errorCheckExisting.message);
        throw new AppError(500, 'supabase error while checking the existing bookmarks');
    }

    if(!checkExisting){
        const {error: errorAddBookmark} = await supabase
        .from('bookmarks')
        .insert({user_id: userId, journal_id: journalId})

        if(errorAddBookmark){
            console.error('supabase error while adding bookmark', errorAddBookmark.message);
            throw new AppError(500, 'supabase error while adding bookmark');
        }

        return {message: 'success'};
    } else {
        const {error: errorDeletingBookmark} = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('journal_id', journalId)

        if(errorDeletingBookmark){
            console.error('supabase error while deleting bookmark', errorDeletingBookmark.message);
            throw new AppError(500, 'supabase error while deleting bookmark');
        }
        return {message: 'deleted'}
    }
}

export const uploadOpinionReplyService = async(parent_id, opinion, user_id) =>{
    if(!parent_id || !user_id){
        throw new AppError(400, 'parentid or userid is undefined');
    }
    if(!opinion || typeof opinion !== 'string'){
        throw new AppError(400, 'opinion is undefined or opinion is not a string');
    }

    const {data: parentOpinion, error: errorParentOpinion} = await supabase
    .from('opinions')
    .select('user_id')
    .eq('id', parent_id)
    .maybeSingle();

    if(errorParentOpinion){
        console.error('supabase error while fetching parent opinion', errorParentOpinion.message);
        throw new AppError(500, 'supabase error while fetching parent opinion');
    }
    if(!parentOpinion?.user_id){
        throw new AppError(404, 'parent opinion not found');
    }

    const receiver_id = parentOpinion.user_id;
    const isOwner = user_id === receiver_id;

    const insertNotifPromise = supabase
    .from('notification_opinions')
    .insert({type: 'reply', read: false, receiver_id: receiver_id, sender_id: user_id, opinion_id: parent_id})

    const insertOpinionReplyPromise = supabase
    .from('opinions')
    .insert({user_id: user_id, parent_id: parent_id, opinion: opinion})

    const [ insertNotif, insertOpinionReply] = await Promise.all([
        isOwner ? Promise.resolve({error: null}) : insertNotifPromise, insertOpinionReplyPromise
    ])
    const {error: errorUploadOpinionReply} = insertOpinionReply;
    const {error: errorInsertNotif} = insertNotif;

    if(errorUploadOpinionReply || errorInsertNotif) {
        console.error('supabase error:', errorInsertNotif?.message || errorUploadOpinionReply?.message);
        throw new AppError(500, 'supabase error');
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
                    .filter(u => u.id !== user_id && u.id !== receiver_id)
                    .map(u => ({
                        sender_id: user_id,
                        receiver_id: u.id,
                        opinion_id: parent_id,
                        type: 'mention',
                        read: false,
                    }));
                if (notifs.length > 0) {
                    await supabase.from('notification_opinions').insert(notifs);
                }
            }
        }
    } catch (mentionErr) {
        console.error('non-fatal: opinion reply mention notification error', mentionErr?.message);
    }

    return {message: 'success'};
}

export const repostService = async(sourceJournalId, caption, userId) => {
    if(!sourceJournalId || !userId){
        throw new AppError(400, 'sourceJournalId or userId is undefined');
    }

    if(caption && caption.length > 280){
        throw new AppError(400, 'caption must be 280 characters or less');
    }

    // Fetch source journal
    const {data: sourceJournal, error: errorSourceJournal} = await supabase
        .from('journals')
        .select('id, title, user_id, privacy, is_repost, repost_source_journal_id')
        .eq('id', sourceJournalId)
        .maybeSingle();

    if(errorSourceJournal){
        console.error('supabase error while fetching source journal:', errorSourceJournal.message);
        throw new AppError(500, 'supabase error while fetching source journal');
    }

    if(!sourceJournal){
        throw new AppError(404, 'source journal not found');
    }

    if(sourceJournal.privacy !== 'public'){
        throw new AppError(403, 'cannot repost a private post');
    }

    if(sourceJournal.user_id === userId){
        throw new AppError(403, 'cannot repost your own post');
    }

    // If reposting a repost, follow chain to the ultimate original
    let ultimateSourceId = sourceJournalId;
    let ultimateSourceUserId = sourceJournal.user_id;
    let ultimateSourceTitle = sourceJournal.title;

    if(sourceJournal.is_repost && sourceJournal.repost_source_journal_id){
        const {data: originalJournal, error: errorOriginal} = await supabase
            .from('journals')
            .select('id, title, user_id, privacy')
            .eq('id', sourceJournal.repost_source_journal_id)
            .maybeSingle();

        if(errorOriginal){
            console.error('supabase error fetching original:', errorOriginal.message);
            throw new AppError(500, 'supabase error while fetching original post');
        }
        if(!originalJournal){
            throw new AppError(404, 'original post no longer exists');
        }
        if(originalJournal.privacy !== 'public'){
            throw new AppError(403, 'cannot repost a private post');
        }
        if(originalJournal.user_id === userId){
            throw new AppError(403, 'cannot repost your own post');
        }

        ultimateSourceId = originalJournal.id;
        ultimateSourceUserId = originalJournal.user_id;
        ultimateSourceTitle = originalJournal.title;
    }

    // Check for duplicate repost
    const {data: existingRepost, error: errorExisting} = await supabase
        .from('journals')
        .select('id')
        .eq('user_id', userId)
        .eq('repost_source_journal_id', ultimateSourceId)
        .eq('is_repost', true)
        .maybeSingle();

    if(errorExisting){
        console.error('supabase error while checking existing repost:', errorExisting.message);
        throw new AppError(500, 'supabase error while checking existing repost');
    }

    if(existingRepost){
        throw new AppError(409, 'you have already reposted this post');
    }

    const repostTitle = `Repost: ${ultimateSourceTitle || 'Untitled'}`;

    const {data: insertedRepost, error: errorInsertRepost} = await supabase
        .from('journals')
        .insert({
            user_id: userId,
            is_repost: true,
            repost_source_journal_id: ultimateSourceId,
            repost_caption: caption || null,
            post_type: 'text',
            content: null,
            title: repostTitle.length > 255 ? repostTitle.substring(0, 255) : repostTitle,
            privacy: 'public'
        })
        .select('id')
        .single();

    if(errorInsertRepost){
        console.error('supabase error while inserting repost:', errorInsertRepost.message);
        throw new AppError(500, 'supabase error while inserting repost');
    }

    // Notify the original author (skip if self)
    const isOwnContent = userId === ultimateSourceUserId;
    if(!isOwnContent){
        const {error: errorNotif} = await supabase
            .from('notifications')
            .insert({
                sender_id: userId,
                receiver_id: ultimateSourceUserId,
                journal_id: ultimateSourceId,
                repost_journal_id: insertedRepost.id,
                type: 'repost',
                read: false
            });

        if(errorNotif){
            console.error('supabase error while inserting repost notification:', errorNotif.message);
        }
    }

    return {message: 'repost created', repostId: insertedRepost.id, sourceJournalId: ultimateSourceId};
}

export const addFollowsService = async(followerId, followingId) => {
    if(!followerId || !followingId){
        throw new AppError(400, 'followerId or followingId is undefined');
    }

    const {data: existing, error: errorExisting} = await supabase
    .from('follows')
    .select('*')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();

    if(errorExisting){
        console.error('supabase error while checking existing following:', errorExisting.message);
        throw new AppError(500, 'supabase error while checking existing following');
    }

    if(existing){
        const {error: errorRemoveData} = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('following_id', followingId)

        if(errorRemoveData){
            console.error('supabase error while deleting follow data:', errorRemoveData.message);
            throw new AppError(500, 'supabase error while deleting follow data');
        }

        return {message: 'deleted follows data'};
    } else {
        const {error: errorInserData} = await supabase
        .from('follows')
        .insert({
            follower_id: followerId,
            following_id: followingId,
        })

        if(errorInserData){
            console.error('supabase error while inserting follow data:', errorInserData.message);
            throw new AppError(500, 'supabase error while inserting follow data');
        }

        // Create follow notification (skip if self-follow)
        if (followerId !== followingId) {
            await supabase
                .from('notifications')
                .insert({
                    sender_id: followerId,
                    receiver_id: followingId,
                    type: 'follow',
                    read: false
                });
        }

        return {message: 'success'};
    }
}
