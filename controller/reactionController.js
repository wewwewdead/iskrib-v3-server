import { toggleReactionService, getPostReactionsService } from "../services/reactionService.js";

export const toggleReactionController = async (req, res) => {
    try {
        const { journalId, receiverId, reactionType } = req.body;
        const senderId = req.userId;

        if (!journalId || !reactionType) {
            return res.status(400).json({ error: 'journalId and reactionType are required' });
        }

        const result = await toggleReactionService(journalId, receiverId || senderId, senderId, reactionType);
        return res.status(200).json(result);
    } catch (err) {
        console.error('error in toggleReactionController:', err);
        const status = err?.status || 500;
        return res.status(status).json({ error: err?.error || 'failed to toggle reaction' });
    }
};

export const getPostReactionsController = async (req, res) => {
    try {
        const { journalId } = req.params;
        if (!journalId) {
            return res.status(400).json({ error: 'journalId is required' });
        }

        const result = await getPostReactionsService(journalId);
        return res.status(200).json(result);
    } catch (err) {
        console.error('error in getPostReactionsController:', err);
        const status = err?.status || 500;
        return res.status(status).json({ error: err?.error || 'failed to get reactions' });
    }
};
