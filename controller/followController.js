import supabase from "../services/supabase.js";
import { asyncHandler } from "../utils/controllerHandler.js";
import { isValidUuid } from "../utils/validation.js";

export const getFollowsDataController = asyncHandler(async (req, res) => {
    const { userId } = req.query;
    const loggedInUserId = req.userId || null;

    if (!userId || !isValidUuid(userId)) {
        return res.status(400).json({ error: 'valid userId is required' });
    }

    const { data, error } = await supabase.rpc('get_follow_data', {
        p_user_id: userId,
        p_logged_in_user_id: (loggedInUserId && isValidUuid(loggedInUserId)) ? loggedInUserId : null,
    });

    if (error) {
        console.error('get_follow_data rpc error:', error.message);
        return res.status(500).json({ error: 'failed to fetch data' });
    }

    return res.status(200).json(data);
});
