import { getRelatedPostsService } from "../services/discoveryService.js";

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
