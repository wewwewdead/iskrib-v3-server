import { asyncHandler } from '../utils/controllerHandler.js';
import { getWriterAnalyticsService } from '../services/analyticsService.js';

const VALID_RANGES = ['7d', '30d', '90d', 'all'];

export const getWriterAnalyticsController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const range = req.query.range || '30d';

    if (!VALID_RANGES.includes(range)) {
        return res.status(400).json({ error: 'Invalid range. Use 7d, 30d, 90d, or all' });
    }

    const analytics = await getWriterAnalyticsService(userId, range);
    return res.status(200).json({ analytics });
});
