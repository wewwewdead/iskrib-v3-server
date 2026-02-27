import { getTodaysPromptService, getPromptResponsesService } from "../services/promptService.js";

export const getTodaysPromptController = async (req, res) => {
    try {
        const prompt = await getTodaysPromptService();
        if (!prompt) {
            return res.status(404).json({ error: 'no prompt available' });
        }
        return res.status(200).json(prompt);
    } catch (err) {
        console.error('error in getTodaysPromptController:', err);
        return res.status(500).json({ error: 'failed to get prompt' });
    }
};

export const getPromptResponsesController = async (req, res) => {
    try {
        const { promptId } = req.params;
        if (!promptId) {
            return res.status(400).json({ error: 'promptId is required' });
        }
        const { limit, before } = req.query;
        const result = await getPromptResponsesService(
            parseInt(promptId, 10),
            limit,
            before || null
        );
        return res.status(200).json(result);
    } catch (err) {
        console.error('error in getPromptResponsesController:', err);
        return res.status(500).json({ error: 'failed to get prompt responses' });
    }
};
