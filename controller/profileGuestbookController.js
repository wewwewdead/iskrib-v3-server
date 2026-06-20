import { asyncHandler } from "../utils/controllerHandler.js";
import {
    getProfileGuestbookService,
    createGuestbookEntryService,
    deleteGuestbookEntryService,
} from "../services/profileGuestbookService.js";

export const getProfileGuestbookController = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const { limit, before } = req.query;
    const result = await getProfileGuestbookService(username, { limit, before });
    return res.status(200).json(result);
});

export const createGuestbookEntryController = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const { message } = req.body || {};
    const entry = await createGuestbookEntryService(username, req.userId, message);
    return res.status(201).json({ entry });
});

export const deleteGuestbookEntryController = asyncHandler(async (req, res) => {
    const { entryId } = req.params;
    const result = await deleteGuestbookEntryService(entryId, req.userId);
    return res.status(200).json(result);
});
