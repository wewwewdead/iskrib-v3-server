import supabase from "./supabase.js";
import { imageUploader } from "../routes/routes.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";
import { createMediaResponsePayload } from "../utils/mediaVariants.js";

/** Strip the embedding vector from a story object before sending to client. */
const stripEmbedding = (story) => {
    if (!story) return story;
    const { embedding, ...rest } = story;
    return rest;
};

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

const decorateAuthorSummary = (user, usage = 'card') => {
    if(!user){
        return user;
    }

    const avatarMedia = createMediaResponsePayload('avatars', user.image_url, usage);
    return {
        ...user,
        image_url: avatarMedia?.preferred_url || user.image_url || null,
        avatar_media: avatarMedia
    };
};

const decorateStoryMedia = (story, usage = 'card') => {
    if(!story){
        return story;
    }

    const coverMedia = createMediaResponsePayload('story-covers', story.cover_url, usage);
    return {
        ...story,
        cover_url: coverMedia?.preferred_url || story.cover_url || null,
        cover_media: coverMedia
    };
};

/**
 * Batch-fetch public user profiles for a list of author IDs.
 */
const fetchAuthorProfiles = async (authorIds) => {
    const unique = [...new Set(authorIds.filter(Boolean))];
    if (unique.length === 0) return {};

    const { data, error } = await supabase
        .from('users')
        .select('id, name, image_url, username, badge')
        .in('id', unique);

    if (error) {
        console.error('supabase error fetching author profiles:', error.message);
        return {};
    }

    const map = {};
    (data || []).forEach(u => { map[u.id] = decorateAuthorSummary(u, 'card'); });
    return map;
};

export const createStoryService = async (userId, title, description, status, privacy, tags, coverFile) => {
    if (!userId) {
        throw { status: 400, error: 'userId is undefined' };
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        throw { status: 400, error: 'title is required' };
    }
    if (title.length > 200) {
        throw { status: 400, error: 'title must be 200 characters or less' };
    }
    if (description && description.length > 2000) {
        throw { status: 400, error: 'description must be 2000 characters or less' };
    }

    const validStatuses = ['ongoing', 'completed', 'hiatus'];
    const validPrivacy = ['public', 'private'];
    const storyStatus = validStatuses.includes(status) ? status : 'ongoing';
    const storyPrivacy = validPrivacy.includes(privacy) ? privacy : 'public';

    let parsedTags = [];
    if (tags) {
        try {
            parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
            if (!Array.isArray(parsedTags)) parsedTags = [];
            parsedTags = parsedTags.slice(0, 10).map(t => String(t).trim()).filter(Boolean);
        } catch {
            parsedTags = [];
        }
    }

    let coverUrl = null;
    if (coverFile) {
        coverUrl = await imageUploader(coverFile, userId, 'story-covers');
    }

    const embedding = await GenerateEmbeddings(title.trim(), (description || '').trim());
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        throw { status: 400, error: 'failed to generate story embedding' };
    }

    const { data, error } = await supabase
        .from('stories')
        .insert({
            author_id: userId,
            title: title.trim(),
            description: (description || '').trim(),
            cover_url: coverUrl,
            status: storyStatus,
            privacy: storyPrivacy,
            tags: parsedTags,
            embedding,
        })
        .select(STORY_SELECT_COLUMNS)
        .single();

    if (error) {
        console.error('supabase error creating story:', error.message);
        throw { status: 500, error: 'failed to create story' };
    }

    return decorateStoryMedia(stripEmbedding(data), 'detail');
};

export const getStoriesService = async (limit, before, status, tag, userId) => {
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 20);

    let query = supabase
        .from('stories')
        .select(STORY_SELECT_COLUMNS)
        .eq('privacy', 'public')
        .order('created_at', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) {
        query = query.lt('created_at', before);
    }
    if (status && ['ongoing', 'completed', 'hiatus'].includes(status)) {
        query = query.eq('status', status);
    }
    if (tag) {
        query = query.contains('tags', [tag]);
    }

    const { data, error } = await query;

    if (error) {
        console.error('supabase error fetching stories:', error.message);
        throw { status: 500, error: 'failed to fetch stories' };
    }

    if (!data || data.length === 0) {
        return { data: [], hasMore: false };
    }

    // Batch-fetch author profiles
    const authorMap = await fetchAuthorProfiles(data.map(s => s.author_id));

    // Fetch user interaction flags if logged in
    let userVotedSet = new Set();
    let userLibrarySet = new Set();

    if (userId) {
        const storyIds = data.map(s => s.id);
        const [votes, library] = await Promise.all([
            supabase.from('story_votes').select('story_id').in('story_id', storyIds).eq('user_id', userId),
            supabase.from('story_library').select('story_id').in('story_id', storyIds).eq('user_id', userId),
        ]);

        if (votes.data) userVotedSet = new Set(votes.data.map(v => v.story_id));
        if (library.data) userLibrarySet = new Set(library.data.map(l => l.story_id));
    }

    const formatted = data.map(story => ({
        ...decorateStoryMedia(stripEmbedding(story), 'card'),
        users: authorMap[story.author_id] || null,
        has_voted: userVotedSet.has(story.id),
        in_library: userLibrarySet.has(story.id),
    }));

    const hasMore = data.length > parsedLimit;
    const sliced = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return { data: sliced, hasMore };
};

export const getStoryByIdService = async (storyId, userId) => {
    if (!storyId) {
        throw { status: 400, error: 'storyId is required' };
    }

    const { data: story, error } = await supabase
        .from('stories')
        .select(STORY_SELECT_COLUMNS)
        .eq('id', storyId)
        .single();

    if (error || !story) {
        console.error('supabase error fetching story:', error?.message);
        throw { status: 404, error: 'story not found' };
    }

    // Non-author can't see private stories
    if (story.privacy === 'private' && story.author_id !== userId) {
        throw { status: 404, error: 'story not found' };
    }

    // Fetch author profile + chapters in parallel
    const [authorMap, chapResult] = await Promise.all([
        fetchAuthorProfiles([story.author_id]),
        supabase
            .from('chapters')
            .select('id, chapter_number, title, word_count, status, published_at, created_at')
            .eq('story_id', storyId)
            .order('chapter_number', { ascending: true }),
    ]);

    if (chapResult.error) {
        console.error('supabase error fetching chapters:', chapResult.error.message);
    }

    // Filter chapters for non-authors
    const isAuthor = story.author_id === userId;
    const chapters = chapResult.data || [];
    const visibleChapters = isAuthor
        ? chapters
        : chapters.filter(c => c.status === 'published');

    // Fetch user flags
    let hasVoted = false;
    let inLibrary = false;
    let readingProgress = null;

    if (userId) {
        const [voteRes, libRes, progressRes] = await Promise.all([
            supabase.from('story_votes').select('id').eq('story_id', storyId).eq('user_id', userId).maybeSingle(),
            supabase.from('story_library').select('id').eq('story_id', storyId).eq('user_id', userId).maybeSingle(),
            supabase.from('reading_progress').select('chapter_id, scroll_position, last_read_at').eq('story_id', storyId).eq('user_id', userId).maybeSingle(),
        ]);

        hasVoted = !!voteRes.data;
        inLibrary = !!libRes.data;
        readingProgress = progressRes.data || null;
    }

    return {
        ...decorateStoryMedia(stripEmbedding(story), 'detail'),
        users: authorMap[story.author_id] || null,
        chapters: visibleChapters,
        has_voted: hasVoted,
        in_library: inLibrary,
        reading_progress: readingProgress,
        is_author: isAuthor,
    };
};

export const updateStoryService = async (storyId, userId, updates, coverFile) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }

    // Verify ownership (also grab title + description for embedding check)
    const { data: existing, error: fetchError } = await supabase
        .from('stories')
        .select('author_id, title, description')
        .eq('id', storyId)
        .single();

    if (fetchError || !existing) {
        throw { status: 404, error: 'story not found' };
    }
    if (existing.author_id !== userId) {
        throw { status: 403, error: 'not authorized to update this story' };
    }

    const updateData = {};
    if (updates.title !== undefined) {
        if (!updates.title || updates.title.trim().length === 0) {
            throw { status: 400, error: 'title cannot be empty' };
        }
        updateData.title = updates.title.trim();
    }
    if (updates.description !== undefined) {
        updateData.description = (updates.description || '').trim();
    }
    if (updates.status !== undefined && ['ongoing', 'completed', 'hiatus'].includes(updates.status)) {
        updateData.status = updates.status;
    }
    if (updates.privacy !== undefined && ['public', 'private'].includes(updates.privacy)) {
        updateData.privacy = updates.privacy;
    }
    if (updates.tags !== undefined) {
        let parsedTags = [];
        try {
            parsedTags = typeof updates.tags === 'string' ? JSON.parse(updates.tags) : updates.tags;
            if (!Array.isArray(parsedTags)) parsedTags = [];
            parsedTags = parsedTags.slice(0, 10).map(t => String(t).trim()).filter(Boolean);
        } catch {
            parsedTags = [];
        }
        updateData.tags = parsedTags;
    }

    if (coverFile) {
        updateData.cover_url = await imageUploader(coverFile, userId, 'story-covers');
    }

    if (Object.keys(updateData).length === 0) {
        throw { status: 400, error: 'no valid fields to update' };
    }

    // Regenerate embedding if title or description changed
    if (updateData.title !== undefined || updateData.description !== undefined) {
        const resolvedTitle = updateData.title ?? existing.title;
        const resolvedDesc = updateData.description ?? (existing.description || '');
        const embedding = await GenerateEmbeddings(resolvedTitle, resolvedDesc);
        if (embedding && Array.isArray(embedding) && embedding.length > 0) {
            updateData.embedding = embedding;
        }
    }

    const { data, error } = await supabase
        .from('stories')
        .update(updateData)
        .eq('id', storyId)
        .select(STORY_SELECT_COLUMNS)
        .single();

    if (error) {
        console.error('supabase error updating story:', error.message);
        throw { status: 500, error: 'failed to update story' };
    }

    return decorateStoryMedia(stripEmbedding(data), 'detail');
};

export const deleteStoryService = async (storyId, userId) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }

    const { data: existing, error: fetchError } = await supabase
        .from('stories')
        .select('author_id')
        .eq('id', storyId)
        .single();

    if (fetchError || !existing) {
        throw { status: 404, error: 'story not found' };
    }
    if (existing.author_id !== userId) {
        throw { status: 403, error: 'not authorized to delete this story' };
    }

    const { error } = await supabase
        .from('stories')
        .delete()
        .eq('id', storyId);

    if (error) {
        console.error('supabase error deleting story:', error.message);
        throw { status: 500, error: 'failed to delete story' };
    }

    return { message: 'story deleted' };
};

export const getMyStoriesService = async (userId, limit, before) => {
    if (!userId) {
        throw { status: 400, error: 'userId is required' };
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 20);

    let query = supabase
        .from('stories')
        .select(`${STORY_SELECT_COLUMNS}, chapters(id, chapter_number, title, status, word_count)`)
        .eq('author_id', userId)
        .order('updated_at', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) {
        query = query.lt('updated_at', before);
    }

    const { data, error } = await query;

    if (error) {
        console.error('supabase error fetching my stories:', error.message);
        throw { status: 500, error: 'failed to fetch stories' };
    }

    if (!data || data.length === 0) {
        return { data: [], hasMore: false };
    }

    const hasMore = data.length > parsedLimit;
    const sliced = hasMore ? data.slice(0, parsedLimit) : data;

    return { data: sliced.map((story) => decorateStoryMedia(stripEmbedding(story), 'card')), hasMore };
};

export const getUserStoriesService = async (targetUserId, limit, before) => {
    if (!targetUserId) {
        throw { status: 400, error: 'userId is required' };
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 20);

    let query = supabase
        .from('stories')
        .select(STORY_SELECT_COLUMNS)
        .eq('author_id', targetUserId)
        .eq('privacy', 'public')
        .order('created_at', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) {
        query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
        console.error('supabase error fetching user stories:', error.message);
        throw { status: 500, error: 'failed to fetch user stories' };
    }

    if (!data || data.length === 0) {
        return { data: [], hasMore: false };
    }

    // Batch-fetch author profiles
    const authorMap = await fetchAuthorProfiles(data.map(s => s.author_id));
    const formatted = data.map((story) => ({
        ...decorateStoryMedia(stripEmbedding(story), 'card'),
        users: authorMap[story.author_id] || null
    }));

    const hasMore = data.length > parsedLimit;
    const sliced = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return { data: sliced, hasMore };
};
