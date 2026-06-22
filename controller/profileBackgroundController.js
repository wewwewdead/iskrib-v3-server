import { processAnimatedBackgroundUpload } from "../services/profileBackgroundService.js";

/**
 * Upload + process an animated (GIF) profile background. Accepts the multer
 * `gif` (required) and optional `poster` fields and returns the
 * `animated_background` manifest the client stores in users.background and
 * renders with a dedicated <video> layer.
 */
export const uploadAnimatedBackgroundController = async (req, res) => {
    const userId = req.userId;
    const gifFile = req.files?.gif?.[0];
    const posterFile = req.files?.poster?.[0];

    try {
        const manifest = await processAnimatedBackgroundUpload(userId, gifFile, posterFile);
        return res.status(200).json(manifest);
    } catch (error) {
        console.error("error processing animated background", error);
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.error || "error processing background gif" });
    }
};
