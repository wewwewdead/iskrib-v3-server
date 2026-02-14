import supabase from "./supabase.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

const SEARCH_LIMIT_MAX = 20;
const SEARCH_QUERY_MIN_LENGTH = 2;
const PROFILE_MEDIA_BUCKETS = ['background', 'journal-images', 'avatars'];
const PROFILE_MEDIA_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg'];
const PROFILE_MEDIA_LIMIT_DEFAULT = 5;
const PROFILE_MEDIA_LIMIT_MAX = 20;

const normalizeSearchQuery = (query) => {
    if(typeof query !== 'string'){
        return '';
    }

    return query
        .replace(/\s+/g, ' ')
        .trim();
};

const attachUserInteractionFlags = async (journals, userId) => {
    if(!Array.isArray(journals) || journals.length === 0){
        return [];
    }

    if(!userId){
        return journals.map((journal) => ({
            ...journal,
            has_liked: false,
            has_bookmarked: false
        }));
    }

    const journalIds = journals.map((journal) => journal.id);

    const [userLikes, userBookmarks] = await Promise.all([
        supabase
            .from('likes')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId),
        supabase
            .from('bookmarks')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId)
    ]);

    const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
    const {data: userBookmarksResult, error: errorUserBookmarksResult} = userBookmarks;

    if(errorUserLikeResult || errorUserBookmarksResult){
        console.error('supabase error while fetching journal interactions:', errorUserLikeResult?.message || errorUserBookmarksResult?.message);
        throw {status: 500, error: 'supabase error on fetching user likes or user bookmarks'};
    }

    const userHasLikedSet = new Set(userLikesResult?.map((journal) => journal.journal_id) || []);
    const userHasBookmarkedSet = new Set(userBookmarksResult?.map((journal) => journal.journal_id) || []);

    return journals.map((journal) => ({
        ...journal,
        has_liked: userHasLikedSet.has(journal.id),
        has_bookmarked: userHasBookmarkedSet.has(journal.id)
    }));
};

const hasSupportedMediaExtension = (fileName = '') => {
    const lowerFileName = fileName.toLowerCase();
    return PROFILE_MEDIA_EXTENSIONS.some((ext) => lowerFileName.endsWith(ext));
};

const parseMediaTimestamp = (item = {}) => {
    const fileName = item?.name || '';
    const timestampPrefix = fileName.match(/^(\d+)_/);

    if(timestampPrefix?.[1]){
        const parsedPrefix = Number(timestampPrefix[1]);
        if(!Number.isNaN(parsedPrefix)){
            return parsedPrefix;
        }
    }

    const parsedDate = Date.parse(item?.created_at || item?.updated_at || '');
    return Number.isNaN(parsedDate) ? 0 : parsedDate;
};

const createInitialMediaCursorState = () => ({
    offsets: Object.fromEntries(PROFILE_MEDIA_BUCKETS.map((bucket) => [bucket, 0])),
    exhausted: Object.fromEntries(PROFILE_MEDIA_BUCKETS.map((bucket) => [bucket, false])),
    pending: []
});

const parseMediaCursor = (cursor) => {
    if(!cursor){
        return createInitialMediaCursorState();
    }

    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        const initial = createInitialMediaCursorState();

        if(parsed?.offsets && typeof parsed.offsets === 'object'){
            PROFILE_MEDIA_BUCKETS.forEach((bucket) => {
                const value = Number(parsed.offsets[bucket]);
                initial.offsets[bucket] = Number.isNaN(value) || value < 0 ? 0 : value;
            });
        }

        if(parsed?.exhausted && typeof parsed.exhausted === 'object'){
            PROFILE_MEDIA_BUCKETS.forEach((bucket) => {
                initial.exhausted[bucket] = Boolean(parsed.exhausted[bucket]);
            });
        }

        if(Array.isArray(parsed?.pending)){
            initial.pending = parsed.pending
                .filter((item) => PROFILE_MEDIA_BUCKETS.includes(item?.bucket) && typeof item?.path === 'string' && typeof item?.name === 'string')
                .map((item) => ({
                    bucket: item.bucket,
                    path: item.path,
                    name: item.name,
                    createdAt: item.createdAt || null,
                    timestamp: Number(item.timestamp) || 0
                }));
        }

        return initial;
    } catch {
        return createInitialMediaCursorState();
    }
};

const encodeMediaCursor = (state) => {
    const payload = JSON.stringify(state);
    return Buffer.from(payload, 'utf8').toString('base64');
};

const resolveMediaUrl = async(bucket, path) => {
    const {data: signedUrlData, error: signedUrlError} = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);

    if(!signedUrlError && signedUrlData?.signedUrl){
        return signedUrlData.signedUrl;
    }

    const {data: publicUrlData} = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

    return publicUrlData?.publicUrl || null;
};

const listMediaChunkForBucket = async(bucket, userId, offset, limit) => {
    const folderPath = `user_id_${userId}`;

    const {data: bucketItems, error: bucketError} = await supabase.storage
        .from(bucket)
        .list(folderPath, {
            limit: limit,
            offset: offset,
            sortBy: {column: 'name', order: 'desc'}
        });

    if(bucketError){
        return {
            bucket: bucket,
            nextOffset: offset,
            exhausted: true,
            items: [],
            error: bucketError.message
        };
    }

    const listedItems = Array.isArray(bucketItems) ? bucketItems : [];
    const normalizedItems = listedItems
        .filter((item) => item?.name && hasSupportedMediaExtension(item.name))
        .map((item) => {
            const path = `${folderPath}/${item.name}`;
            const createdAt = item.created_at || item.updated_at || null;

            return {
                bucket: bucket,
                path: path,
                name: item.name,
                createdAt: createdAt,
                timestamp: parseMediaTimestamp(item)
            };
        });

    return {
        bucket: bucket,
        nextOffset: offset + listedItems.length,
        exhausted: listedItems.length < limit,
        items: normalizedItems,
        error: null
    };
};

const hydrateMediaItems = async(items) => {
    if(!Array.isArray(items) || items.length === 0){
        return [];
    }

    const hydrated = await Promise.all(items.map(async(item) => {
        const url = await resolveMediaUrl(item.bucket, item.path);
        if(!url){
            return null;
        }

        return {
            id: `${item.bucket}-${item.path}`,
            bucket: item.bucket,
            path: item.path,
            name: item.name,
            createdAt: item.createdAt || null,
            timestamp: item.timestamp || 0,
            url: url
        };
    }));

    return hydrated.filter(Boolean);
};

export const getProfileMediaService = async(userId, limit = PROFILE_MEDIA_LIMIT_DEFAULT, cursor = null) => {
    if(!userId){
        throw {status: 400, error: 'userId is undefined'};
    }

    const parsedLimit = Number(limit);
    if(Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > PROFILE_MEDIA_LIMIT_MAX){
        throw {status: 400, error: `limit should be an integer between 1 and ${PROFILE_MEDIA_LIMIT_MAX}`};
    }

    const cursorState = parseMediaCursor(cursor);
    const offsets = {...cursorState.offsets};
    const exhausted = {...cursorState.exhausted};
    const pending = Array.isArray(cursorState.pending) ? [...cursorState.pending] : [];
    const unavailableBuckets = [];
    const maxIterations = 6;
    let iterationCount = 0;

    while(
        pending.length < parsedLimit &&
        PROFILE_MEDIA_BUCKETS.some((bucket) => !exhausted[bucket]) &&
        iterationCount < maxIterations
    ){
        iterationCount += 1;
        const activeBuckets = PROFILE_MEDIA_BUCKETS.filter((bucket) => !exhausted[bucket]);
        const chunkResults = await Promise.all(
            activeBuckets.map((bucket) => listMediaChunkForBucket(bucket, userId, offsets[bucket] || 0, parsedLimit))
        );

        chunkResults.forEach((result) => {
            offsets[result.bucket] = result.nextOffset;
            exhausted[result.bucket] = result.exhausted;

            if(result.error){
                console.error(`supabase storage list error on ${result.bucket}:`, result.error);
                unavailableBuckets.push(result.bucket);
                return;
            }

            pending.push(...result.items);
        });

        if(chunkResults.every((result) => result.items.length === 0)){
            break;
        }
    }

    pending.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const selectedItems = pending.slice(0, parsedLimit);
    const remainingItems = pending.slice(parsedLimit);
    const hydratedSelectedItems = await hydrateMediaItems(selectedItems);

    // If a URL cannot be created for some selected items, try to fill from remaining items.
    if(hydratedSelectedItems.length < parsedLimit && remainingItems.length > 0){
        const neededItemsCount = parsedLimit - hydratedSelectedItems.length;
        const fallbackCandidates = remainingItems.splice(0, neededItemsCount);
        const hydratedFallbackItems = await hydrateMediaItems(fallbackCandidates);
        hydratedSelectedItems.push(...hydratedFallbackItems);
    }

    const hasMore = remainingItems.length > 0 || PROFILE_MEDIA_BUCKETS.some((bucket) => !exhausted[bucket]);
    const dedupedUnavailableBuckets = [...new Set(unavailableBuckets)];

    const nextCursor = hasMore
        ? encodeMediaCursor({
            offsets: offsets,
            exhausted: exhausted,
            pending: remainingItems
        })
        : null;

    return {
        data: hydratedSelectedItems,
        hasMore: hasMore,
        nextCursor: nextCursor,
        unavailableBuckets: dedupedUnavailableBuckets
    };
}

export const getJournalsService = async(limit, userId, before) => {
    if(isNaN(limit) || limit > 20 || limit < 1){
        console.error('limit should be intiger, not below 1 and higher than 20');
        throw {status: 400, error: 'limit should be intiger, not below 1 and higher than 20'};
    }

    const parsedLimit = parseInt(limit);

    let query = supabase
    .from('journals')
    .select(`
        *, users(*),
        like_count: likes(count),
        comment_count: comments(count),
        bookmark_count: bookmarks(count)
        `)
    .eq('privacy', 'public')
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1);

    if(before){
        query = query.lt('created_at', before);
    }

    const {data, error} = await query;

    if(error){
        console.error('supabase error while fetching journals:', error.message);
        throw{status: 500, error: 'supabase error while fetching journals'}
    }

    if(data.length === 0){
        const journalData = {
            data: [],
            hasMore: false
        }
        return journalData
    }

    // If userId is provided, fetch personalization (likes/bookmarks)
    // Otherwise return journals with has_liked/has_bookmarked defaulting to false
    let userHasLikedSet = new Set();
    let userHasBookmarkedSet = new Set();

    if(userId){
        const journalIds = data.map((journal) => journal.id);

        const [userLikes, userBookmarks] = await Promise.all([
            supabase
            .from('likes')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId),

            supabase
            .from('bookmarks')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId)
        ]);

        const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
        const {data: userBookmarksResult, error: errorUserBookmarksResult} = userBookmarks;

        if(errorUserLikeResult || errorUserBookmarksResult) {
            console.error('supabase error:', errorUserLikeResult?.message || errorUserBookmarksResult?.message);
            throw {status: 500, error: 'supabase error on fetching user likes or user bookmarks'}
        }

        userHasLikedSet = new Set(userLikesResult?.map((j) => j.journal_id) || []);
        userHasBookmarkedSet = new Set(userBookmarksResult?.map((j) => j.journal_id)|| []);
    }

    const formattedData = data?.map((journal) => ({
        ...journal,
        has_liked: userHasLikedSet.has(journal.id),
        has_bookmarked: userHasBookmarkedSet.has(journal.id)
    }))

    const hasMore = data?.length > parsedLimit;
    const slicedData = hasMore ? formattedData.slice(0, parsedLimit) : formattedData;

    const journalData = {
        data: slicedData,
        hasMore: hasMore
    }
    return journalData;
}

export const getMonthlyHottestJournalsService = async(limit, userId) => {
    if(isNaN(limit) || limit < 1 || limit > 10){
        throw {status: 400, error: 'limit should be an integer between 1 and 10'};
    }

    const parsedLimit = parseInt(limit);
    const now = new Date();
    const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const nextMonthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    const {data: journals, error: journalsError} = await supabase
        .from('journals')
        .select(`
            *,
            users(*),
            like_count: likes(count),
            comment_count: comments(count),
            bookmark_count: bookmarks(count)
        `)
        .eq('privacy', 'public')
        .gte('created_at', monthStartUtc.toISOString())
        .lt('created_at', nextMonthStartUtc.toISOString());

    if(journalsError){
        console.error('supabase error while fetching monthly hottest journals:', journalsError.message);
        throw {status: 500, error: 'supabase error while fetching monthly hottest journals'};
    }

    const journalsWithInteractions = await attachUserInteractionFlags(journals || [], userId);
    const scored = journalsWithInteractions.map((journal) => {
        const likes = journal?.like_count?.[0]?.count || 0;
        const comments = journal?.comment_count?.[0]?.count || 0;
        const bookmarks = journal?.bookmark_count?.[0]?.count || 0;
        const views = journal?.views || 0;
        const hotScore = (views * 6) + (likes * 3) + (comments * 2) + (bookmarks * 2);

        return {
            ...journal,
            hot_score: hotScore
        };
    });

    scored.sort((a, b) => {
        const scoreDiff = (b?.hot_score || 0) - (a?.hot_score || 0);
        if(scoreDiff !== 0){
            return scoreDiff;
        }

        const dateDiff = new Date(b?.created_at || 0) - new Date(a?.created_at || 0);
        if(dateDiff !== 0){
            return dateDiff;
        }

        return (b?.id || 0) - (a?.id || 0);
    });

    return {
        data: scored.slice(0, parsedLimit),
        period: {
            startUtc: monthStartUtc.toISOString(),
            endUtc: nextMonthStartUtc.toISOString(),
            timezone: 'UTC'
        },
        totalCandidates: scored.length
    };
}

export const getJournalByIdService = async (journalId, userId) => {
    if (!journalId) {
        console.error('journalId is undefined');
        throw { status: 400, error: 'journalId is undefined' };
    }

    const { data: journal, error: journalError } = await supabase
        .from('journals')
        .select(`
            *,
            users(*),
            like_count: likes(count),
            comment_count: comments(count),
            bookmark_count: bookmarks(count)
        `)
        .eq('id', journalId)
        .eq('privacy', 'public')
        .maybeSingle();

    if (journalError) {
        console.error('supabase error while fetching journal by id:', journalError.message);
        throw { status: 500, error: 'supabase error while fetching journal by id' };
    }

    if (!journal) {
        return null;
    }

    let hasLiked = false;
    let hasBookmarked = false;

    if (userId) {
        const [likeResult, bookmarkResult] = await Promise.all([
            supabase
                .from('likes')
                .select('journal_id', { count: 'exact', head: true })
                .eq('journal_id', journalId)
                .eq('user_id', userId),
            supabase
                .from('bookmarks')
                .select('journal_id', { count: 'exact', head: true })
                .eq('journal_id', journalId)
                .eq('user_id', userId)
        ]);

        if (likeResult.error || bookmarkResult.error) {
            console.error(
                'supabase error while fetching journal interactions:',
                likeResult.error?.message || bookmarkResult.error?.message
            );
            throw { status: 500, error: 'supabase error while fetching journal interactions' };
        }

        hasLiked = (likeResult.count || 0) > 0;
        hasBookmarked = (bookmarkResult.count || 0) > 0;
    }

    return {
        ...journal,
        has_liked: hasLiked,
        has_bookmarked: hasBookmarked
    };
}

export const getUserJournalsService = async(limit, before, userId) =>{
    if(!userId){
        console.error('userid is undefined');
        throw {status: 400, error: 'userid is undefined'};
    }

    if(isNaN(limit)|| limit > 20 || limit < 1){
        console.error('limit should be intiger and not more than 20 and less than 1')
        throw {status: 400, error: 'limit should be intiger and not more than 20 and less than 1'};
    }

    const parsedLimit = parseInt(limit);

    let query = supabase
    .from('journals')
    .select(`
        *, 
        users(name, image_url, user_email, id, badge),
        like_count: likes(count),
        comment_count: comments(count),
        bookmark_count: bookmarks(count)
        `)
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: journals, error: errorJournals} = await query;

    if(errorJournals){
        console.error('supabase error while fetching user journals:', errorJournals.message);
        throw {status: 500, error: 'supabase error while fetching user journals'};
    }

    const journalIds = journals?.map((journal) => journal.id);

    if(journalIds.length === 0){
        const data = {data: [], hasMore: false};
        return data;
    }

    let userLikesPromise;
    let userBookmarksPromise;
    if(journalIds){
        userLikesPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)

        userBookmarksPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)
    }

    const [userLikesResult, userBookmarksResult] = await Promise.all([
        userLikesPromise, userBookmarksPromise
    ])
    
    const {data: userLikes, error: errorUserLikeResult} = userLikesResult;
    const {data: userBookmarks, error: errorBookmarksResult} = userBookmarksResult;

    if(errorBookmarksResult || errorUserLikeResult){
        console.error('supabase error:', errorBookmarksResult.message || errorUserLikeResult.message);
        return {status: 500, error: 'supabase error while fetching userlikes or userbookmarks'}
    }

    const userLikesSet = new Set(userLikes?.map((j) => j.journal_id) || []);
    const userBookmarksSet = new Set(userBookmarks?.map((j) => j.journal_id) || []);

    const formattedData = journals?.map((journal) => ({
        ...journal, 
        has_liked: userLikesSet.has(journal.id),
        has_bookmarked: userBookmarksSet.has(journal.id)
    }))

    const hasMore = journals.length > parsedLimit;
    const slicedData = hasMore ? formattedData.slice(0, parsedLimit) : formattedData;

    const journalData = {data: slicedData, hasMore: hasMore};

    return journalData;
}

export const getVisitedUserJournalsService = async(limit, before, userId, loggedInUserId) =>{
    if(!userId || !loggedInUserId){
        console.error('userid or loggedInUserId is undefined');
        throw {status: 400, error:'userid or loggedInUserId is undefined'};
    }

    if(isNaN(limit) || limit > 20 || limit < 1){
        console.error('lmit must be an intiger and not more than 20 and less than 1');
        throw {status: 400, error: 'lmit must be an intiger and not more than 20 and less than 1'};
    }

    const parsedLimit = parseInt(limit);

    let query = supabase
    .from('journals')
    .select(`
        *, 
        users(name, image_url, user_email, id, badge),
        like_count: likes(count),
        comment_count: comments(count),
        bookmark_count: bookmarks(count)
        `)
    .eq('user_id', userId)
    .eq('privacy', 'public')
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: journals, error: errorJournals} = await query;

    if(errorJournals){
        console.error('supabase error while fetching user journals:', errorJournals.message);
        throw {status: 500, error: 'supabase error while fetching user journals' }
    }

    const journalIds = journals?.map((journal) => journal.id);

    if(journalIds.length === 0){
        return {data: [], hasMore: false}
    }

    let userLikesPromise;
    let userBookmarksPromise;

    if(journalIds){
        userLikesPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', loggedInUserId)
        
        userBookmarksPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', loggedInUserId)
    }

    const [userLikes, userBookmarks] = await Promise.all([
        userLikesPromise, userBookmarksPromise
    ])

    const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
    const {data: userBookmarksResult, error: errorBookmarksResult} = userBookmarks;

    if(errorUserLikeResult || errorBookmarksResult){
        console.error('supabase error while fetching user journals:', errorBookmarksResult.message || errorUserLikeResult.message);
        return {status: 500, error: 'supabase error while fetching user journals'};
    }

    const userLikesSet = new Set(userLikesResult?.map((x) => x.journal_id) || [])
    const userBookmarksSet = new Set(userBookmarksResult?.map((y) => y.journal_id) || []);

    const formattedData = journals?.map((j) => ({
        ...j, 
        has_liked: userLikesSet.has(j.id),
        has_bookmarked: userBookmarksSet.has(j.id)
    }))

    const hasMore = journals?.length > parsedLimit;

    const slicedData = hasMore ? formattedData.slice(0, parsedLimit) : formattedData;

    const data = {data: slicedData, hasMore: hasMore}
    return data;
}

export const getViewOpinionService = async(postId, userId) => {
    if(!postId || !userId){
        console.error('postId OR userId is undefined');
        throw {status: 400, error: 'postId or userId is undefined'}
    }

    let query = supabase
    .from('opinions')
    .select('*, users(name, id, user_email, image_url, badge, background, profile_font_color, dominant_colors, secondary_colors)')
    .eq('id', postId)
    .eq('user_id', userId)

    const {data: opinion, error: errorOpinion} = await query;

    if(errorOpinion){
        console.error('supabase error:', errorOpinion.message);
        throw { status: 500, error: 'supabase error while fetching opinions'};
    }

    return {data: opinion};

}

export const getCommentsService = async(postId, limit, before) => {
    if(!postId){
        console.error('postId is undefined');
        throw {status:400, error: 'postId is undefined'}
    }

    if(isNaN(limit) || limit > 20 || limit < 1){
        console.error('limit must be a intiger and not more than 20 or less than 1');
        throw {status: 400, error: 'limit must be a intiger and not more than 20 or less than 1'}
    }

    const parsedLimit = parseInt(limit);

    let query = supabase
        .from('comments')
        .select('*, users(name, image_url, id, badge)')
        .eq('post_id', postId)
        .is('parent_id', null)
        .order('created_at', {ascending: false})
        .order('id', {ascending: false})
        .limit(parseInt(limit) + 1) //peek ahead +1, get 1 more data if the data in the table has more than the limit

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: comments, error: errorFetchComments} = await query;

    if(errorFetchComments){
        console.error('supabase error while fetching comments:', errorFetchComments.message);
        throw {status: 500, error: 'supabase error while fetching comments'}
    }

    const hasMore = comments.length > parsedLimit;
    const slicedData = hasMore ? comments.splice(0, parsedLimit) : comments;

    return {comments: slicedData, hasMore: hasMore};
}

export const getOpinionReplyService = async(parentId, limit, before) =>{
    if(!parentId){
        console.error('parentId is undefined');
        throw {status: 400, error: 'parentId is undefined'};
    }

    if(isNaN(limit) || limit > 20 || limit < 1){
        console.error('limit should be an integer and not more than 20 and less than 1');
        throw {status: 400, error: 'limit should be an integer and not more than 20 and less than 1'};
    }

    const parsedLimit = parseInt(limit);

    let query = supabase
    .from('opinions')
    .select('*, users(name, id, user_email, image_url, badge, background, profile_font_color, dominant_colors, secondary_colors)')
    .eq('parent_id', parentId)
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('id', before);
    }
    

    const {data: replyData, error: errorReplyData} = await query;

    if(errorReplyData){
        console.error('supabase error:', errorReplyData.message);
        throw {status: 500, error: 'supabase error while fetching opinions reply'}
    }

    const hasMore = replyData.length > parsedLimit;
    const slicedData = hasMore ? replyData.splice(0, parsedLimit) : replyData;

    return {data: slicedData, hasMore: hasMore};
}

export const getBookmarksService = async(userId, before, limit) => {
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'}
    }

    if(isNaN(limit) || limit > 20 || limit < 1){
        console.error('limit must be an integer and not more than 20 or less than 1');
        throw {status: 400, error: 'limit must be an integer and not more than 20 or less than 1'};
    }
    const paresedLimit = parseInt(limit);
    let query = supabase
    .from('bookmarks')
    .select(`*,
        journals(
        id, created_at, user_id, content, title, 
        comment_count: comments(count),
        bookmark_count: bookmarks(count),

        users(name, user_email, image_url, badge),

        like_count: likes(count)
        )
        `, {count: 'exact'})

    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parseInt(limit) + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: bookMarksData, error: errorBookmarks, count} = await query;

    if(errorBookmarks){
        console.error('supabase error:', errorBookmarks.message);
        throw {status: 500, error: 'supabase error while fetching bookmarks'}
    }

    const journalIds = bookMarksData?.map((bookmark) => bookmark.journals.id);

    if(journalIds.length === 0){
        return {data: [], hasMore: false}
    }

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

    const [hasLiked, hasBookMarked] = await Promise.all([
        hasLikedPromise, hasBookmarkedPromise
    ])

    const {data: hasLikedResult, error: errorHasLikedResult} = hasLiked;
    const {data: hasBookMarkedResult, error: errorHasbookmarkedResult} = hasBookMarked;

    if(errorHasLikedResult || errorHasbookmarkedResult){
        console.error('supabase error while fetching data:', errorHasLikedResult.message || errorHasbookmarkedResult.message);
        throw {status: 500, error: 'supabase error while fetching data'};
    }
    
    const userHasLikedSet = new Set(hasLikedResult.map((journal) => journal.journal_id) || []);
    const userHasBookmarkedSet = new Set(hasBookMarkedResult.map((bookmark) => bookmark.journal_id) || []);

    const hasMore = bookMarksData.length > paresedLimit;


    const formattedData = bookMarksData.map((b) => ({
        ...b,
        has_liked: userHasLikedSet.has(b.journals.id),
        has_bookmarked: userHasBookmarkedSet.has(b.journals.id),
    }))

    const slicedData = hasMore ? formattedData.splice(0, paresedLimit) : formattedData;

    return {
        bookmarks: slicedData,
        hasMore: hasMore,
        totalBookmarks: before ? null : count
    }
}

export const searchJournalsService = async(query, limit, userId) => {
    const normalizedQuery = normalizeSearchQuery(query);
    if(!normalizedQuery || normalizedQuery.length < SEARCH_QUERY_MIN_LENGTH){
        throw {status: 400, error: `query should be at least ${SEARCH_QUERY_MIN_LENGTH} characters`};
    }

    if(isNaN(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX){
        throw {status: 400, error: `limit should be an integer between 1 and ${SEARCH_LIMIT_MAX}`};
    }

    const parsedLimit = parseInt(limit);
    const fetchLimit = Math.min(parsedLimit * 3, 60);

    const selectColumns = `
        *,
        users(*),
        like_count: likes(count),
        comment_count: comments(count),
        bookmark_count: bookmarks(count)
    `;

    // Prefer semantic retrieval. If pgvector RPC is unavailable or errors,
    // fallback to keyword search so endpoint still returns useful data.
    try {
        const queryEmbedding = await GenerateEmbeddings(normalizedQuery, '');

        if(Array.isArray(queryEmbedding) && queryEmbedding.length > 0){
            const {data: matches, error: matchError} = await supabase.rpc('match_public_journals', {
                query_embedding: queryEmbedding,
                match_count: fetchLimit,
                similarity_threshold: 0.35
            });

            if(matchError){
                console.error('semantic search rpc error:', matchError.message);
            } else if(Array.isArray(matches) && matches.length > 0){
                const matchIds = matches.map((row) => row.id);
                const similarityMap = new Map(matches.map((row) => [row.id, row.similarity]));

                const {data: journals, error: errorJournals} = await supabase
                    .from('journals')
                    .select(selectColumns)
                    .in('id', matchIds)
                    .eq('privacy', 'public');

                if(errorJournals){
                    console.error('supabase error while fetching semantic search journals:', errorJournals.message);
                    throw {status: 500, error: 'supabase error while fetching semantic search journals'};
                }

                const journalById = new Map((journals || []).map((journal) => [journal.id, journal]));
                const orderedSemantic = matchIds
                    .map((id) => journalById.get(id))
                    .filter(Boolean)
                    .map((journal) => ({
                        ...journal,
                        similarity: similarityMap.get(journal.id) || null
                    }));

                const withInteraction = await attachUserInteractionFlags(orderedSemantic, userId);
                const hasMore = withInteraction.length > parsedLimit;

                return {
                    data: hasMore ? withInteraction.slice(0, parsedLimit) : withInteraction,
                    hasMore: hasMore,
                    mode: 'semantic'
                };
            }
        }
    } catch (error) {
        console.error('semantic embedding/search fallback error:', error?.message || error);
    }

    const escapedQuery = normalizedQuery.replace(/[%_]/g, (match) => `\\${match}`);

    const [titleResult, contentResult] = await Promise.all([
        supabase
            .from('journals')
            .select(selectColumns)
            .eq('privacy', 'public')
            .ilike('title', `%${escapedQuery}%`)
            .order('created_at', {ascending: false})
            .order('id', {ascending: false})
            .limit(parsedLimit + 1),
        supabase
            .from('journals')
            .select(selectColumns)
            .eq('privacy', 'public')
            .ilike('content', `%${escapedQuery}%`)
            .order('created_at', {ascending: false})
            .order('id', {ascending: false})
            .limit(parsedLimit + 1)
    ]);

    if(titleResult.error || contentResult.error){
        console.error('keyword search error:', titleResult.error?.message || contentResult.error?.message);
        throw {status: 500, error: 'supabase error while searching journals'};
    }

    const keywordMap = new Map();
    (titleResult.data || []).forEach((journal) => {
        keywordMap.set(journal.id, journal);
    });
    (contentResult.data || []).forEach((journal) => {
        if(!keywordMap.has(journal.id)){
            keywordMap.set(journal.id, journal);
        }
    });

    const keywordJournals = [...keywordMap.values()];

    const withInteraction = await attachUserInteractionFlags(keywordJournals || [], userId);
    const hasMore = withInteraction.length > parsedLimit;

    return {
        data: hasMore ? withInteraction.slice(0, parsedLimit) : withInteraction,
        hasMore: hasMore,
        mode: 'keyword'
    };
}
