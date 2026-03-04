import { asyncHandler } from "../utils/controllerHandler.js";
import {
    getNotificationsService,
    getCountNotificationsService,
    readNotificationService,
    deleteNotificationService,
    parseLimitWithinRange,
    NOTIFICATION_LIMIT_MIN,
    NOTIFICATION_LIMIT_MAX,
    NOTIFICATION_DEFAULT_LIMIT,
} from "../services/notificationService.js";

const parseLimitOrFail = (raw, res) => {
    const parsed = parseLimitWithinRange(raw, NOTIFICATION_LIMIT_MIN, NOTIFICATION_LIMIT_MAX, NOTIFICATION_DEFAULT_LIMIT);
    if (parsed == null) {
        res.status(400).json({ error: `limit must be between ${NOTIFICATION_LIMIT_MIN} and ${NOTIFICATION_LIMIT_MAX}` });
        return null;
    }
    return parsed;
};

export const getNotificationsController = asyncHandler(async (req, res) => {
    const limit = parseLimitOrFail(req.query.limit, res);
    if (limit == null) return;

    const result = await getNotificationsService(req.userId, {
        limit,
        before: req.query.before,
        unreadOnly: false,
    });
    return res.status(200).json(result);
});

export const getUnreadNotificationsController = asyncHandler(async (req, res) => {
    const limit = parseLimitOrFail(req.query.limit, res);
    if (limit == null) return;

    const result = await getNotificationsService(req.userId, {
        limit,
        before: req.query.before,
        unreadOnly: true,
    });
    return res.status(200).json(result);
});

export const getCountNotificationsController = asyncHandler(async (req, res) => {
    const result = await getCountNotificationsService(req.userId);
    return res.status(200).json(result);
});

export const readNotificationController = asyncHandler(async (req, res) => {
    const { notifId, source } = req.body;
    const result = await readNotificationService(req.userId, notifId, source);
    return res.status(200).json(result);
});

export const deleteNotificationController = asyncHandler(async (req, res) => {
    const { notifId } = req.params;
    const { source } = req.query;
    const result = await deleteNotificationService(req.userId, notifId, source);
    return res.status(200).json(result);
});
