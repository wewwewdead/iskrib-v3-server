import {
    createStoryService,
    getStoriesService,
    getStoryByIdService,
    updateStoryService,
    deleteStoryService,
    getMyStoriesService,
    getUserStoriesService,
} from "../services/storyService.js";

export const createStoryController = async (req, res) => {
    const userId = req.userId;
    const { title, description, status, privacy, tags } = req.body;
    const coverFile = req.file || null;
    try {
        const story = await createStoryService(userId, title, description, status, privacy, tags, coverFile);
        return res.status(201).json(story);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to create story' });
    }
};

export const getStoriesController = async (req, res) => {
    const { limit, before, status, tag } = req.query;
    const userId = req.userId || null;
    try {
        const result = await getStoriesService(limit, before, status, tag, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch stories' });
    }
};

export const getStoryByIdController = async (req, res) => {
    const { storyId } = req.params;
    const userId = req.userId || null;
    try {
        const story = await getStoryByIdService(storyId, userId);
        return res.status(200).json(story);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch story' });
    }
};

export const updateStoryController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    const { title, description, status, privacy, tags } = req.body;
    const coverFile = req.file || null;
    try {
        const story = await updateStoryService(storyId, userId, { title, description, status, privacy, tags }, coverFile);
        return res.status(200).json(story);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to update story' });
    }
};

export const deleteStoryController = async (req, res) => {
    const userId = req.userId;
    const { storyId } = req.params;
    try {
        const result = await deleteStoryService(storyId, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to delete story' });
    }
};

export const getMyStoriesController = async (req, res) => {
    const userId = req.userId;
    const { limit, before } = req.query;
    try {
        const result = await getMyStoriesService(userId, limit, before);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch stories' });
    }
};

export const getUserStoriesController = async (req, res) => {
    const { userId: targetUserId } = req.params;
    const { limit, before } = req.query;
    try {
        const result = await getUserStoriesService(targetUserId, limit, before);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch user stories' });
    }
};
