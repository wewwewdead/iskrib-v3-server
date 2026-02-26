import supabase from "./supabase.js";

/**
 * Extract word count from Lexical JSON content.
 * Walks all text nodes and counts whitespace-separated words.
 */
const extractWordCount = (content) => {
    if (!content) return 0;
    let parsed = content;
    if (typeof content === 'string') {
        try { parsed = JSON.parse(content); } catch { return 0; }
    }

    let text = '';
    const walk = (node) => {
        if (node.text) text += node.text + ' ';
        if (node.children) node.children.forEach(walk);
    };
    if (parsed.root) walk(parsed.root);
    else walk(parsed);

    return text.trim() ? text.trim().split(/\s+/).length : 0;
};

/**
 * Verify story ownership. Returns the story row or throws.
 */
const verifyStoryOwnership = async (storyId, userId) => {
    const { data, error } = await supabase
        .from('stories')
        .select('author_id')
        .eq('id', storyId)
        .single();

    if (error || !data) {
        throw { status: 404, error: 'story not found' };
    }
    if (data.author_id !== userId) {
        throw { status: 403, error: 'not authorized' };
    }
    return data;
};

export const createChapterService = async (storyId, userId, title) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }

    await verifyStoryOwnership(storyId, userId);

    // Get next chapter number
    const { data: lastChapter } = await supabase
        .from('chapters')
        .select('chapter_number')
        .eq('story_id', storyId)
        .order('chapter_number', { ascending: false })
        .limit(1)
        .maybeSingle();

    const nextNumber = (lastChapter?.chapter_number || 0) + 1;

    const { data, error } = await supabase
        .from('chapters')
        .insert({
            story_id: storyId,
            chapter_number: nextNumber,
            title: (title || 'Untitled Chapter').trim(),
        })
        .select('*')
        .single();

    if (error) {
        console.error('supabase error creating chapter:', error.message);
        throw { status: 500, error: 'failed to create chapter' };
    }

    return data;
};

export const getChapterService = async (storyId, chapterId, userId) => {
    if (!storyId || !chapterId) {
        throw { status: 400, error: 'storyId and chapterId are required' };
    }

    // Fetch story to check privacy
    const { data: story, error: storyError } = await supabase
        .from('stories')
        .select('author_id, privacy')
        .eq('id', storyId)
        .single();

    if (storyError || !story) {
        throw { status: 404, error: 'story not found' };
    }

    const isAuthor = story.author_id === userId;
    if (story.privacy === 'private' && !isAuthor) {
        throw { status: 404, error: 'story not found' };
    }

    const { data: chapter, error } = await supabase
        .from('chapters')
        .select('*')
        .eq('id', chapterId)
        .eq('story_id', storyId)
        .single();

    if (error || !chapter) {
        throw { status: 404, error: 'chapter not found' };
    }

    // Non-author can't see draft chapters
    if (chapter.status === 'draft' && !isAuthor) {
        throw { status: 404, error: 'chapter not found' };
    }

    // Fetch adjacent chapters for navigation
    const [prevRes, nextRes] = await Promise.all([
        supabase
            .from('chapters')
            .select('id, chapter_number, title')
            .eq('story_id', storyId)
            .lt('chapter_number', chapter.chapter_number)
            .eq('status', isAuthor ? chapter.status : 'published')
            .order('chapter_number', { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase
            .from('chapters')
            .select('id, chapter_number, title')
            .eq('story_id', storyId)
            .gt('chapter_number', chapter.chapter_number)
            .eq('status', isAuthor ? chapter.status : 'published')
            .order('chapter_number', { ascending: true })
            .limit(1)
            .maybeSingle(),
    ]);

    // Increment read count on story (fire and forget)
    if (!isAuthor && chapter.status === 'published') {
        supabase.rpc('increment_story_reads', { sid: storyId }).then(() => {}).catch(() => {});
    }

    return {
        ...chapter,
        prev_chapter: prevRes.data || null,
        next_chapter: nextRes.data || null,
        is_author: isAuthor,
    };
};

export const updateChapterService = async (storyId, chapterId, userId, updates) => {
    if (!storyId || !chapterId || !userId) {
        throw { status: 400, error: 'storyId, chapterId, and userId are required' };
    }

    await verifyStoryOwnership(storyId, userId);

    const updateData = {};

    if (updates.title !== undefined) {
        updateData.title = (updates.title || 'Untitled Chapter').trim();
    }
    if (updates.content !== undefined) {
        // Store as JSONB – parse if string to validate, then store parsed
        let parsed = updates.content;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch {
                throw { status: 400, error: 'invalid content JSON' };
            }
        }
        updateData.content = parsed;
        updateData.word_count = extractWordCount(parsed);
    }
    if (updates.status !== undefined) {
        if (!['draft', 'published'].includes(updates.status)) {
            throw { status: 400, error: 'invalid chapter status' };
        }
        updateData.status = updates.status;
        if (updates.status === 'published') {
            // Set published_at only on first publish
            const { data: current } = await supabase
                .from('chapters')
                .select('published_at')
                .eq('id', chapterId)
                .single();
            if (!current?.published_at) {
                updateData.published_at = new Date().toISOString();

                // Non-fatal: record publish for writing streak (first publish only)
                try {
                    const { recordPublishForStreak } = await import('./streakService.js');
                    recordPublishForStreak(userId).catch(err =>
                        console.error('non-fatal: streak record failed:', err?.message || err)
                    );
                } catch (streakErr) {
                    console.error('non-fatal: streak record failed:', streakErr?.message || streakErr);
                }
            }
        }
    }

    if (Object.keys(updateData).length === 0) {
        throw { status: 400, error: 'no valid fields to update' };
    }

    const { data, error } = await supabase
        .from('chapters')
        .update(updateData)
        .eq('id', chapterId)
        .eq('story_id', storyId)
        .select('*')
        .single();

    if (error) {
        console.error('supabase error updating chapter:', error.message);
        throw { status: 500, error: 'failed to update chapter' };
    }

    return data;
};

export const deleteChapterService = async (storyId, chapterId, userId) => {
    if (!storyId || !chapterId || !userId) {
        throw { status: 400, error: 'storyId, chapterId, and userId are required' };
    }

    await verifyStoryOwnership(storyId, userId);

    const { error } = await supabase
        .from('chapters')
        .delete()
        .eq('id', chapterId)
        .eq('story_id', storyId);

    if (error) {
        console.error('supabase error deleting chapter:', error.message);
        throw { status: 500, error: 'failed to delete chapter' };
    }

    return { message: 'chapter deleted' };
};

export const reorderChaptersService = async (storyId, userId, chapterOrder) => {
    if (!storyId || !userId) {
        throw { status: 400, error: 'storyId and userId are required' };
    }
    if (!Array.isArray(chapterOrder) || chapterOrder.length === 0) {
        throw { status: 400, error: 'chapterOrder must be a non-empty array of chapter ids' };
    }

    await verifyStoryOwnership(storyId, userId);

    // Update each chapter's number based on position in array
    const updates = chapterOrder.map((chapterId, index) =>
        supabase
            .from('chapters')
            .update({ chapter_number: index + 1 })
            .eq('id', chapterId)
            .eq('story_id', storyId)
    );

    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) {
        console.error('supabase error reordering chapters:', failed.error.message);
        throw { status: 500, error: 'failed to reorder chapters' };
    }

    return { message: 'chapters reordered' };
};
