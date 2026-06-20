import { asyncHandler } from "../utils/controllerHandler.js";
import { remixProfileThemeService } from "../services/profileThemeRemixService.js";

export const remixProfileThemeController = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const result = await remixProfileThemeService(username, req.userId);
    return res.status(200).json(result);
});
