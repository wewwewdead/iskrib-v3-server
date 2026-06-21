import { asyncHandler } from "../utils/controllerHandler.js";
import { getProfilePreviewService } from "../services/profilePreviewService.js";

// Public, lightweight grouped content preview for a profile's layout home (V3B).
export const getProfilePreviewController = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const preview = await getProfilePreviewService(username);
    return res.status(200).json(preview);
});
