import express, { json, Router } from "express";
import supabase from "../services/supabase.js";
import multer from "multer";
import sharp from 'sharp';
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";
import ParseContent from "../utils/parseData.js";
import { verfifyTurnstileController } from "../controller/turnstileController.js";
import { getUserDataController } from "../controller/getUserDataController.js";
import { checkUserController } from "../controller/checkUserController.js";
import { addReplyOpinionController, updateJournalController, updateUserDataController, uploadJournalContentController, uploadJournalImageController, uploadProfileBgController, uploadUserDataController } from "../controller/uploadController.js";
import { updateFont } from "../controller/updateFontColorController.js";
import { deleteJournalContent, deleteJournalImageController } from "../controller/deleteController.js";
import { getBookmarksController, getCommentsController, getJournalsController, getReplyOpinionsController, getUserJournalsController, getViewOpinionController, getVisitedUserJournalsController } from "../controller/getController.js";
import { addBoorkmarkController, addCommentController, addFollowController, addOpinionReplyController, likeController } from "../controller/interactController.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {fileSize: 10 * 1024 * 1024},
}).single('image');

export const imageUploader = async(file, userId, bucket) =>{
    if(!file){
        return res.status(500).json({error: 'no file received'});
    }

    let img_buffer = null
    let img_url = null
    img_buffer = await sharp(file.buffer)
    .webp({quality: 80})
    .toBuffer();

    const folderName = `user_id_${userId}`;
    const fileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
    const filePath = `${folderName}/${fileName}`;

    const {data: uploadImage, error: errorUploadImage} = await supabase.storage
    .from(bucket)
    .upload(filePath, img_buffer, {
        contentType: 'image/webp',
        upsert: true
    })
    if(errorUploadImage){
        console.error('supabase error while uploading image to supabase bucket', errorUploadImage)
        return res.status(500).json({error: 'error uploading image into supabase bucket'});
    }
    const {data: data_url} = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath)
    
    if(data_url){
        img_url = data_url.publicUrl;
        return img_url;
    } else {
        throw new Error('Error uploading the image');
    }
}

router.post('/verify-turnstile', verfifyTurnstileController);

router.get('/getUserData', getUserDataController);

router.get('/check-user', checkUserController);

router.post('/upload-user-data', upload, uploadUserDataController);

router.post('/update-user-data', upload, updateUserDataController);

router.post('/updateFontColor', upload, updateFont);

router.post('/uploadBackground', upload, uploadProfileBgController);

router.post('/save-journal-image', upload, uploadJournalImageController);

router.post('/delete-journal-images', upload, deleteJournalImageController);

router.post('/save-journal', upload, uploadJournalContentController);

router.post('/update-journal', upload, updateJournalController);

router.get('/journals', getJournalsController);

router.get('/userJournals', getUserJournalsController);

router.get('/visitedUserJournals', getVisitedUserJournalsController);

router.delete('/deleteJournal/:journalId', deleteJournalContent);

router.post('/like', likeController);

router.post('/addComment',upload, addCommentController);

router.get('/getComments', getCommentsController);

router.post('/addBoorkmark',upload, addBoorkmarkController);

router.get('/getBookmarks', getBookmarksController)

router.post('/addFollows', upload, addFollowController);

router.get('/getFollowsData', async(req, res) => {
    const {userId, loggedInUserId} = req.query;
    if(!userId && !loggedInUserId) return res.status(400).json({error: 'userId or loggendUserId is undefined '});
    // console.log(req.query)
    try {
        const followersCountPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('following_id', userId);

        const followingCountPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('follower_id', userId)

        const isFollowingPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('follower_id', loggedInUserId)
        .eq('following_id', userId)

        const [followersCountResult, followingsCountResult, isFollowingResult] = await Promise.all([
            followersCountPromise, followingCountPromise, isFollowingPromise,
        ])


        const {count: followersCount, error: errorFollowers } = followersCountResult;
        const {count: followingsCount, error: errorFollowings} = followingsCountResult;
        const {count: isFollowingCount, error: errorIsfollowing} = isFollowingResult;

        if(errorFollowers || errorFollowings || errorIsfollowing){
            console.error('supabase error while fetching data:', errorFollowers.message, errorFollowings.message, errorIsfollowing.message)
            return res.status(500).json({error: 'failed to fetch data'})
        }

        return res.status(200).json({
            followersCount: followersCount,
            followingsCount: followingsCount,
            isFollowing: isFollowingCount > 0
        })

    } catch (error) {
        console.error('Error in Promise.all:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
    }

})

router.get('/getCountNotifications', async(req, res) =>{
    const {userId} = req.query;
    if(!userId) return res.attachment(400).json({error: 'no userid'});

    const [journalCount, opinionCount] = await Promise.all([
        supabase
            .from('notifications')
            .select('id', {count: 'exact', head: true})
            .eq('receiver_id', userId)
            .eq('read', false),
        supabase
            .from('notification_opinions')
            .select('id', {count: 'exact', head: true})
            .eq('receiver_id', userId)
            .eq('read', false)
    ]);

    if(journalCount.error || opinionCount.error){
        console.error('error fetching count in notifications table', journalCount.error || opinionCount.error);
        return res.status(500).json({error: 'error fecthing count in notifications table'});
    }

    return res.status(200).json({count: (journalCount.count || 0) + (opinionCount.count || 0)});
}) 

router.get('/getNotifications', async(req, res) =>{
    const {before, limit} = req.query;

    const token = req.headers?.authorization?.split(' ')[1];
    if(!token){
        console.error('not authorized')
        return res.status(400).json({error:'not authorized'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error:', errorAuthData.message);
        return res.status(500).json({error: 'error on checking authorization'})
    }

    const userId = authData?.user?.id;

    // Fetch a generous amount from both tables, then merge and paginate
    const fetchLimit = parseInt(limit) + 1;

    let journalQuery = supabase
    .from('notifications')
    .select(
        `*,
        journals!journal_id(title, content, created_at, likes(count), comments(count), bookmarks(count), users(name, id, image_url, badge)),
        users!sender_id(name, user_email, image_url, id, badge)
        `
    )
    .eq('receiver_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(fetchLimit)

    let opinionQuery = supabase
    .from('notification_opinions')
    .select(
        `*,
        opinions!opinion_id(id, opinion, user_id, created_at, users(name, id, image_url, badge)),
        users!sender_id(name, user_email, image_url, id, badge)
        `
    )
    .eq('receiver_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(fetchLimit)

    if(before){
        journalQuery = journalQuery.lt('created_at', before);
        opinionQuery = opinionQuery.lt('created_at', before);
    }

    const [journalResult, opinionResult] = await Promise.all([journalQuery, opinionQuery]);

    if(journalResult.error){
        console.error('error while fetching data from notification table:', journalResult.error);
        return res.status(500).json({error: 'error fetching data from notification table'});
    }
    if(opinionResult.error){
        console.error('error while fetching data from notification_opinions table:', opinionResult.error);
        return res.status(500).json({error: 'error fetching data from notification_opinions table'});
    }

    const journalNotifs = (journalResult.data || []).map(n => ({...n, source: 'journal'}));
    const opinionNotifs = (opinionResult.data || []).map(n => ({...n, source: 'opinion'}));

    // Merge and sort by created_at descending
    const merged = [...journalNotifs, ...opinionNotifs]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Likes/bookmarks lookup only for journal notifications
    const journalIds = merged.filter(n => n.source === 'journal').map(n => n.journal_id);

    let hasLikedResult = [];
    let hasBookMarkedResult = [];
    if(journalIds.length > 0){
        const [hasLiked, hasBookMarked] = await Promise.all([
            supabase.from('likes').select('journal_id').in('journal_id', journalIds).eq('user_id', userId),
            supabase.from('bookmarks').select('journal_id').in('journal_id', journalIds).eq('user_id', userId)
        ]);

        if(hasLiked.error || hasBookMarked.error){
            console.error('supabase error while fetching data:', hasLiked.error || hasBookMarked.error);
        }
        hasLikedResult = hasLiked.data || [];
        hasBookMarkedResult = hasBookMarked.data || [];
    }

    const userHasLikedSet = new Set(hasLikedResult.map((likes) => likes.journal_id));
    const userHasBookmarkedSet = new Set(hasBookMarkedResult.map((bookmarks) => bookmarks.journal_id));

    const formatted = merged.map((notif) => ({
        ...notif,
        hasLiked: notif.source === 'journal' ? userHasLikedSet.has(notif.journal_id) : false,
        hasBookMarked: notif.source === 'journal' ? userHasBookmarkedSet.has(notif.journal_id) : false
    }))

    const hasMore = formatted.length > parseInt(limit);
    const slicedData = hasMore ? formatted.slice(0, parseInt(limit)) : formatted;

    return res.status(200).json(
        {
            hasMore: hasMore,
            data: slicedData,
        }
    )

})

router.post('/readNotification', async(req, res) => {
    const {notifId, source} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token){
        console.error('no token!')
        return res.status(400).json({error: 'Not authorized'})
    }
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error authorizing user')
        return res.status(500).json({error: 'failed to authorized user'})
    }
    const userId = authData?.user?.id;

    const tableName = source === 'opinion' ? 'notification_opinions' : 'notifications';

    const {data : readNotification, error: errorReadNotification} = await supabase
    .from(tableName)
    .update({
        read: true
    })
    .eq('receiver_id', userId)
    .eq('id', notifId)

    if(errorReadNotification){
        console.error('error updating the notification read: boolean', errorReadNotification)
        return res.status(500).json({error: 'error updating the notification read: boolean'})
    }

    return res.status(200).json({message: 'notification was read!'})
})
router.get('/getUnreadNotification', async(req, res) => {
    const token = req.headers?.authorization?.split(' ')[1];
    const {limit, before} = req.query;
    if(!token){
        console.error('no token provided!')
        return res.status(400).json({error: 'not authorized'})
    }
    const{ data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error checking user authorization:', errorAuthData.message)
        return res.status(500).json({error: 'error checking authorization'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20){
        return res.status(400).json({error: 'limit must be between 1 and 20'});
    }

    const receiverId = authData?.user?.id;
    const fetchLimit = parsedLimit + 1;

    let journalQuery = supabase
    .from('notifications')
    .select(`
        *,
        journals!journal_id(title, content, created_at, likes(count), comments(count), bookmarks(count)),
        users!sender_id(name, user_email, image_url, id, badge)
        `)
    .eq('receiver_id', receiverId)
    .eq('read', false)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(fetchLimit)

    let opinionQuery = supabase
    .from('notification_opinions')
    .select(`
        *,
        opinions!opinion_id(id, opinion, user_id, created_at),
        users!sender_id(name, user_email, image_url, id, badge)
        `)
    .eq('receiver_id', receiverId)
    .eq('read', false)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(fetchLimit)

    if(before){
        journalQuery = journalQuery.lt('created_at', before);
        opinionQuery = opinionQuery.lt('created_at', before);
    }

    const [journalResult, opinionResult] = await Promise.all([journalQuery, opinionQuery]);

    if(journalResult.error){
        console.error('supabase error:', journalResult.error.message);
        return res.status(500).json({error: 'supabase error while getting unread notification'})
    }
    if(opinionResult.error){
        console.error('supabase error:', opinionResult.error.message);
        return res.status(500).json({error: 'supabase error while getting unread opinion notification'})
    }

    const journalNotifs = (journalResult.data || []).map(n => ({...n, source: 'journal'}));
    const opinionNotifs = (opinionResult.data || []).map(n => ({...n, source: 'opinion'}));

    const merged = [...journalNotifs, ...opinionNotifs]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const journalIds = merged.filter(n => n.source === 'journal').map(n => n.journal_id);

    let hasLikedResult = [];
    let hasBookMarkedResult = [];
    if(journalIds.length > 0){
        const [hasLiked, hasBookMarked] = await Promise.all([
            supabase.from('likes').select('journal_id').eq('user_id', receiverId).in('journal_id', journalIds),
            supabase.from('bookmarks').select('journal_id').eq('user_id', receiverId).in('journal_id', journalIds)
        ]);

        if(hasLiked.error || hasBookMarked.error){
            console.error('error', hasLiked.error || hasBookMarked.error)
            return res.status(500).json({error: 'supabase error on likes or bookmarks table'})
        }
        hasLikedResult = hasLiked.data || [];
        hasBookMarkedResult = hasBookMarked.data || [];
    }

    const userHasLikedSet = new Set(hasLikedResult.map((like) => like.journal_id));
    const userHasBookmarkedSet = new Set(hasBookMarkedResult.map((bookmark) => bookmark.journal_id));

    const formatted = merged.map((notification) =>({
        ...notification,
        hasLiked: notification.source === 'journal' ? userHasLikedSet.has(notification?.journal_id) : false,
        hasBookMarked: notification.source === 'journal' ? userHasBookmarkedSet.has(notification?.journal_id) : false
    }))

    const hasMore = formatted.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json({
        data: slicedData,
        hasMore: hasMore
    })
})

router.delete('/deleteNotification/:notifId', async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    const {notifId} = req.params;
    const {source} = req.query;

    if(!token){
        console.error('no token is provided!')
        return res.status(400).json({error: 'not auhtorized'})
    }
    if(!notifId){
        console.error('no notification id provided')
        return res.status(400).json({error: 'not notifId'})
    }

    const {data : authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error checking authorization:', errorAuthData);
        return res.status(500).json({error: 'Error checking user authorization'});
    }
    const userId = authData?.user?.id;

    const tableName = source === 'opinion' ? 'notification_opinions' : 'notifications';

    const {data: deleteNotif, error: errorDeleteNotif} = await  supabase
    .from(tableName)
    .delete()
    .eq('receiver_id', userId)
    .eq('id', notifId)

    if(errorDeleteNotif){
        console.error('supabase error while deleting notification:', errorDeleteNotif.message);
        return res.status(500).json({error: 'supabase error while deleting notification'})
    }

    return res.status(200).json({message: 'success'});
})


router.post('/addViews', upload, async(req, res) => {
    const {journalId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];

    if(!journalId) {
        console.error('not journalId');
        return res.status(400).json({error: 'no journalId!'});
    }
    if(!token){
        console.error('error: no token provided!');
        return res.status(400).json({error: 'no token!'});
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error:', errorAuthData);
        return res.status(500).json({error: 'supabase error while checking user authentication'})
    }

    const viewerId = authData?.user?.id;

    const {data: addViews, error: errorAddViews} = await supabase
    .from('journal_views')
    .insert({
        viewer_id: viewerId,
        journal_id: journalId
    })

    if(errorAddViews){
        console.error('error:', errorAddViews.message);
        return res.status(500).json({error: 'error adding views'});
    }

    await supabase.rpc('increment_journal_view', {j_post_id: journalId});

    return res.status(200).json({message: 'success!'});

})

router.post('/updatePrivacy', upload, async(req, res) => {
    const token = req.headers?.authorization?.split(' ')[1];
    const {journalId, privacy} = req.body;
    // console.log(privacy)

    if(!token){
        console.error('error: no token!')
        return res.status(400).json({error: 'no token!'})
    }
    if(!journalId){
        console.error('no journalId')
        return res.status(400).json({error: 'no journalId'});
    }
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
    
    if(errorAuthData){
        console.error('supabase error while checking authorization:', errorAuthData.message);
        return res.status(500).json({error: 'supabase error while checking authorization'})
    }
    const userId = authData?.user?.id;

    const {data: updatePrivacy, error: errorUpdatePrivacy} = await supabase
    .from('journals')
    .update({privacy: privacy})
    .eq('id', journalId)
    .eq('user_id', userId)

    if(errorUpdatePrivacy){
        console.error('updating journal privacy error:', errorUpdatePrivacy);
        return res.status(500).json({error: 'error updating journal privacy'});
    }

    return res.status(200).json({message: 'success'});
})

router.post('/addCollections', upload, async(req, res) => {
    const token = req.headers?.authorization?.split(' ')[1];
    let {journalIds, title, description} = req.body;

    if(typeof journalIds === 'string'){
        journalIds = journalIds.split(',').map(id => id.trim()).filter(id => id !== '');
    }

    if(!token){
        console.error('no token provided!')
        return res.status(400).json({error: 'no token!'})
    }
    if(!title || !description){
        console.error('no collections title or description')
        return res.status(400).json({error: 'no collections title or description'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error getting authorization', errorAuthData.message);
        return res.status(500).json({error: 'supabase error while checking authorization'})
    }

    const userId = authData.user.id;

    try {
        const {data: collections, error: errorCollections} = await supabase
        .from('collections')
        .insert({
            name: title,
            description: description,
            user_id: userId
        })
        .select()
        .single()

        if(errorCollections){
            console.error('error inserting data to database', errorCollections.message)
            return res.status(500).json({error: 'error inserting data to database'})
        }

        if(Array.isArray(journalIds) && journalIds.length > 0){
            const collectionJournals = journalIds.map(journalId => ({
                collection_id: collections.id,
                journal_id: journalId,
            }))

            const {data: linkedJournals, error: errorLinkedJournals} = await supabase
            .from('collection_journal')
            .insert(collectionJournals)

            if(errorLinkedJournals){
                console.error('error inserting linked journals', errorLinkedJournals.message);
                return res.status(500).json({error: 'error inserting linkedjournals'})
            }
        }

        return res.status(200).json({message: 'success'})
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
})

router.post('/updateCollection', upload, async(req, res) =>{
    let {journalIds, collectionId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];

    if(!token){
        console.error('no token')
        return res.status(400).json({error: 'no token!'})
    }

    if(!collectionId){
        console.error('no collection id')
        return res.status(400).json({error: 'no collection id'})
    }

    if(typeof journalIds === 'string'){
        journalIds = journalIds.split(',').map((id) => id.trim()).filter((id) => id !== '');
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('not authorized', errorAuthData.message);
        return res.status(500).json({error: 'supabase error while authorizing user'})
    }

    if(Array.isArray(journalIds) && journalIds.length > 0){
        const ids = journalIds.map((journalId) => ({
            journal_id: journalId,
            collection_id: collectionId
        }))
        
        console.log(ids);

        const {error: errorUpdatingCollection} = await supabase
            .from('collection_journal')
            .insert(ids)

        
        if(errorUpdatingCollection){
            console.error('error updating collections', errorUpdatingCollection.message)
            return res.status(500).json({eror: 'error updating collections'})
        }
    }

    return res.status(200).json({message: 'success'})

})

router.get('/getCollections', async(req, res) => {
    const {userId, before, limit} = req.query;
    
    if(!userId){
        console.error('error: no collectionid or userid')
        return res.status(400).json({error: 'no collection id or user id'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit > 10 || parsedLimit < 1){
        console.error('limit should be between 1 to 10')
        return res.status(400).json({error: 'limit should only between 1 - 10'})
    }

    let query = supabase
    .from('collections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: getCollections, error: errorGetCollections} = await query;

    if(errorGetCollections){
        console.error('error getting collections:', errorGetCollections.message);
        return res.status(500).json({error: 'error getting collections'})
    }

    if(!getCollections || getCollections.length === 0){
        return res.status(200).json({data: [], hasMore: false})
    }

    const hasMore = getCollections.length > parsedLimit;
    const slicedData = hasMore ?  getCollections.slice(0, parsedLimit) : getCollections;

    return res.status(200).json({data: slicedData, hasMore: hasMore})
})

router.get('/getCollectionJournals', async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    const {collectionId, before, limit} = req.query;

    if(!collectionId) {
        console.error('no collectionId')
        return res.status(400).json({error: 'no collection ID'});
    }
    if(!token){
        console.error('no token!')
        return res.status(400).json({error: 'no token!'})
    }

    const parsedLimit = parseInt(limit);

    if(isNaN(parsedLimit) || parsedLimit > 10 || parsedLimit < 1){
        console.error('limit should only between 1-10');
        return res.status(400).json({error: 'Limit should only between 1-10'})
    }

    let authorization = supabase.auth.getUser(token);

    let query = supabase
    .from('collection_journal')
    .select('id, journals(title, created_at, id,content, users(id, image_url, user_email, name), comments!post_id(count), bookmarks!journal_id(count), likes!journal_id(count))')
    .eq('collection_id', collectionId)
    .limit(parsedLimit + 1)
    .order('id', {ascending: false})

    if(before){
        query = query.lt('id', before);
    }

    const [journaResult, authorizationResult] = await Promise.all([
        query, authorization
    ])

    const {data: journals, error: errorJournals} = journaResult;
    const {data: authData, error: errorAuthData} = authorizationResult;

    if(errorJournals || errorAuthData){
        console.error('supabase error while fetching data:', errorJournals.message || errorAuthData.message);
        return res.status(500).json({error: 'supabase error while fetching data'});
    }
    const userId = authData?.user?.id;
    const journalIds = journals?.map((journal) => journal.journals.id) || [];

    let hasLikedPromise;
    let hasBookmarkedPromise;

    if(journalIds){
        hasLikedPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)

        hasBookmarkedPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)
    }

    const [hasLikedResult, hasBookMarkedResult] = await Promise.all([hasLikedPromise, hasBookmarkedPromise]);

    const {data: hasLiked, error: errorHasLiked} = hasLikedResult;
    const {data: hasBookMarked, error: errorHasbookmarked} = hasBookMarkedResult;

    if(errorHasLiked || errorHasbookmarked){
        console.error('error fetching data',  errorHasLiked || errorHasbookmarked);
        return res.status(500).json({error: 'error fetching data'});
    }

    const userHasLikedSet = new Set(hasLiked.map((journal) => journal.journal_id) || []);
    const userHasBookmarkedSet = new Set(hasBookMarked.map((bookmark) => bookmark.journal_id) || []);

    const formatted  = journals.map((journal) => ({
        ...journal,
        hasLiked: userHasLikedSet?.has(journal?.journals.id),
        hasBookMarked: userHasBookmarkedSet?.has(journal?.journals.id)
    }))

    const hasMore = journals.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json({data: slicedData, hasMore: hasMore})

})

router.get('/getNotCollectedPost', async(req, res) => {
    const {before, limit, userId, collectionId} = req.query;

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit > 10 || parsedLimit < 1){
        console.error('limit should be between 1 to 10');
        return res.status(500).json({error: 'limit should be between 1 to 10'});
    }

    if(!userId){
        console.error('no userId!');
        return res.status(400).json({error: 'no userId'});
    }
    if(!collectionId){
        console.error('no collectionId');
        return res.status(400).json({error: 'no collectionId'})
    }

    let query = supabase
    .from('journals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: journals, error: errorJournals} = await query;
    

    if(errorJournals){
        console.error('error:', errorJournals.message);
        return res.status(500).json({error: 'error fetching journals or collectionJournals Ids'})
    }
    
    const journalIds = journals.map((journal) => journal.id) || [];

    let collectedJournals;
    if(journalIds){
        collectedJournals = supabase
        .from('collection_journal')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('collection_id', collectionId)
    }

    const {data: collectedJournalIds, error: errorCollectedJournalIds} = await collectedJournals;

    if(errorCollectedJournalIds){
        console.error('error:', errorCollectedJournalIds.message);
        return res.status(500).json({error: 'error fetching collected journals'})
    }

    const journalIdSet = new Set(collectedJournalIds.map((j) => j.journal_id)  || []);

    const formatted = journals.map((journal) => ({
        ...journal,
        hasCollected: journalIdSet.has(journal.id)
    }))

    const hasMore = journals.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.delete('/deleteCollection/:collectionId', async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    const {collectionId} = req.params;

    if(!token){
        console.error('no token!')
        return res.status(400).json({error: 'no token!'});
    }
    if(!collectionId){
        console.error('no collectionId');
        return res.status(400).json({error: 'no collectionId'});
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error:', errorAuthData.message);
        return res.status(500).json({error: 'error authorizing user!'})
    }

    const userId = authData.user.id;

    const {data: deleteCollection, error: errorDeleteCollection} = await supabase
    .from('collections')
    .delete()
    .eq('id', collectionId)
    .eq('user_id', userId)

    if(errorDeleteCollection){
        console.error('supabase error while deleting collections', errorDeleteCollection.message);
        return res.status(500).json({error: 'error deleting colletion'});
    }

    return res.status(200).json({message: 'delete successful'});
})

router.post('/updatePrivacyCollection', upload, async(req, res) => {
    const {collectionId, userId, isPublic} = req.body;

    if(!collectionId && !userId){
        console.error('no collectionId or userId');
        return res.status(400).json({error: 'error no collectionId or userId'});
    }

    const {data: updatePrivacy, error: errorUpdatePrivacy} = await supabase
    .from('collections')
    .update({is_public: isPublic})
    .eq('user_id', userId)
    .eq('id', collectionId)

    if(errorUpdatePrivacy){
        console.error('error updating privacy:', errorUpdatePrivacy.message);
        return res.status(500).json({error: 'error updating privacy'})
    }

    return res.status(200).json({message: 'success'})

})

router.post('/addOpinion', upload, async(req, res) =>{
    const token = req.headers.authorization.split(' ')[1];
    const {opinion} = req.body;
    if(!token){
        console.error('No token available')
        return res.status(400).json({error: 'not authorized'})
    }
    if(!opinion || opinion.length > 280){
        console.error('no opinion or opinion is over 280 characters');
        return res.status(400).json({error: 'no opinion or opinion is over 280 characters'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error:', errorAuthData.message)
        return res.status(500).json({error: 'supabase error'})
    }

    const userId= authData.user.id;

    const {error} = await supabase
    .from('opinions')
    .insert({
        user_id: userId,
        opinion: opinion
    })

    if(error){
        console.err('supabase error:', error.message);
        return res.status(500).json({error: 'supabase error'})
    }

    return res.status(200).json({message: 'success'});
})

router.get('/getOpinions', async(req, res) => {
    const {before, limit} = req.query;

    const paresedLimit = parseInt(limit);
    if(isNaN(paresedLimit || paresedLimit > 20 || paresedLimit < 1)) {
        console.log('limit should be number or and it should not be between 1 - 20');
        return res.status(400).json({error: 'limit should be number or and it should not be between 1 -10'});
    }

    let query = supabase
    .from('opinions')
    .select('*, users(name, id, user_email, image_url, badge, background, profile_font_color, dominant_colors, secondary_colors)')
    .is('parent_id', null)
    .order('id', {ascending: false})
    .limit(paresedLimit + 1)

    if(before) {
        query = query.lt('id', before);
    }
    
    const {data: opinions, error: errorOpinions} = await query;

    if(errorOpinions){
        console.log('supabase error:', errorOpinions.message);
        return res.status(500).json({error: 'supabase error on fetching opinions from database'});
    }

    const hasMore = opinions?.length > paresedLimit;
    const slicedData =  hasMore ? opinions.splice(0, paresedLimit) : opinions;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.get('/getMyOpinions', async(req, res) =>{
    const {limit, before} = req.query;
    const parsedLimit = parseInt(limit);

    const token = req.headers?.authorization.split(' ')[1];
    
    if(!token){
        console.error('No token available');
        return res.status(400).json({error: 'No token available'});
    }

    if(isNaN(parsedLimit) || parsedLimit.length > 20 || parsedLimit.length < 1){
        console.error('limit should be number and between 1 - 20');
        return res.status(400).json({error:'limit should be number and between 1 - 20'});
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token)

    if(errorAuthData){
        console.error('supabase error while checking authorization', errorAuthData.message)
        return res.status(500).json({errpr: 'supabase error while checking authorization'})
    }

    const userId = authData?.user.id;

    let query = supabase
    .from('opinions')
    .select('*')
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)
    .eq('user_id', userId)
    .is('parent_id', null)

    if(before){
        query = query.lt('id', before) //limit or lt mieans it will start to fetch from the value of before 
    }

    const {data: opinionsData, error: errorOpinionsData} = await query;

    if(errorOpinionsData){
        console.error('supabase error while fetching opinions data:', errorOpinionsData.message);
        return res.status(500).json({error: 'supabase error while fetching the users opinions'});
    }

    const hasMore = opinionsData.length > parsedLimit;
    const slicedData = hasMore ? opinionsData.splice(0, parsedLimit) : opinionsData;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
    
})

router.get('/getUserOpinions', async(req, res) =>{
    const {limit, before, userId} = req.query;
    const parsedLimit = parseInt(limit);

    if(isNaN(parsedLimit) || parsedLimit > 20 || parsedLimit < 1){
        console.error('limit should be number and not be greater than 20 or less than 1')
        return res.status(400).json({error: 'limit should be number and not be greater than 20 or less than 1'});
    }

    if(!userId){
        console.error('no user id!')
        return res.status(400).json({error: 'no user id available!'});
    }

    let query = supabase
    .from('opinions')
    .select('*, users(name, user_email, image_url, id, badge)')
    .limit(parsedLimit + 1)
    .eq('user_id', userId)
    .is('parent_id', null)
    .order('id', {ascending: false})

    if(before){
        query = query.lt('id', before);
    }

    const {data: opinionsData, error: errorOpinionsData} = await query;

    if(errorOpinionsData){
        console.error('supabase error while fetching opinions:', errorOpinionsData.message);
        return res.status(500).json({error: 'supabase error while fetching opinions'});
    }

    const hasMore = opinionsData.length > parsedLimit;
    const slicedData = hasMore ? opinionsData.splice(0, parsedLimit) : opinionsData;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.post('/submitReply/:parent_id/:user_id/:post_id/:receiver_id',upload, async(req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const {parent_id, user_id, receiver_id, post_id} = req.params;
    const {reply} = req.body;

    if(!token){
        console.error('no token available')
        return res.status(400).json({error: 'you are not authorized user'});
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error while checking auhtorization:', errorAuthData.message);
        return res.status(500).json({error: 'authorization error'});
    }

    const isOwner = authData?.user?.id === receiver_id

    if(!parent_id || !user_id || !post_id){
        console.error('no parent_id || user_id || post_id available')
        return res.status(400).json({error: 'parent_id || user_id || post_id is missing'});
    }
    if(!reply || reply.length > 201 || typeof reply !== 'string'){
        console.error('make sure the reply is a string and not over 200 characters');
        return res.status(400).json({error: 'reply is not a string or maybe undefined'});
    }

    const insertReplyPromise = supabase
    .from('comments')
    .insert({post_id: post_id, user_id: user_id, comment: reply, parent_id: parent_id})

    const insertNotifPromise = supabase
    .from('notifications')
    .insert({sender_id: user_id, receiver_id: receiver_id, type: 'reply', journal_id: post_id, read: false})  

    const [insertNotif, insertReply] = await Promise.all([
        isOwner ? Promise.resolve({error: null}) : insertNotifPromise, 
        insertReplyPromise
    ])


    const {data: uploadReply, error: errorUploadReply} = insertReply;
    const {data: notif, error: errorNotif} = insertNotif;

    if(errorUploadReply || errorNotif){
        console.error('supabase error:', errorUploadReply.message || errorNotif.message);
        return res.status(500).json({error: 'supabase error'});
    }

    return res.status(200).json({message: 'success'});
})

router.get('/getPostReplies/:parent_id', async(req, res) => {
    const {parent_id} = req.params;
    const {limit, before} = req.query;
    
    if(!parent_id){
        console.error('parent_id is undefined');
        return res.status(400).json({error: 'parent_id is undefined'});
    }

    const parsedLimit = parseInt(limit);

    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20){
        console.error('limit should be intiger or it should be between 1 to 20');
        return res.status(400).json({error: 'limit should be intiger or it should be between 1 to 20'});
    }

    let query = supabase
    .from('comments')
    .select('*, users(name, image_url, id, user_email, badge)')
    .eq('parent_id', parent_id)
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('id', before);
    }

    const {data: getPostReplies, error: getPostRepliesError} = await query;

    if(getPostRepliesError){
        console.error('supabase error while fetchind replies:', getPostRepliesError.message);
        return res.status(500).json({error: 'supabase error while getting post replies'});
    }

    const hasMore = getPostReplies.length > parsedLimit;
    const slicedData = hasMore ? getPostReplies.splice(0, parsedLimit) : getPostReplies;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.get('/viewOpinion/:postId/:userId', getViewOpinionController);

router.post('/addOpinionReply/:parent_id/:user_id/:receiver_id', upload, addOpinionReplyController);

router.get('/getOpinionReply/:parentId', getReplyOpinionsController);


export default router;