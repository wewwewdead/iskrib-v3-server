import {
    createFreedomWallItemService,
    deleteFreedomWallItemService,
    getCurrentFreedomWallWeekService,
    getFreedomWallItemsService,
    getFreedomWallStickersService,
    updateFreedomWallItemService
} from "../services/freedomWallService.js";

export const getCurrentFreedomWallWeekController = async(_req, res) => {
    try {
        const response = await getCurrentFreedomWallWeekService();
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to fetch active freedom wall week"});
    }
};

export const getFreedomWallItemsController = async(req, res) => {
    const {weekId} = req.params;
    const {limit = 200, cursor = null, types = ""} = req.query;

    try {
        const response = await getFreedomWallItemsService(weekId, limit, cursor, types);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to fetch freedom wall items"});
    }
};

export const createFreedomWallItemController = async(req, res) => {
    const {weekId, itemType, payload, zIndex = 0} = req.body || {};
    const userId = req.userId;

    try {
        const response = await createFreedomWallItemService({
            weekId: weekId,
            itemType: itemType,
            payload: payload,
            zIndex: zIndex,
            userId: userId
        });
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to create freedom wall item"});
    }
};

export const updateFreedomWallItemController = async(req, res) => {
    const {itemId} = req.params;
    const {payload, zIndex} = req.body || {};
    const userId = req.userId;

    try {
        const response = await updateFreedomWallItemService({
            itemId: itemId,
            payload: payload,
            zIndex: zIndex,
            userId: userId
        });
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to update freedom wall item"});
    }
};

export const deleteFreedomWallItemController = async(req, res) => {
    const {itemId} = req.params;
    const userId = req.userId;

    try {
        const response = await deleteFreedomWallItemService({
            itemId: itemId,
            userId: userId
        });
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to delete freedom wall item"});
    }
};

export const getFreedomWallStickersController = async(_req, res) => {
    try {
        const response = await getFreedomWallStickersService();
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to fetch freedom wall stickers"});
    }
};
