import { getRelatedPostsService, getUserEchoesService, getJournalThreadService } from "../services/discoveryService.js";

export const getRelatedPostsController = async (req, res) => {
    const { journalId } = req.params;
    try {
        const result = await getRelatedPostsService(journalId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch related posts' });
    }
};

// Echo Bloom: returns the requesting user's own past journals that are
// semantically close to `journalId`. Auth-required; the user id comes from
// the session — NEVER trust a user id query param here.
export const getUserEchoesController = async (req, res) => {
    const { journalId } = req.params;
    const userId = req.userId;
    try {
        const result = await getUserEchoesService(journalId, userId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch user echoes' });
    }
};

// V3 — Thread: returns the full parent/child chain containing `journalId`.
// Optional auth; if the caller is authenticated, their user id is passed
// to the RPC so their own private posts remain visible in the thread.
export const getJournalThreadController = async (req, res) => {
    const { journalId } = req.params;
    const viewerUserId = req.userId ?? null;
    try {
        const result = await getJournalThreadService(journalId, viewerUserId);
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch journal thread' });
    }
};
