import {
    createChapterService,
    getChapterService,
    updateChapterService,
    deleteChapterService,
    reorderChaptersService,
} from "../services/chapterService.js";

export const createChapterController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    const { title } = req.body;
    try {
        const chapter = await createChapterService(storyId, userId, title);
        return res.status(201).json(chapter);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to create chapter' });
    }
};

export const getChapterController = async (req, res) => {
    const { storyId, chapterId } = req.params;
    const userId = req.userId || null;
    try {
        const chapter = await getChapterService(storyId, chapterId, userId);
        return res.status(200).json(chapter);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch chapter' });
    }
};

export const updateChapterController = async (req, res) => {
    const userId = req.userId;
    const { storyId, chapterId } = req.params;
    const { title, content, status } = req.body;
    try {
        const chapter = await updateChapterService(storyId, chapterId, userId, { title, content, status });
        return res.status(200).json(chapter);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to update chapter' });
    }
};

export const deleteChapterController = async (req, res) => {
    const userId = req.userId;
    const { storyId, chapterId } = req.params;
    try {
        const result = await deleteChapterService(storyId, chapterId, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to delete chapter' });
    }
};

export const reorderChaptersController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    const { chapterOrder } = req.body;
    try {
        const result = await reorderChaptersService(storyId, userId, chapterOrder);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to reorder chapters' });
    }
};
