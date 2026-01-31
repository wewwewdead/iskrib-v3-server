import supabase from "./supabase.js";

export const likeService = async(journalId, receiverId, token) =>{
    if(!journalId || !receiverId){
        console.error('journalId or receiverId is undefined');
        throw {status: 400, error: 'journalId or receiverId is undefined'};
    }

    if(!token){
        console.error('token is undefiend');
        throw {status: 400, error: 'token is undefined'}
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error while validation user authorization', errorAuthData.message);
        throw{status: 500, error: 'failed to validate user'};
    }

    const senderId = authData?.user.id;
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
        const inserNotifPromise = supabase
        .from('notifications')
        .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            journal_id: journalId,
            type: 'like',
            read: false
        })

        const inserLikePromise = supabase
        .from('likes')
        .insert({
            user_id: senderId, 
            journal_id: journalId,
        })

        const [insertNotif, insertLike ] = await Promise.all([
            isOwnContent ? Promise.resolve({error: null}) : inserNotifPromise,
            inserLikePromise
        ])

        const {data: insertNotifcationResult, error: errorInsertNotificationResult} = insertNotif;

        const {data: insertLikeResult, error: errorInserLikeResult} = insertLike;

        if(errorInsertNotificationResult || errorInserLikeResult){
            console.error('supabase error:', errorInserLikeResult.message || errorInsertNotificationResult.message);
            throw {status: 500, error: 'supabase error while inserting likes'}
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
            console.error('supabase error while deleting like', errorDeleteLike.message || errorDeleteNotif.message);
            throw {status: 500, error: 'supabase error while deleting like'}
        }

        return {message: 'unliked'};
    }

}

export const addCommentService = async(token, comments, postId, receiverId) => {
    if(!token){
        console.error('token is undefined')
        throw {status: 400, error: 'token is undefined'};
    }

    if(!comments || !postId || !receiverId){
        console.error('comments || postId || receiverId is undefined');
        throw {status: 400, error: 'comments || postId || receiverId is undefined'};
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error:', errorAuthData.message);
        throw {status: 500, error: 'supabase error while validating user'};
    }

    const userId = authData.user.id;
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
            user_id: userId
        }
    )

    const [insertNotif, insertComment] = await Promise.all([
        isOwnContent ? Promise.resolve({error: null}) : insertNotifPromise,
        insertCommentPromise
    ])

    const {data: addComment, error: errorAddComment} = insertComment;

    const {data: insertNotifResul, error: errorAddNotif} = insertNotif;

    if(errorAddComment || errorAddNotif){
        console.error('supabase error while inserting comments or notifs', errorAddComment.message || errorAddComment.message);
        throw {status: 500, error: 'supabase error while inserting comments or notifs'};
    }

    return {message: 'success'};
}

export const addBoorkmarkSetvice = async(token, journalId) =>{
    if(!token){
        console.error('token is undefined');
        throw {status: 400, error: 'token is undefined'}
    }
    if(!journalId){
        console.error('journalId is undefined');
        throw {status: 400, error: 'journalId is undefined'};
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error while checking authentication', errorAuthData.message);
        throw {status: 500, error: 'supabase error while checking authentication'};
    }
    const userId = authData?.user?.id;

    const {data:checkExisting, error: errorCheckExisting} = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id',userId)
    .eq('journal_id', journalId)
    .maybeSingle()

    if(errorCheckExisting){
        console.error('supabase error while checking the existing bookmarks', errorCheckExisting.message);
        throw {status: 500, error: 'supabase error while checking the existing bookmarks'};
    }

    if(!checkExisting){
        const {data: addBoorkmark, error: errorAddBookmark} = await supabase
        .from('bookmarks')
        .insert({user_id: userId, journal_id: journalId})

        if(errorAddBookmark){
            console.error('supabase error while adding bookmark', errorAddBookmark.message);
            throw {status: 500, error: 'supabase error while adding bookmark'};
        }

        return {message: 'success'};
    } else {
        const {data: deleteBookmark, error: errorDeletingBookmark} = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('journal_id', journalId)

        if(errorDeletingBookmark){
            console.error('supabase error while deleting booknmark', errorDeletingBookmark.message);
            throw {status: 500, error: 'supabase error while deleting booknmark'};
        }
        return {message: 'deleted'}
    }
}

export const uploadOpinionReplyService = async(parent_id, opinion, user_id, receiver_id, opinionId) =>{
    if(!parent_id || !user_id || !receiver_id){
        console.error('parentid, receiver_id or userid is undefined');
        throw {status: 400, error:'parentid, receiver_id or userid is undefined'};
    }
    if(!opinion || !typeof(opinion) === 'string'){
        console.error('opinion is undefined or opinion is not a string')
        throw {status: 'opinion is undefined or opinion is not a string'};
    }

    const isOwner = user_id === receiver_id;

    const insertNotifPromise = supabase
    .from('notifications')
    .insert({type: 'reply', read: false, receiver_id: receiver_id, sender_id: user_id, journal_id: opinionId})

    const insertOpinionReplyPromise = supabase
    .from('opinions')
    .insert({user_id: user_id, parent_id: parent_id, opinion: opinion})

    const [ insertNotif, insertOpinionReply] = await Promise.all([
        isOwner ? Promise.resolve({error: null}) : insertNotifPromise, insertOpinionReplyPromise
    ])
    const {data: uploadOpinionReply, error: errorUploadOpinionReply} = insertOpinionReply;
    const {data: insertNotifResult, error: errorInsertNotif} = insertNotif;

    if(errorUploadOpinionReply || errorInsertNotif) {
        console.error('supabase error:', errorInsertNotif.message ||errorUploadOpinionReply.message);
        return {status: 500, error: 'supabaser error'}
    }

    return {message: 'success'};
}
