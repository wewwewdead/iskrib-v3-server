import {
    toggleVoteService,
    toggleLibraryService,
    getMyLibraryService,
    getCommentsService,
    getCommentCountsService,
    addCommentService,
    saveProgressService,
    getProgressService,
} from "../services/storyInteractService.js";

export const toggleVoteController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    try {
        const result = await toggleVoteService(storyId, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to toggle vote' });
    }
};

export const toggleLibraryController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    try {
        const result = await toggleLibraryService(storyId, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to toggle library' });
    }
};

export const getMyLibraryController = async (req, res) => {
    const userId = req.userId;
    const { limit, before } = req.query;
    try {
        const result = await getMyLibraryService(userId, limit, before);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch library' });
    }
};

export const getCommentsController = async (req, res) => {
    const { chapterId } = req.params;
    const { paragraph_index } = req.query;
    try {
        const comments = await getCommentsService(chapterId, paragraph_index);
        return res.status(200).json(comments);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch comments' });
    }
};

export const getCommentCountsController = async (req, res) => {
    const { chapterId } = req.params;
    try {
        const counts = await getCommentCountsService(chapterId);
        return res.status(200).json(counts);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch comment counts' });
    }
};

export const addCommentController = async (req, res) => {
    const userId = req.userId;
    const { chapterId } = req.params;
    const { comment, paragraph_index, paragraph_fingerprint, parent_id } = req.body;
    try {
        const result = await addCommentService(chapterId, userId, comment, paragraph_index, paragraph_fingerprint, parent_id);
        return res.status(201).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to add comment' });
    }
};

export const saveProgressController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    const { chapter_id, scroll_position, paragraph_index, paragraph_offset } = req.body;
    try {
        const result = await saveProgressService(storyId, userId, {
            chapter_id,
            scroll_position,
            paragraph_index,
            paragraph_offset,
        });
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to save progress' });
    }
};

export const getProgressController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    try {
        const result = await getProgressService(storyId, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch progress' });
    }
};
