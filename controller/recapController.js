import { getWeeklyRecapService } from '../services/recapService.js';

export const getWeeklyRecapController = async (req, res) => {
    try {
        const userId = req.userId;
        const recap = await getWeeklyRecapService(userId);
        return res.status(200).json({ recap });
    } catch (error) {
        console.error('getWeeklyRecapController error:', error);
        return res.status(500).json({ error: error.message || 'Failed to get weekly recap' });
    }
};
