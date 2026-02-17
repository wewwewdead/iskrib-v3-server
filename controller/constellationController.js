import {
    requestConstellationService,
    respondConstellationService,
    getViewportConstellationsService,
    deleteConstellationService,
} from "../services/constellationService.js";

export const requestConstellationController = async (req, res) => {
    const { starIdA, starIdB, label } = req.body;
    const userId = req.userId;

    try {
        const response = await requestConstellationService(userId, starIdA, starIdB, label);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.error || 'failed to request constellation' });
    }
};

export const respondConstellationController = async (req, res) => {
    const { constellationId, accept } = req.body;
    const userId = req.userId;

    try {
        const response = await respondConstellationService(userId, constellationId, accept);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.error || 'failed to respond to constellation' });
    }
};

export const getViewportConstellationsController = async (req, res) => {
    const { postIds } = req.query;

    try {
        let ids = [];
        if (typeof postIds === 'string') {
            ids = postIds.split(',').map(id => id.trim()).filter(Boolean);
        } else if (Array.isArray(postIds)) {
            ids = postIds;
        }

        const data = await getViewportConstellationsService(ids);
        return res.status(200).json({ data });
    } catch (error) {
        console.error(error);
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.error || 'failed to fetch constellations' });
    }
};

export const deleteConstellationController = async (req, res) => {
    const { id } = req.params;
    const userId = req.userId;

    try {
        const response = await deleteConstellationService(userId, id);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.error || 'failed to delete constellation' });
    }
};
