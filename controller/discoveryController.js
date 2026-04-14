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

// V3 — Thread: returns the parent/child chain containing `journalId`.
// Optional auth; if the caller is authenticated, their user id is passed
// to the RPC so their own private posts remain visible in the thread.
//
// Pagination is opt-in via ?limit=N&offset=M. Absent params → limit=null,
// which the RPC treats as "return every row", preserving the web app's
// current call shape. The response always includes totalCount and hasMore.
export const getJournalThreadController = async (req, res) => {
    const { journalId } = req.params;
    const viewerUserId = req.userId ?? null;

    const rawLimit = req.query?.limit;
    const rawOffset = req.query?.offset;

    let limit = null;
    if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
        const n = Number.parseInt(rawLimit, 10);
        if (Number.isFinite(n)) {
            limit = Math.min(Math.max(n, 1), 50);
        }
    }

    let offset = 0;
    if (rawOffset !== undefined && rawOffset !== null && rawOffset !== '') {
        const n = Number.parseInt(rawOffset, 10);
        if (Number.isFinite(n) && n >= 0) {
            offset = n;
        }
    }

    try {
        const result = await getJournalThreadService(journalId, viewerUserId, { limit, offset });
        return res.status(200).json(result);
    } catch (error) {
        const s = error?.status || 500;
        return res.status(s).json({ error: error?.error || 'failed to fetch journal thread' });
    }
};
