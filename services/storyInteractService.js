import supabase from "./supabase.js";

const STORY_SELECT_COLUMNS = `
    id,
    author_id,
    title,
    description,
    cover_url,
    status,
    tags,
    privacy,
    read_count,
    vote_count,
    created_at,
    updated_at
`;

// ── Vote toggle ──
export const toggleVoteService = async (storyId, userId) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }

    const { data: existing } = await supabase
        .from('story_votes')
        .select('id')
        .eq('story_id', storyId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!existing) {
        const { error } = await supabase
            .from('story_votes')
            .insert({ story_id: storyId, user_id: userId });

        if (error) {
            console.error('supabase error inserting vote:', error.message);
            throw { status: 500, error: 'failed to vote' };
        }

        // Increment vote_count
        const { data: story } = await supabase
            .from('stories')
            .select('vote_count')
            .eq('id', storyId)
            .single();
        if (story) {
            await supabase
                .from('stories')
                .update({ vote_count: (story.vote_count || 0) + 1 })
                .eq('id', storyId);
        }

        return { message: 'voted' };
    } else {
        const { error } = await supabase
            .from('story_votes')
            .delete()
            .eq('story_id', storyId)
            .eq('user_id', userId);

        if (error) {
            console.error('supabase error deleting vote:', error.message);
            throw { status: 500, error: 'failed to unvote' };
        }

        // Decrement vote_count
        const { data: story } = await supabase
            .from('stories')
            .select('vote_count')
            .eq('id', storyId)
            .single();
        if (story) {
            await supabase
                .from('stories')
                .update({ vote_count: Math.max(0, (story.vote_count || 0) - 1) })
                .eq('id', storyId);
        }

        return { message: 'unvoted' };
    }
};

// ── Library toggle ──
export const toggleLibraryService = async (storyId, userId) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }

    const { data: existing } = await supabase
        .from('story_library')
        .select('id')
        .eq('story_id', storyId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!existing) {
        const { error } = await supabase
            .from('story_library')
            .insert({ story_id: storyId, user_id: userId });

        if (error) {
            console.error('supabase error adding to library:', error.message);
            throw { status: 500, error: 'failed to add to library' };
        }
        return { message: 'added' };
    } else {
        const { error } = await supabase
            .from('story_library')
            .delete()
            .eq('story_id', storyId)
            .eq('user_id', userId);

        if (error) {
            console.error('supabase error removing from library:', error.message);
            throw { status: 500, error: 'failed to remove from library' };
        }
        return { message: 'removed' };
    }
};

// ── My Library ──
export const getMyLibraryService = async (userId, limit, before) => {
    if (!userId) {
        throw { status: 400, error: 'userId is required' };
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 20);

    // Get library entries ordered by most recently added
    let libQuery = supabase
        .from('story_library')
        .select('story_id, added_at')
        .eq('user_id', userId)
        .order('added_at', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) {
        libQuery = libQuery.lt('added_at', before);
    }

    const { data: libraryEntries, error: libError } = await libQuery;

    if (libError) {
        console.error('supabase error fetching library:', libError.message);
        throw { status: 500, error: 'failed to fetch library' };
    }

    if (!libraryEntries || libraryEntries.length === 0) {
        return { data: [], hasMore: false };
    }

    const hasMore = libraryEntries.length > parsedLimit;
    const slicedEntries = hasMore ? libraryEntries.slice(0, parsedLimit) : libraryEntries;
    const storyIds = slicedEntries.map(e => e.story_id);

    // Build added_at map for cursor
    const addedAtMap = {};
    slicedEntries.forEach(e => { addedAtMap[e.story_id] = e.added_at; });

    // Batch-fetch stories
    const { data: stories, error: storyError } = await supabase
        .from('stories')
        .select(STORY_SELECT_COLUMNS)
        .in('id', storyIds);

    if (storyError) {
        console.error('supabase error fetching library stories:', storyError.message);
        throw { status: 500, error: 'failed to fetch library stories' };
    }

    if (!stories || stories.length === 0) {
        return { data: [], hasMore };
    }

    // Batch-fetch author profiles
    const authorIds = [...new Set(stories.map(s => s.author_id))];
    const { data: authors } = await supabase
        .from('users')
        .select('id, name, image_url, username, badge')
        .in('id', authorIds);

    const authorMap = {};
    (authors || []).forEach(a => { authorMap[a.id] = a; });

    // Build story map for ordering
    const storyMap = {};
    stories.forEach(s => {
        const { embedding, ...rest } = s;
        storyMap[s.id] = { ...rest, users: authorMap[s.author_id] || null, in_library: true, added_at: addedAtMap[s.id] };
    });

    // Return in library order (most recently added first)
    const ordered = storyIds.map(id => storyMap[id]).filter(Boolean);

    return { data: ordered, hasMore };
};

// ── Comments ──
export const getCommentsService = async (chapterId, paragraphIndex) => {
    if (!chapterId) {
        throw { status: 400, error: 'chapterId is required' };
    }

    let query = supabase
        .from('story_comments')
        .select(`*, users(id, name, image_url, username, badge)`)
        .eq('chapter_id', chapterId)
        .is('parent_id', null)
        .order('created_at', { ascending: true })
        .limit(50);

    if (paragraphIndex !== undefined && paragraphIndex !== null) {
        query = query.eq('paragraph_index', parseInt(paragraphIndex));
    }

    const { data: comments, error } = await query;

    if (error) {
        console.error('supabase error fetching comments:', error.message);
        throw { status: 500, error: 'failed to fetch comments' };
    }

    // Fetch replies for all top-level comments
    if (comments && comments.length > 0) {
        const commentIds = comments.map(c => c.id);
        const { data: replies, error: replyError } = await supabase
            .from('story_comments')
            .select(`*, users(id, name, image_url, username, badge)`)
            .in('parent_id', commentIds)
            .order('created_at', { ascending: true })
            .limit(200);

        if (!replyError && replies) {
            const replyMap = {};
            replies.forEach(r => {
                if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
                replyMap[r.parent_id].push(r);
            });
            comments.forEach(c => {
                c.replies = replyMap[c.id] || [];
            });
        }
    }

    return comments || [];
};

export const getCommentCountsService = async (chapterId) => {
    if (!chapterId) {
        throw { status: 400, error: 'chapterId is required' };
    }

    const { data, error } = await supabase
        .from('story_comments')
        .select('paragraph_index')
        .eq('chapter_id', chapterId)
        .neq('paragraph_index', -1);

    if (error) {
        console.error('supabase error fetching comment counts:', error.message);
        throw { status: 500, error: 'failed to fetch comment counts' };
    }

    // Aggregate counts per paragraph_index
    const counts = {};
    (data || []).forEach(row => {
        const idx = row.paragraph_index;
        counts[idx] = (counts[idx] || 0) + 1;
    });

    return counts;
};

export const addCommentService = async (chapterId, userId, comment, paragraphIndex, paragraphFingerprint, parentId) => {
    if (!chapterId || !userId) {
        throw { status: 400, error: 'chapterId and userId are required' };
    }
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        throw { status: 400, error: 'comment is required' };
    }
    if (comment.length > 300) {
        throw { status: 400, error: 'comment must be 300 characters or less' };
    }

    const insertData = {
        chapter_id: chapterId,
        user_id: userId,
        comment: comment.trim(),
        paragraph_index: paragraphIndex !== undefined ? parseInt(paragraphIndex) : -1,
        paragraph_fingerprint: paragraphFingerprint || null,
        parent_id: parentId || null,
    };

    const { data, error } = await supabase
        .from('story_comments')
        .insert(insertData)
        .select(`*, users(id, name, image_url, username, badge)`)
        .single();

    if (error) {
        console.error('supabase error adding comment:', error.message);
        throw { status: 500, error: 'failed to add comment' };
    }

    return data;
};

// ── Reading Progress ──
export const saveProgressService = async (storyId, userId, chapterId, scrollPosition) => {
    if (!storyId || !userId || !chapterId) {
        throw { status: 400, error: 'storyId, userId, and chapterId are required' };
    }

    // Check if this is a new reader (no existing progress for this user+story)
    const { data: existing } = await supabase
        .from('reading_progress')
        .select('id')
        .eq('user_id', userId)
        .eq('story_id', storyId)
        .maybeSingle();

    const { data, error } = await supabase
        .from('reading_progress')
        .upsert({
            user_id: userId,
            story_id: storyId,
            chapter_id: chapterId,
            scroll_position: scrollPosition || 0,
            last_read_at: new Date().toISOString(),
        }, { onConflict: 'user_id,story_id' })
        .select('*')
        .single();

    if (error) {
        console.error('supabase error saving progress:', error.message);
        throw { status: 500, error: 'failed to save progress' };
    }

    // Increment read_count if this is a new reader (skip if author)
    if (!existing) {
        const { data: story } = await supabase
            .from('stories')
            .select('author_id')
            .eq('id', storyId)
            .single();

        if (story && story.author_id !== userId) {
            const { error: rpcError } = await supabase.rpc('increment_story_reads', { story_id_input: storyId });
            if (rpcError) {
                console.error('error incrementing story reads:', rpcError.message);
            }
        }
    }

    return data;
};

export const getProgressService = async (storyId, userId) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }

    const { data, error } = await supabase
        .from('reading_progress')
        .select('*, chapters(id, chapter_number, title)')
        .eq('story_id', storyId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('supabase error fetching progress:', error.message);
        throw { status: 500, error: 'failed to fetch progress' };
    }

    return data;
};
