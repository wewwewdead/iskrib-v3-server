import express from "express";
import supabase from "../services/supabase.js";
import multer from "multer";
import sharp from 'sharp';
import { getUserByUsernameService } from "../services/getUserDataService.js";
import { verfifyTurnstileController } from "../controller/turnstileController.js";
import { getUserDataController } from "../controller/getUserDataController.js";
import { checkUserController } from "../controller/checkUserController.js";
import { addReplyOpinionController, completeOnboardingController, updateJournalController, updateRepostCaptionController, updateUserDataController, uploadJournalContentController, uploadJournalImageController, uploadProfileBgController, uploadUserDataController } from "../controller/uploadController.js";
import { updateFont } from "../controller/updateFontColorController.js";
import { deleteJournalContent, deleteJournalImageController, deleteProfileMediaImageController } from "../controller/deleteController.js";
import { getBookmarksController, getCommentsController, getFollowingFeedController, getJournalByIdController, getJournalsController, getMonthlyHottestJournalsController, getProfileMediaController, getReplyOpinionsController, getUserJournalsController, getViewOpinionController, getVisitedProfileMediaController, getVisitedUserJournalsController, searchJournalsController, searchUsersController } from "../controller/getController.js";
import { addBoorkmarkController, addCommentController, addFollowController, addOpinionReplyController, likeController, repostController } from "../controller/interactController.js";
import { createStoryController, getStoriesController, getStoryByIdController, updateStoryController, deleteStoryController, getMyStoriesController, getUserStoriesController } from "../controller/storyController.js";
import { createChapterController, getChapterController, updateChapterController, deleteChapterController, reorderChaptersController } from "../controller/chapterController.js";
import { toggleVoteController, toggleLibraryController, getMyLibraryController, getCommentsController as getStoryCommentsController, getCommentCountsController, addCommentController as addStoryCommentController, saveProgressController, getProgressController } from "../controller/storyInteractController.js";
import { getRelatedPostsController } from "../controller/discoveryController.js";
import { getStreakService, recordPublishForStreak } from "../services/streakService.js";
import { getTodaysPromptController, getPromptResponsesController } from "../controller/promptController.js";
import { toggleReactionController, getPostReactionsController } from "../controller/reactionController.js";
import { getWeeklyRecapController } from "../controller/recapController.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {fileSize: 10 * 1024 * 1024},
}).single('image');

const extractBearerToken = (authHeader = "") => {
    const trimmed = typeof authHeader === "string" ? authHeader.trim() : "";
    if (!trimmed) return "";

    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
        return bearerMatch[1].trim();
    }

    return trimmed;
};

const resolveAuthUser = async (token) => {
    if (!token) {
        return { user: null, error: null };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
        return { user: null, error: authError || new Error("missing user id") };
    }

    return { user: authData.user, error: null };
};

const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) {
        return res.status(401).json({ error: 'not authorized' });
    }

    const { user, error } = await resolveAuthUser(token);
    if (error || !user?.id) {
        console.error('auth middleware error:', error?.message || 'missing user id');
        return res.status(401).json({ error: 'not authorized' });
    }

    req.userId = user.id;
    req.authUser = user;
    return next();
};

const optionalAuth = async (req, _res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) {
        return next();
    }

    const { user } = await resolveAuthUser(token);
    if (user?.id) {
        req.userId = user.id;
        req.authUser = user;
    }

    return next();
};

const NOTIFICATION_LIMIT_MIN = 1;
const NOTIFICATION_LIMIT_MAX = 20;
const NOTIFICATION_DEFAULT_LIMIT = 5;
const NOTIFICATION_JOURNAL_SELECT = `
    id,
    sender_id,
    receiver_id,
    journal_id,
    repost_journal_id,
    type,
    reaction_type,
    read,
    created_at,
    journals!journal_id(
        title,
        content,
        created_at,
        likes(count),
        comments(count),
        bookmarks(count),
        users(id, name, image_url, badge)
    ),
    users!sender_id(id, name, image_url, badge)
`;
const NOTIFICATION_OPINION_SELECT = `
    id,
    sender_id,
    receiver_id,
    opinion_id,
    read,
    created_at,
    opinions!opinion_id(id, opinion, user_id, created_at),
    users!sender_id(id, name, image_url, badge)
`;
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

const parseLimitWithinRange = (value, min, max, fallback = null) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    if (parsed < min || parsed > max) {
        return null;
    }
    return parsed;
};

export const imageUploader = async(file, userId, bucket) =>{
    if(!file){
        throw new Error('no file received');
    }

    const sourceBuffer = Buffer.isBuffer(file) ? file : file?.buffer;
    if(!sourceBuffer){
        throw new Error('invalid file payload');
    }

    let img_buffer = null
    let img_url = null
    img_buffer = await sharp(sourceBuffer)
    .webp({quality: 80})
    .toBuffer();

    const folderName = `user_id_${userId}`;
    const fileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
    const filePath = `${folderName}/${fileName}`;

    const {data: uploadImage, error: errorUploadImage} = await supabase.storage
    .from(bucket)
    .upload(filePath, img_buffer, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true
    })
    if(errorUploadImage){
        console.error('supabase error while uploading image to supabase bucket', errorUploadImage)
        throw new Error('error uploading image into supabase bucket');
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

router.post('/upload-user-data', requireAuth, upload, uploadUserDataController);

router.post('/update-user-data', requireAuth, upload, updateUserDataController);

router.post('/updateFontColor', requireAuth, upload, updateFont);

router.post('/uploadBackground', requireAuth, upload, uploadProfileBgController);

router.post('/save-journal-image', requireAuth, upload, uploadJournalImageController);

router.post('/delete-journal-images', requireAuth, upload, deleteJournalImageController);
router.delete('/media/image', requireAuth, deleteProfileMediaImageController);

router.post('/save-journal', requireAuth, upload, uploadJournalContentController);

router.post('/update-journal', requireAuth, upload, updateJournalController);

router.post('/update-repost-caption', requireAuth, updateRepostCaptionController);

router.post('/complete-onboarding', requireAuth, completeOnboardingController);

router.get('/journals/following', requireAuth, getFollowingFeedController);
router.get('/journals', getJournalsController);
router.get('/journals/hottest-monthly', getMonthlyHottestJournalsController);
router.get('/journals/search', searchJournalsController);
router.get('/users/search', searchUsersController);
router.get('/journal/:journalId/related', getRelatedPostsController);
router.get('/journal/:journalId', getJournalByIdController);

router.get('/userJournals', requireAuth, getUserJournalsController);
router.get('/profileMedia', requireAuth, getProfileMediaController);
router.get('/visitedProfileMedia', requireAuth, getVisitedProfileMediaController);

router.get('/visitedUserJournals', getVisitedUserJournalsController);

router.delete('/deleteJournal/:journalId', requireAuth, deleteJournalContent);

router.post('/like', requireAuth, likeController);

router.post('/repost', requireAuth, repostController);

router.post('/addComment', requireAuth, upload, addCommentController);

router.get('/getComments', getCommentsController);

router.post('/addBoorkmark', requireAuth, upload, addBoorkmarkController);

router.get('/getBookmarks', requireAuth, getBookmarksController)

router.post('/addFollows', requireAuth, upload, addFollowController);

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

router.get('/getCountNotifications', requireAuth, async(req, res) =>{
    const userId = req.userId;
    if(!userId) return res.status(400).json({error: 'no userid'});

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

router.get('/getNotifications', requireAuth, async(req, res) =>{
    const {before} = req.query;
    const userId = req.userId;
    const parsedLimit = parseLimitWithinRange(
        req.query.limit,
        NOTIFICATION_LIMIT_MIN,
        NOTIFICATION_LIMIT_MAX,
        NOTIFICATION_DEFAULT_LIMIT
    );

    if(parsedLimit == null){
        return res.status(400).json({error: `limit must be between ${NOTIFICATION_LIMIT_MIN} and ${NOTIFICATION_LIMIT_MAX}`});
    }

    // Fetch a generous amount from both tables, then merge and paginate
    const fetchLimit = parsedLimit + 1;

    let journalQuery = supabase
    .from('notifications')
    .select(NOTIFICATION_JOURNAL_SELECT)
    .eq('receiver_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(fetchLimit)

    let opinionQuery = supabase
    .from('notification_opinions')
    .select(NOTIFICATION_OPINION_SELECT)
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
    const journalIds = [...new Set(
        merged
            .filter((n) => n.source === 'journal')
            .map((n) => n.journal_id)
            .filter(Boolean)
    )];

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

    const hasMore = formatted.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json(
        {
            hasMore: hasMore,
            data: slicedData,
        }
    )

})

router.post('/readNotification', requireAuth, async(req, res) => {
    const {notifId, source} = req.body;
    const userId = req.userId;

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
router.get('/getUnreadNotification', requireAuth, async(req, res) => {
    const {before} = req.query;

    const parsedLimit = parseLimitWithinRange(
        req.query.limit,
        NOTIFICATION_LIMIT_MIN,
        NOTIFICATION_LIMIT_MAX,
        NOTIFICATION_DEFAULT_LIMIT
    );

    if(parsedLimit == null){
        return res.status(400).json({error: `limit must be between ${NOTIFICATION_LIMIT_MIN} and ${NOTIFICATION_LIMIT_MAX}`});
    }

    const receiverId = req.userId;
    const fetchLimit = parsedLimit + 1;

    let journalQuery = supabase
    .from('notifications')
    .select(NOTIFICATION_JOURNAL_SELECT)
    .eq('receiver_id', receiverId)
    .eq('read', false)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(fetchLimit)

    let opinionQuery = supabase
    .from('notification_opinions')
    .select(NOTIFICATION_OPINION_SELECT)
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

    const journalIds = [...new Set(
        merged
            .filter((n) => n.source === 'journal')
            .map((n) => n.journal_id)
            .filter(Boolean)
    )];

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

router.delete('/deleteNotification/:notifId', requireAuth, async(req, res) =>{
    const {notifId} = req.params;
    const {source} = req.query;

    if(!notifId){
        console.error('no notification id provided')
        return res.status(400).json({error: 'not notifId'})
    }
    const userId = req.userId;

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


router.post('/addViews', requireAuth, upload, async(req, res) => {
    const {journalId} = req.body;

    if(!journalId) {
        console.error('not journalId');
        return res.status(400).json({error: 'no journalId!'});
    }
    const viewerId = req.userId;

    const {data: addViews, error: errorAddViews} = await supabase
    .from('journal_views')
    .insert({
        viewer_id: viewerId,
        journal_id: journalId
    })

    if(errorAddViews){
        const isDuplicateView =
            errorAddViews?.code === '23505' ||
            (errorAddViews?.message || '').includes('unique_journal_views');

        if(isDuplicateView){
            return res.status(200).json({message: 'success!', counted: false});
        }

        console.error('error:', errorAddViews.message);
        return res.status(500).json({error: 'error adding views'});
    }

    const {error: incrementError} = await supabase.rpc('increment_journal_view', {j_post_id: journalId});
    if(incrementError){
        console.error('error incrementing journal view:', incrementError.message);
        return res.status(500).json({error: 'error incrementing views'});
    }

    return res.status(200).json({message: 'success!', counted: true});

})

router.post('/updatePrivacy', requireAuth, upload, async(req, res) => {
    const {journalId, privacy} = req.body;
    // console.log(privacy)
    if(!journalId){
        console.error('no journalId')
        return res.status(400).json({error: 'no journalId'});
    }
    const userId = req.userId;

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

router.post('/addOpinion', requireAuth, upload, async(req, res) =>{
    const {opinion} = req.body;
    if(!opinion || opinion.length > 280){
        console.error('no opinion or opinion is over 280 characters');
        return res.status(400).json({error: 'no opinion or opinion is over 280 characters'})
    }
    const userId = req.userId;

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

    // Non-fatal: record publish for writing streak
    try {
        recordPublishForStreak(userId).catch(err =>
            console.error('non-fatal: streak record failed:', err?.message || err)
        );
    } catch (streakErr) {
        console.error('non-fatal: streak record failed:', streakErr?.message || streakErr);
    }

    return res.status(200).json({message: 'success'});
})

router.get('/getOpinions', async(req, res) => {
    const {before, limit} = req.query;

    const paresedLimit = parseInt(limit);
    if(isNaN(paresedLimit) || paresedLimit > 20 || paresedLimit < 1) {
        console.log('limit should be number or and it should not be between 1 - 20');
        return res.status(400).json({error: 'limit should be number and it should be between 1 - 20'});
    }

    let query = supabase
    .from('opinions')
    .select(OPINION_LIST_SELECT)
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
    const slicedData =  hasMore ? opinions.slice(0, paresedLimit) : opinions;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.get('/getMyOpinions', requireAuth, async(req, res) =>{
    const {limit, before} = req.query;
    const parsedLimit = parseInt(limit);

    if(isNaN(parsedLimit) || parsedLimit > 20 || parsedLimit < 1){
        console.error('limit should be number and between 1 - 20');
        return res.status(400).json({error:'limit should be number and between 1 - 20'});
    }

    const userId = req.userId;

    let query = supabase
    .from('opinions')
    .select(MY_OPINION_SELECT)
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
    const slicedData = hasMore ? opinionsData.slice(0, parsedLimit) : opinionsData;

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
    .select(USER_OPINION_SELECT)
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
    const slicedData = hasMore ? opinionsData.slice(0, parsedLimit) : opinionsData;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.post('/submitReply/:parent_id/:user_id/:post_id/:receiver_id', requireAuth, upload, async(req, res) => {
    const {parent_id, receiver_id, post_id} = req.params;
    const user_id = req.userId;
    const {reply} = req.body;
    const isOwner = req.userId === receiver_id

    if(!parent_id || !post_id || !receiver_id){
        console.error('no parent_id || post_id || receiver_id available')
        return res.status(400).json({error: 'parent_id || post_id || receiver_id is missing'});
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
    .select(COMMENT_REPLY_SELECT)
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
    const slicedData = hasMore ? getPostReplies.slice(0, parsedLimit) : getPostReplies;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.get('/viewOpinion/:postId/:userId', getViewOpinionController);

router.post('/addOpinionReply/:parent_id/:user_id/:receiver_id', requireAuth, upload, addOpinionReplyController);

router.get('/getOpinionReply/:parentId', getReplyOpinionsController);

// ── Username endpoints ──
router.get('/user/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const data = await getUserByUsernameService(username);
        return res.status(200).json(data);
    } catch (error) {
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.message || 'error fetching user' });
    }
});

router.get('/check-username/:username', async (req, res) => {
    const { username } = req.params;
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'username is required' });
    }

    const normalized = username.trim().toLowerCase();
    const RESERVED_WORDS = ['admin', 'root', 'iskrib', 'iskryb', 'support', 'help', 'api', 'www', 'null', 'undefined'];
    if (RESERVED_WORDS.includes(normalized)) {
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

router.post('/update-username', requireAuth, async (req, res) => {
    const userId = req.userId;
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'username is required' });
    }

    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 50) {
        return res.status(400).json({ error: 'username must be 3-50 characters' });
    }

    if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
        return res.status(400).json({ error: 'username can only contain letters, numbers, and hyphens' });
    }

    const normalized = trimmed.toLowerCase();
    const RESERVED_WORDS = ['admin', 'root', 'iskrib', 'iskryb', 'support', 'help', 'api', 'www', 'null', 'undefined'];
    if (RESERVED_WORDS.includes(normalized)) {
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
        .update({ username: trimmed.toLowerCase() })
        .eq('id', userId);

    if (updateError) {
        console.error('update-username error:', updateError.message);
        return res.status(500).json({ error: 'failed to update username' });
    }

    return res.status(200).json({ message: 'success', username: trimmed.toLowerCase() });
});


// ── Story routes ──
router.post('/stories', requireAuth, upload, createStoryController);
router.get('/stories', optionalAuth, getStoriesController);
router.get('/stories/my', requireAuth, getMyStoriesController);
router.get('/stories/library', requireAuth, getMyLibraryController);
router.get('/stories/user/:userId', optionalAuth, getUserStoriesController);
router.get('/stories/:storyId', optionalAuth, getStoryByIdController);
router.patch('/stories/:storyId', requireAuth, upload, updateStoryController);
router.delete('/stories/:storyId', requireAuth, deleteStoryController);

// ── Chapter routes ──
router.post('/stories/:storyId/chapters', requireAuth, createChapterController);
router.get('/stories/:storyId/chapters/:chapterId', optionalAuth, getChapterController);
router.patch('/stories/:storyId/chapters/:chapterId', requireAuth, updateChapterController);
router.delete('/stories/:storyId/chapters/:chapterId', requireAuth, deleteChapterController);
router.post('/stories/:storyId/chapters/reorder', requireAuth, reorderChaptersController);

// ── Story interaction routes ──
router.post('/stories/:storyId/vote', requireAuth, toggleVoteController);
router.post('/stories/:storyId/library', requireAuth, toggleLibraryController);
router.get('/chapters/:chapterId/comments', optionalAuth, getStoryCommentsController);
router.get('/chapters/:chapterId/comment-counts', optionalAuth, getCommentCountsController);
router.post('/chapters/:chapterId/comments', requireAuth, addStoryCommentController);
router.post('/stories/:storyId/progress', requireAuth, saveProgressController);
router.get('/stories/:storyId/progress', requireAuth, getProgressController);

// ─── Reactions ───
router.post('/reaction', requireAuth, toggleReactionController);
router.get('/reactions/:journalId', getPostReactionsController);

// ─── Daily Prompts ───
router.get('/prompt/today', getTodaysPromptController);
router.get('/prompt/:promptId/responses', getPromptResponsesController);

// ─── Weekly Recap ───
router.get('/recap/weekly', requireAuth, getWeeklyRecapController);

// ─── Streaks ───
router.get('/streak/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        const streakData = await getStreakService(userId);
        return res.status(200).json(streakData);
    } catch (err) {
        console.error('error getting streak:', err);
        return res.status(500).json({ error: 'failed to get streak' });
    }
});

export default router;
