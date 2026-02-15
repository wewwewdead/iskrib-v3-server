import {
    addCanvasMarginService,
    addCanvasStampService,
    createCanvasRemixService,
    deleteCanvasMarginService,
    deleteCanvasStampService,
    getCanvasMarginsService,
    getCanvasStampsService
} from "../services/canvasService.js";

export const addCanvasStampController = async(req, res) => {
    const userId = req.userId;
    const {journalId, snippetId, wordKey, stampType, x, y} = req.body;

    try {
        const stamp = await addCanvasStampService({
            journalId: journalId,
            userId: userId,
            snippetId: snippetId,
            wordKey: wordKey,
            stampType: stampType,
            x: x,
            y: y
        });

        return res.status(200).json({stamp: stamp});
    } catch (error) {
        console.error('failed to add canvas stamp:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to add canvas stamp'});
    }
}

export const getCanvasStampsController = async(req, res) => {
    const {journalId} = req.query;
    const userId = req.userId || null;

    try {
        const stamps = await getCanvasStampsService(journalId, userId);
        return res.status(200).json({stamps: stamps});
    } catch (error) {
        console.error('failed to fetch canvas stamps:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to fetch canvas stamps'});
    }
}

export const deleteCanvasStampController = async(req, res) => {
    const {stampId} = req.params;
    const userId = req.userId;

    try {
        const response = await deleteCanvasStampService(stampId, userId);
        return res.status(200).json(response);
    } catch (error) {
        console.error('failed to delete canvas stamp:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to delete canvas stamp'});
    }
}

export const createCanvasRemixController = async(req, res) => {
    const userId = req.userId;
    const {sourceJournalId, titleOverride} = req.body;

    try {
        const remix = await createCanvasRemixService({
            sourceJournalId: sourceJournalId,
            userId: userId,
            titleOverride: titleOverride
        });
        return res.status(200).json(remix);
    } catch (error) {
        console.error('failed to create canvas remix:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to create canvas remix'});
    }
}

export const getCanvasMarginsController = async(req, res) => {
    const {journalId} = req.query;
    const userId = req.userId || null;

    try {
        const items = await getCanvasMarginsService(journalId, userId);
        return res.status(200).json({items: items});
    } catch (error) {
        console.error('failed to fetch canvas margin items:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to fetch canvas margin items'});
    }
}

export const addCanvasMarginController = async(req, res) => {
    const userId = req.userId;
    const {journalId, itemType, payload} = req.body;

    try {
        const item = await addCanvasMarginService({
            journalId: journalId,
            userId: userId,
            itemType: itemType,
            payload: payload
        });
        return res.status(200).json({item: item});
    } catch (error) {
        console.error('failed to add canvas margin item:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to add canvas margin item'});
    }
}

export const deleteCanvasMarginController = async(req, res) => {
    const {marginId} = req.params;
    const userId = req.userId;

    try {
        const result = await deleteCanvasMarginService(marginId, userId);
        return res.status(200).json(result);
    } catch (error) {
        console.error('failed to delete canvas margin item:', error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to delete canvas margin item'});
    }
}
