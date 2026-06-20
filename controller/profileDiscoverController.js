import { asyncHandler } from "../utils/controllerHandler.js";
import { getProfileDiscoverService } from "../services/profileDiscoverService.js";

export const getProfileDiscoverController = asyncHandler(async (_req, res) => {
    const sections = await getProfileDiscoverService();
    return res.status(200).json(sections);
});
