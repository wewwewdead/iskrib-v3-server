import { asyncHandler } from "../utils/controllerHandler.js";
import { recordProfileVisitService } from "../services/profileVisitService.js";

export const recordProfileVisitController = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const result = await recordProfileVisitService(username, {
        visitorUserId: req.userId || null, // set by optionalAuth when logged in
        ip: req.ip,
        userAgent: req.headers["user-agent"],
    });
    return res.status(200).json(result);
});
