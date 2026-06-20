import { asyncHandler } from "../utils/controllerHandler.js";
import { getProfileActivitySummaryService } from "../services/profileActivitySummaryService.js";

export const getProfileActivitySummaryController = asyncHandler(async (req, res) => {
    const summary = await getProfileActivitySummaryService(req.userId);
    return res.status(200).json(summary);
});
