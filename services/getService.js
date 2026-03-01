import supabase from "./supabase.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

const SEARCH_LIMIT_MAX = 20;
const SEARCH_QUERY_MIN_LENGTH = 2;
const CANVAS_GALLERY_LIMIT_DEFAULT = 36;
const CANVAS_GALLERY_LIMIT_MAX = 72;
// Removed: CANVAS_GALLERY_HOT_FETCH_LIMIT — hot sorting now done via PostgreSQL RPC
const UNIVERSE_POST_LIMIT_DEFAULT = 200;
const UNIVERSE_POST_LIMIT_MAX = 500;
const UNIVERSE_SIMILARITY_THRESHOLD = 0.9;
const UNIVERSE_SIMILARITY_PAIR_LIMIT = 120;
const UNIVERSE_STAR_PULL_MIN_SIMILARITY = 0.4;
const UNIVERSE_STAR_PULL_LIMIT = 500;
const UNIVERSE_POST_SELECT = `
    id,
    title,
    content,
    post_type,
    canvas_doc,
    created_at,
    universe_x,
    universe_y,
    settled_x,
    settled_y,
    user_id,
    views,
    users(id, name, image_url, badge),
    likes(count)
`;
const PROFILE_MEDIA_BUCKETS = ['background', 'journal-images', 'avatars'];
const PROFILE_MEDIA_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg'];
const PROFILE_MEDIA_LIMIT_DEFAULT = 5;
const PROFILE_MEDIA_LIMIT_MAX = 20;
const JOURNAL_USER_SELECT = 'id, name, image_url, badge';
const JOURNAL_BASE_SELECT = `
    id,
    user_id,
    title,
    content,
    post_type,
    canvas_doc,
    created_at,
    privacy,
    views,
    is_repost,
    repost_source_journal_id,
    repost_caption,
    prompt_id,
    users(${JOURNAL_USER_SELECT})
`;
const JOURNAL_WITH_COUNTS_SELECT = `
    ${JOURNAL_BASE_SELECT},
    like_count: likes(count),
    reaction_count: reactions(count),
    comment_count: comments(count),
    bookmark_count: bookmarks(count)
`;
// Lightweight select for list/feed views — no content or canvas_doc
const JOURNAL_METADATA_SELECT = `
    id,
    user_id,
    title,
    post_type,
    created_at,
    privacy,
    views,
    is_repost,
    repost_source_journal_id,
    repost_caption,
    prompt_id,
    users(${JOURNAL_USER_SELECT})
`;
const JOURNAL_METADATA_WITH_COUNTS_SELECT = `
    ${JOURNAL_METADATA_SELECT},
    like_count: likes(count),
    reaction_count: reactions(count),
    comment_count: comments(count),
    bookmark_count: bookmarks(count)
`;
const OPINION_USER_SELECT = 'id, name, image_url, badge';
const OPINION_BASE_SELECT = `
    id,
    user_id,
    parent_id,
    opinion,
    reply_count,
    created_at
`;
const OPINION_WITH_USER_SELECT = `
    ${OPINION_BASE_SELECT},
    users(${OPINION_USER_SELECT})
`;
const COMMENT_WITH_USER_SELECT = `
    id,
    post_id,
    parent_id,
    user_id,
    comment,
    reply_count,
    created_at,
    users(${OPINION_USER_SELECT})
`;

const attachRepostSources = async (journals) => {
    const items = Array.isArray(journals) ? journals : [journals];
    const sourceIds = [...new Set(
        items
            .filter(j => j.is_repost === true && j.repost_source_journal_id != null)
            .map(j => j.repost_source_journal_id)
    )];

    if (sourceIds.length === 0) {
        items.forEach(j => { j.repost_source = null; });
        return journals;
    }

    const { data: sources, error } = await supabase
        .from('journals')
        .select('id, title, content, post_type, canvas_doc, created_at, users(id, name, image_url, badge)')
        .in('id', sourceIds);

    if (error) {
        console.error('supabase error fetching repost sources:', error.message);
        items.forEach(j => { j.repost_source = null; });
        return journals;
    }

    const sourceMap = new Map(sources.map(s => [s.id, s]));
    items.forEach(j => {
        j.repost_source = j.repost_source_journal_id
            ? (sourceMap.get(j.repost_source_journal_id) || null)
            : null;
    });

    return journals;
};

const parseFiniteNumber = (value, fieldName) => {
    const parsed = Number(value);
    if(!Number.isFinite(parsed)){
        throw {status: 400, error: `${fieldName} should be a finite number`};
    }
    return parsed;
};

const normalizeUniversePost = (post = {}) => {
    const likes = Array.isArray(post?.likes) ? post.likes : [];
    const likeCount = post?.like_count != null
        ? Number(post.like_count)
        : Number(likes?.[0]?.count ?? 0);

    return {
        ...post,
        user_id: post?.user_id ?? post?.users?.id ?? null,
        user_name: post?.user_name ?? post?.users?.name ?? null,
        user_image_url: post?.user_image_url ?? post?.users?.image_url ?? null,
        user_badge: post?.user_badge ?? post?.users?.badge ?? null,
        display_x: post?.display_x ?? post?.settled_x ?? post?.universe_x ?? null,
        display_y: post?.display_y ?? post?.settled_y ?? post?.universe_y ?? null,
        like_count: Number.isFinite(likeCount) ? likeCount : 0
    };
};

const loadUniversePostsViaRpc = async(minX, maxX, minY, maxY, limit) => {
    const {data, error} = await supabase.rpc('get_universe_posts_viewport', {
        vp_min_x: minX,
        vp_max_x: maxX,
        vp_min_y: minY,
        vp_max_y: maxY,
        max_count: limit
    });

    if(error){
        throw error;
    }

    return Array.isArray(data) ? data.map(normalizeUniversePost) : [];
};

const loadUniversePostsFallback = async(minX, maxX, minY, maxY, limit) => {
    const settledQuery = supabase
        .from('journals')
        .select(UNIVERSE_POST_SELECT)
        .eq('privacy', 'public')
        .not('settled_x', 'is', null)
        .not('settled_y', 'is', null)
        .gte('settled_x', minX)
        .lte('settled_x', maxX)
        .gte('settled_y', minY)
        .lte('settled_y', maxY)
        .order('created_at', {ascending: false})
        .limit(limit);

    const unsettledQuery = supabase
        .from('journals')
        .select(UNIVERSE_POST_SELECT)
        .eq('privacy', 'public')
        .is('settled_x', null)
        .is('settled_y', null)
        .gte('universe_x', minX)
        .lte('universe_x', maxX)
        .gte('universe_y', minY)
        .lte('universe_y', maxY)
        .order('created_at', {ascending: false})
        .limit(limit);

    const [
        {data: settledData, error: settledError},
        {data: unsettledData, error: unsettledError}
    ] = await Promise.all([settledQuery, unsettledQuery]);

    if(settledError || unsettledError){
        console.error(
            'supabase fallback error while fetching universe posts:',
            settledError?.message || unsettledError?.message
        );
        throw {status: 500, error: 'failed to fetch universe posts'};
    }

    const mergedById = new Map();
    const mergedRows = [...(settledData || []), ...(unsettledData || [])];
    for (const row of mergedRows) {
        if(!row?.id || mergedById.has(row.id)){
            continue;
        }

        mergedById.set(row.id, normalizeUniversePost(row));
        if(mergedById.size >= limit){
            break;
        }
    }

    return Array.from(mergedById.values());
};

const getUniverseCentroids = async(userIds) => {
    if(!Array.isArray(userIds) || userIds.length === 0){
        return [];
    }

    const {data, error} = await supabase
        .from('galaxy_centroids')
        .select('user_id, galaxy_x, galaxy_y, mean_embedding')
        .in('user_id', userIds);

    if(error){
        console.warn('supabase warning while fetching universe centroids:', error.message);
        return [];
    }

    return Array.isArray(data) ? data : [];
};

const getUniverseEdges = async(userIds) => {
    if(!Array.isArray(userIds) || userIds.length < 2){
        return [];
    }

    const {data, error} = await supabase
        .from('galaxy_edges')
        .select('user_a, user_b, similarity')
        .in('user_a', userIds)
        .in('user_b', userIds);

    if(error){
        console.warn('supabase warning while fetching universe edges:', error.message);
        return [];
    }

    return Array.isArray(data) ? data : [];
};

const getUniverseSimilarPairs = async(postIds) => {
    if(!Array.isArray(postIds) || postIds.length < 2){
        return [];
    }

    const {data, error} = await supabase.rpc('find_similar_post_pairs', {
        post_ids: postIds,
        threshold: UNIVERSE_SIMILARITY_THRESHOLD,
        max_pairs: UNIVERSE_SIMILARITY_PAIR_LIMIT
    });

    if(error){
        console.warn('supabase warning while fetching similar universe post pairs:', error.message);
        return [];
    }

    return Array.isArray(data) ? data : [];
};

const getUniverseStarPulls = async(postIds) => {
    if(!Array.isArray(postIds) || postIds.length === 0){
        return [];
    }

    const {data, error} = await supabase.rpc('get_star_galaxy_pulls', {
        post_ids: postIds,
        min_similarity: UNIVERSE_STAR_PULL_MIN_SIMILARITY,
        max_pulls: UNIVERSE_STAR_PULL_LIMIT
    });

    if(error){
        console.warn('supabase warning while fetching universe star pulls:', error.message);
        return [];
    }

    return Array.isArray(data) ? data : [];
};

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
            has_bookmarked: false,
            user_reaction: null
        }));
    }

    const journalIds = journals.map((journal) => journal.id);

    const [userLikes, userBookmarks, userReactions] = await Promise.all([
        supabase
            .from('likes')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId),
        supabase
            .from('bookmarks')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId),
        supabase
            .from('reactions')
            .select('journal_id, reaction_type')
            .in('journal_id', journalIds)
            .eq('user_id', userId)
    ]);

    const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
    const {data: userBookmarksResult, error: errorUserBookmarksResult} = userBookmarks;
    const {data: userReactionsResult} = userReactions;

    if(errorUserLikeResult || errorUserBookmarksResult){
        console.error('supabase error while fetching journal interactions:', errorUserLikeResult?.message || errorUserBookmarksResult?.message);
        throw {status: 500, error: 'supabase error on fetching user likes or user bookmarks'};
    }

    const userHasLikedSet = new Set(userLikesResult?.map((journal) => journal.journal_id) || []);
    const userHasBookmarkedSet = new Set(userBookmarksResult?.map((journal) => journal.journal_id) || []);
    const userReactionMap = new Map((userReactionsResult || []).map((r) => [r.journal_id, r.reaction_type]));

    return journals.map((journal) => ({
        ...journal,
        has_liked: userHasLikedSet.has(journal.id),
        has_bookmarked: userHasBookmarkedSet.has(journal.id),
        user_reaction: userReactionMap.get(journal.id) || null
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

const parseCanvasGalleryCursor = (cursor, expectedSort = 'hottest') => {
    const fallback = {
        offset: 0,
        sort: expectedSort
    };

    if(!cursor){
        return fallback;
    }

    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        const parsedSort = typeof parsed?.sort === 'string' && parsed.sort.toLowerCase().trim() === 'newest'
            ? 'newest'
            : 'hottest';

        if(parsedSort !== expectedSort){
            return fallback;
        }

        const parsedOffset = Number(parsed?.offset);
        const normalizedOffset = Number.isNaN(parsedOffset) || parsedOffset < 0
            ? 0
            : Math.floor(parsedOffset);

        return {
            offset: normalizedOffset,
            sort: parsedSort
        };
    } catch {
        return fallback;
    }
};

const encodeCanvasGalleryCursor = (offset, sort) => {
    const payload = JSON.stringify({
        offset: offset,
        sort: sort
    });
    return Buffer.from(payload, 'utf8').toString('base64');
};

const resolveMediaUrl = async(bucket, path) => {
    const {data: publicUrlData} = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

    const publicUrl = publicUrlData?.publicUrl || null;
    if(publicUrl){
        return publicUrl;
    }

    const {data: signedUrlData, error: signedUrlError} = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);

    if(!signedUrlError && signedUrlData?.signedUrl){
        return signedUrlData.signedUrl;
    }

    return null;
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

export const getUniversePostsService = async(minX, maxX, minY, maxY, limit = UNIVERSE_POST_LIMIT_DEFAULT) => {
    const parsedMinX = parseFiniteNumber(minX, 'minX');
    const parsedMaxX = parseFiniteNumber(maxX, 'maxX');
    const parsedMinY = parseFiniteNumber(minY, 'minY');
    const parsedMaxY = parseFiniteNumber(maxY, 'maxY');
    const parsedLimit = Number(limit);

    if(parsedMinX > parsedMaxX){
        throw {status: 400, error: 'minX should be less than or equal to maxX'};
    }

    if(parsedMinY > parsedMaxY){
        throw {status: 400, error: 'minY should be less than or equal to maxY'};
    }

    if(!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > UNIVERSE_POST_LIMIT_MAX){
        throw {status: 400, error: `limit should be an integer between 1 and ${UNIVERSE_POST_LIMIT_MAX}`};
    }

    let posts = [];
    let usedFallback = false;

    try {
        posts = await loadUniversePostsViaRpc(parsedMinX, parsedMaxX, parsedMinY, parsedMaxY, parsedLimit);
    } catch (error) {
        usedFallback = true;
        console.warn('universe viewport RPC unavailable, using fallback query:', error?.message || error);
    }

    if(usedFallback){
        posts = await loadUniversePostsFallback(parsedMinX, parsedMaxX, parsedMinY, parsedMaxY, parsedLimit);
    }

    const postIds = Array.from(new Set(posts.map((post) => post?.id).filter(Boolean)));
    const visibleUserIds = Array.from(new Set(
        posts
            .map((post) => post?.users?.id ?? post?.user_id)
            .filter(Boolean)
    ));

    const [centroids, edges, similarPairs, starPulls] = await Promise.all([
        getUniverseCentroids(visibleUserIds),
        getUniverseEdges(visibleUserIds),
        getUniverseSimilarPairs(postIds),
        getUniverseStarPulls(postIds)
    ]);

    return {
        data: posts,
        centroids: centroids,
        edges: edges,
        similarPairs: similarPairs,
        starPulls: starPulls
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
    .select(JOURNAL_WITH_COUNTS_SELECT)
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

    // If userId is provided, fetch personalization (likes/bookmarks/reactions)
    // Otherwise return journals with has_liked/has_bookmarked/user_reaction defaulting to false/null
    let userHasLikedSet = new Set();
    let userHasBookmarkedSet = new Set();
    let userReactionMap = new Map();

    if(userId){
        const journalIds = data.map((journal) => journal.id);

        const [userLikes, userBookmarks, userReactions] = await Promise.all([
            supabase
            .from('likes')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId),

            supabase
            .from('bookmarks')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId),

            supabase
            .from('reactions')
            .select('journal_id, reaction_type')
            .in('journal_id', journalIds)
            .eq('user_id', userId)
        ]);

        const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
        const {data: userBookmarksResult, error: errorUserBookmarksResult} = userBookmarks;
        const {data: userReactionsResult} = userReactions;

        if(errorUserLikeResult || errorUserBookmarksResult) {
            console.error('supabase error:', errorUserLikeResult?.message || errorUserBookmarksResult?.message);
            throw {status: 500, error: 'supabase error on fetching user likes or user bookmarks'}
        }

        userHasLikedSet = new Set(userLikesResult?.map((j) => j.journal_id) || []);
        userHasBookmarkedSet = new Set(userBookmarksResult?.map((j) => j.journal_id)|| []);
        userReactionMap = new Map((userReactionsResult || []).map((r) => [r.journal_id, r.reaction_type]));
    }

    await attachRepostSources(data);

    const formattedData = data?.map((journal) => ({
        ...journal,
        has_liked: userHasLikedSet.has(journal.id),
        has_bookmarked: userHasBookmarkedSet.has(journal.id),
        user_reaction: userReactionMap.get(journal.id) || null
    }))

    const hasMore = data?.length > parsedLimit;
    const slicedData = hasMore ? formattedData.slice(0, parsedLimit) : formattedData;

    const journalData = {
        data: slicedData,
        hasMore: hasMore
    }
    return journalData;
}

export const getFollowingFeedService = async(limit, userId, before) => {
    if (!userId) {
        throw { status: 401, error: 'authentication required' };
    }
    if (isNaN(limit) || limit > 20 || limit < 1) {
        throw { status: 400, error: 'limit should be integer, not below 1 and higher than 20' };
    }

    const parsedLimit = parseInt(limit);

    // Step 1: Fetch journals via RPC (subquery stays inside Postgres — scales to 100k+ followings)
    const { data: rpcData, error } = await supabase.rpc('get_following_feed', {
        p_user_id: userId,
        p_limit: parsedLimit + 1,
        p_before: before || null
    });

    if (error) {
        console.error('supabase error fetching following feed:', error.message);
        throw { status: 500, error: 'supabase error fetching following feed' };
    }

    if (!rpcData || rpcData.length === 0) {
        return { data: [], hasMore: false };
    }

    // Reshape RPC rows to match PostgREST format the client expects
    const data = rpcData.map(row => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: row.content,
        post_type: row.post_type,
        canvas_doc: row.canvas_doc,
        created_at: row.created_at,
        privacy: row.privacy,
        views: row.views,
        is_repost: row.is_repost,
        repost_source_journal_id: row.repost_source_journal_id,
        repost_caption: row.repost_caption,
        prompt_id: row.prompt_id,
        users: { id: row.user_obj_id, name: row.user_name, image_url: row.user_image_url, badge: row.user_badge },
        like_count: [{ count: Number(row.like_count) }],
        reaction_count: [{ count: Number(row.reaction_count) }],
        comment_count: [{ count: Number(row.comment_count) }],
        bookmark_count: [{ count: Number(row.bookmark_count) }]
    }));

    // Step 2: Personalization (same pattern as getJournalsService — operates on small result set)
    const journalIds = data.map(j => j.id);
    const [userLikes, userBookmarks, userReactions] = await Promise.all([
        supabase.from('likes').select('journal_id').in('journal_id', journalIds).eq('user_id', userId),
        supabase.from('bookmarks').select('journal_id').in('journal_id', journalIds).eq('user_id', userId),
        supabase.from('reactions').select('journal_id, reaction_type').in('journal_id', journalIds).eq('user_id', userId)
    ]);

    const userHasLikedSet = new Set(userLikes.data?.map(j => j.journal_id) || []);
    const userHasBookmarkedSet = new Set(userBookmarks.data?.map(j => j.journal_id) || []);
    const userReactionMap = new Map((userReactions.data || []).map(r => [r.journal_id, r.reaction_type]));

    await attachRepostSources(data);

    const formattedData = data.map(journal => ({
        ...journal,
        has_liked: userHasLikedSet.has(journal.id),
        has_bookmarked: userHasBookmarkedSet.has(journal.id),
        user_reaction: userReactionMap.get(journal.id) || null
    }));

    const hasMore = data.length > parsedLimit;
    const slicedData = hasMore ? formattedData.slice(0, parsedLimit) : formattedData;

    return { data: slicedData, hasMore };
}

export const getMonthlyHottestJournalsService = async(limit, userId) => {
    if(isNaN(limit) || limit < 1 || limit > 10){
        throw {status: 400, error: 'limit should be an integer between 1 and 10'};
    }

    const parsedLimit = parseInt(limit);
    const now = new Date();
    const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const nextMonthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    // Use server-side RPC to score and sort — avoids fetching ALL monthly posts
    const {data: rpcData, error: rpcError} = await supabase.rpc('get_monthly_hottest_journals', {
        p_limit: parsedLimit
    });

    if(rpcError){
        console.error('supabase RPC error (get_monthly_hottest_journals):', rpcError.message);
        throw {status: 500, error: 'supabase error while fetching monthly hottest journals'};
    }

    // Reshape RPC rows to match the format the client expects
    const journals = (rpcData || []).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: row.content,
        post_type: row.post_type,
        canvas_doc: row.canvas_doc,
        created_at: row.created_at,
        privacy: row.privacy,
        views: row.views,
        is_repost: row.is_repost,
        repost_source_journal_id: row.repost_source_journal_id,
        repost_caption: row.repost_caption,
        users: {
            id: row.user_id,
            name: row.user_name,
            image_url: row.user_image_url,
            badge: row.user_badge
        },
        like_count: [{count: row.like_count}],
        comment_count: [{count: row.comment_count}],
        bookmark_count: [{count: row.bookmark_count}],
        hot_score: row.hot_score
    }));

    const journalsWithInteractions = await attachUserInteractionFlags(journals, userId);

    return {
        data: journalsWithInteractions,
        period: {
            startUtc: monthStartUtc.toISOString(),
            endUtc: nextMonthStartUtc.toISOString(),
            timezone: 'UTC'
        },
        totalCandidates: journalsWithInteractions.length
    };
}

export const getCanvasGalleryService = async(limit = CANVAS_GALLERY_LIMIT_DEFAULT, userId, sort = 'hottest', cursor = null) => {
    if(isNaN(limit) || limit < 1 || limit > CANVAS_GALLERY_LIMIT_MAX){
        throw {status: 400, error: `limit should be an integer between 1 and ${CANVAS_GALLERY_LIMIT_MAX}`};
    }

    const parsedLimit = parseInt(limit);
    const normalizedSort = typeof sort === 'string' ? sort.toLowerCase().trim() : 'hottest';
    const isNewest = normalizedSort === 'newest';
    const parsedCursor = parseCanvasGalleryCursor(cursor, isNewest ? 'newest' : 'hottest');
    const cursorOffset = parsedCursor.offset;

    let journals = [];
    let journalsError = null;

    if(isNewest){
        // Newest: simple paginated query
        const result = await supabase
            .from('journals')
            .select(JOURNAL_WITH_COUNTS_SELECT)
            .eq('privacy', 'public')
            .eq('post_type', 'canvas')
            .order('created_at', {ascending: false})
            .order('id', {ascending: false})
            .range(cursorOffset, cursorOffset + parsedLimit);

        journals = result.data || [];
        journalsError = result.error;
    } else {
        // Hottest: use server-side RPC scoring — avoids fetching 220 rows
        const result = await supabase.rpc('get_hot_canvas_gallery', {
            p_limit: parsedLimit,
            p_offset: cursorOffset
        });

        if(result.error){
            journalsError = result.error;
        } else {
            // Reshape RPC rows to match client format
            journals = (result.data || []).map((row) => ({
                id: row.id,
                user_id: row.user_id,
                title: row.title,
                content: row.content,
                post_type: row.post_type,
                canvas_doc: row.canvas_doc,
                created_at: row.created_at,
                privacy: row.privacy,
                views: row.views,
                is_repost: row.is_repost,
                repost_source_journal_id: row.repost_source_journal_id,
                repost_caption: row.repost_caption,
                users: {
                    id: row.user_id,
                    name: row.user_name,
                    image_url: row.user_image_url,
                    badge: row.user_badge
                },
                like_count: [{count: row.like_count}],
                comment_count: [{count: row.comment_count}],
                bookmark_count: [{count: row.bookmark_count}],
                hot_score: row.hot_score
            }));
        }
    }

    if(journalsError){
        console.error('supabase error while fetching canvas gallery journals:', journalsError.message);
        throw {status: 500, error: 'supabase error while fetching canvas gallery journals'};
    }

    const enrichedJournals = await attachUserInteractionFlags(journals, userId);

    // RPC already returns p_limit + 1 rows for hasMore detection
    const hasMore = enrichedJournals.length > parsedLimit;
    const data = hasMore ? enrichedJournals.slice(0, parsedLimit) : enrichedJournals;
    const nextCursor = hasMore
        ? encodeCanvasGalleryCursor(cursorOffset + data.length, isNewest ? 'newest' : 'hottest')
        : null;

    return {
        data: data,
        sort: isNewest ? 'newest' : 'hottest',
        totalCandidates: data.length,
        hasMore: hasMore,
        nextCursor: nextCursor
    };
}

export const getJournalByIdService = async (journalId, userId) => {
    if (!journalId) {
        console.error('journalId is undefined');
        throw { status: 400, error: 'journalId is undefined' };
    }

    const { data: journal, error: journalError } = await supabase
        .from('journals')
        .select(JOURNAL_WITH_COUNTS_SELECT)
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

    await attachRepostSources(journal);

    let hasLiked = false;
    let hasBookmarked = false;
    let userReaction = null;

    if (userId) {
        const [likeResult, bookmarkResult, reactionResult] = await Promise.all([
            supabase
                .from('likes')
                .select('journal_id', { count: 'exact', head: true })
                .eq('journal_id', journalId)
                .eq('user_id', userId),
            supabase
                .from('bookmarks')
                .select('journal_id', { count: 'exact', head: true })
                .eq('journal_id', journalId)
                .eq('user_id', userId),
            supabase
                .from('reactions')
                .select('reaction_type')
                .eq('journal_id', journalId)
                .eq('user_id', userId)
                .maybeSingle()
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
        userReaction = reactionResult.data?.reaction_type || null;
    }

    return {
        ...journal,
        has_liked: hasLiked,
        has_bookmarked: hasBookmarked,
        user_reaction: userReaction
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
    .select(JOURNAL_WITH_COUNTS_SELECT)
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

    await attachRepostSources(journals);

    let userLikesPromise;
    let userBookmarksPromise;
    let userReactionsPromise;
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

        userReactionsPromise = supabase
        .from('reactions')
        .select('journal_id, reaction_type')
        .in('journal_id', journalIds)
        .eq('user_id', userId)
    }

    const [userLikesResult, userBookmarksResult, userReactionsResult] = await Promise.all([
        userLikesPromise, userBookmarksPromise, userReactionsPromise
    ])

    const {data: userLikes, error: errorUserLikeResult} = userLikesResult;
    const {data: userBookmarks, error: errorBookmarksResult} = userBookmarksResult;
    const {data: userReactions, error: errorReactionsResult} = userReactionsResult;

    if(errorBookmarksResult || errorUserLikeResult || errorReactionsResult){
        console.error('supabase error:', errorBookmarksResult?.message || errorUserLikeResult?.message || errorReactionsResult?.message);
        return {status: 500, error: 'supabase error while fetching userlikes or userbookmarks'}
    }

    const userLikesSet = new Set(userLikes?.map((j) => j.journal_id) || []);
    const userBookmarksSet = new Set(userBookmarks?.map((j) => j.journal_id) || []);
    const userReactionMap = new Map((userReactions || []).map((r) => [r.journal_id, r.reaction_type]));

    const formattedData = journals?.map((journal) => ({
        ...journal,
        has_liked: userLikesSet.has(journal.id),
        has_bookmarked: userBookmarksSet.has(journal.id),
        user_reaction: userReactionMap.get(journal.id) || null
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
    .select(JOURNAL_WITH_COUNTS_SELECT)
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

    await attachRepostSources(journals);

    let userLikesPromise;
    let userBookmarksPromise;
    let userReactionsPromise;

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

        userReactionsPromise = supabase
        .from('reactions')
        .select('journal_id, reaction_type')
        .in('journal_id', journalIds)
        .eq('user_id', loggedInUserId)
    }

    const [userLikes, userBookmarks, userReactions] = await Promise.all([
        userLikesPromise, userBookmarksPromise, userReactionsPromise
    ])

    const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
    const {data: userBookmarksResult, error: errorBookmarksResult} = userBookmarks;
    const {data: userReactionsResult, error: errorReactionsResult} = userReactions;

    if(errorUserLikeResult || errorBookmarksResult || errorReactionsResult){
        console.error('supabase error while fetching user journals:', errorBookmarksResult?.message || errorUserLikeResult?.message || errorReactionsResult?.message);
        return {status: 500, error: 'supabase error while fetching user journals'};
    }

    const userLikesSet = new Set(userLikesResult?.map((x) => x.journal_id) || [])
    const userBookmarksSet = new Set(userBookmarksResult?.map((y) => y.journal_id) || []);
    const userReactionMap = new Map((userReactionsResult || []).map((r) => [r.journal_id, r.reaction_type]));

    const formattedData = journals?.map((j) => ({
        ...j,
        has_liked: userLikesSet.has(j.id),
        has_bookmarked: userBookmarksSet.has(j.id),
        user_reaction: userReactionMap.get(j.id) || null
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
    .select(OPINION_WITH_USER_SELECT)
    .eq('id', postId)
    .eq('user_id', userId)

    const {data: opinion, error: errorOpinion} = await query;

    if(errorOpinion){
        console.error('supabase error:', errorOpinion.message);
        throw { status: 500, error: 'supabase error while fetching opinions'};
    }

    return {data: opinion};

}

export const getCommentsService = async(postId, limit, before, parentId) => {
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
        .select(COMMENT_WITH_USER_SELECT)
        .eq('post_id', postId);

    if(parentId){
        query = query.eq('parent_id', parentId);
    } else {
        query = query.is('parent_id', null);
    }

    query = query
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
    .select(OPINION_WITH_USER_SELECT)
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
    .select(`id, created_at, journal_id,
        journals(
        id, created_at, user_id, content, title, post_type,
        comment_count: comments(count),
        bookmark_count: bookmarks(count),

        users(name, image_url, badge),

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

export const searchUsersService = async(query, limit = 10) => {
    const normalizedQuery = normalizeSearchQuery(query);
    if(!normalizedQuery || normalizedQuery.length < SEARCH_QUERY_MIN_LENGTH){
        throw {status: 400, error: `query should be at least ${SEARCH_QUERY_MIN_LENGTH} characters`};
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > SEARCH_LIMIT_MAX){
        throw {status: 400, error: `limit should be an integer between 1 and ${SEARCH_LIMIT_MAX}`};
    }

    const escapedQuery = normalizedQuery.replace(/[%_]/g, (match) => `\\${match}`);
    const selectColumns = 'id, name, username, image_url, badge';

    const [nameResult, usernameResult] = await Promise.all([
        supabase
            .from('users')
            .select(selectColumns)
            .ilike('name', `%${escapedQuery}%`)
            .limit(parsedLimit + 1),
        supabase
            .from('users')
            .select(selectColumns)
            .ilike('username', `%${escapedQuery}%`)
            .limit(parsedLimit + 1)
    ]);

    if(nameResult.error || usernameResult.error){
        console.error('user search error:', nameResult.error?.message || usernameResult.error?.message);
        throw {status: 500, error: 'supabase error while searching users'};
    }

    const userMap = new Map();
    (nameResult.data || []).forEach((user) => {
        userMap.set(user.id, user);
    });
    (usernameResult.data || []).forEach((user) => {
        if(!userMap.has(user.id)){
            userMap.set(user.id, user);
        }
    });

    const users = [...userMap.values()];
    const hasMore = users.length > parsedLimit;

    return {
        data: hasMore ? users.slice(0, parsedLimit) : users,
        hasMore: hasMore
    };
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

    const selectColumns = JOURNAL_WITH_COUNTS_SELECT;

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
