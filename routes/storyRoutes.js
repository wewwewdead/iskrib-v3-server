import express from "express";
import multer from "multer";
import supabase from "../services/supabase.js";

import {
    createStoryController,
    getStoriesController,
    getStoryByIdController,
    updateStoryController,
    deleteStoryController,
    getMyStoriesController,
    getUserStoriesController,
} from "../controller/storyController.js";

import {
    createChapterController,
    getChapterController,
    updateChapterController,
    deleteChapterController,
    reorderChaptersController,
} from "../controller/chapterController.js";

import {
    toggleVoteController,
    toggleLibraryController,
    getMyLibraryController,
    getCommentsController,
    getCommentCountsController,
    addCommentController,
    saveProgressController,
    getProgressController,
} from "../controller/storyInteractController.js";

const storyRouter = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
}).single('image');

// ── Auth middleware (same pattern as routes.js) ──

const extractBearerToken = (authHeader = "") => {
    const trimmed = typeof authHeader === "string" ? authHeader.trim() : "";
    if (!trimmed) return "";
    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) return bearerMatch[1].trim();
    return trimmed;
};

const resolveAuthUser = async (token) => {
    if (!token) return { user: null, error: null };
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
        return { user: null, error: authError || new Error("missing user id") };
    }
    return { user: authData.user, error: null };
};

const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) return res.status(401).json({ error: 'not authorized' });
    const { user, error } = await resolveAuthUser(token);
    if (error || !user?.id) return res.status(401).json({ error: 'not authorized' });
    req.userId = user.id;
    req.authUser = user;
    return next();
};

const optionalAuth = async (req, _res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) return next();
    const { user } = await resolveAuthUser(token);
    if (user?.id) {
        req.userId = user.id;
        req.authUser = user;
    }
    return next();
};

// ── Story routes ──
storyRouter.post('/stories', requireAuth, upload, createStoryController);
storyRouter.get('/stories', optionalAuth, getStoriesController);
storyRouter.get('/stories/my', requireAuth, getMyStoriesController);
storyRouter.get('/stories/library', requireAuth, getMyLibraryController);
storyRouter.get('/stories/user/:userId', optionalAuth, getUserStoriesController);
storyRouter.get('/stories/:storyId', optionalAuth, getStoryByIdController);
storyRouter.patch('/stories/:storyId', requireAuth, upload, updateStoryController);
storyRouter.delete('/stories/:storyId', requireAuth, deleteStoryController);

// ── Chapter routes ──
storyRouter.post('/stories/:storyId/chapters', requireAuth, createChapterController);
storyRouter.get('/stories/:storyId/chapters/:chapterId', optionalAuth, getChapterController);
storyRouter.patch('/stories/:storyId/chapters/:chapterId', requireAuth, updateChapterController);
storyRouter.delete('/stories/:storyId/chapters/:chapterId', requireAuth, deleteChapterController);
storyRouter.post('/stories/:storyId/chapters/reorder', requireAuth, reorderChaptersController);

// ── Interaction routes ──
storyRouter.post('/stories/:storyId/vote', requireAuth, toggleVoteController);
storyRouter.post('/stories/:storyId/library', requireAuth, toggleLibraryController);
storyRouter.get('/chapters/:chapterId/comments', optionalAuth, getCommentsController);
storyRouter.get('/chapters/:chapterId/comment-counts', optionalAuth, getCommentCountsController);
storyRouter.post('/chapters/:chapterId/comments', requireAuth, addCommentController);
storyRouter.post('/stories/:storyId/progress', requireAuth, saveProgressController);
storyRouter.get('/stories/:storyId/progress', requireAuth, getProgressController);

export default storyRouter;
