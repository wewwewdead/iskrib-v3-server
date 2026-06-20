import { asyncHandler } from "../utils/controllerHandler.js";
import { updateProfileThemeService } from "../services/profileThemeService.js";

export const updateProfileThemeController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { profileTheme } = req.body || {};

    const savedTheme = await updateProfileThemeService(userId, profileTheme);

    return res.status(200).json({ profileTheme: savedTheme });
});
