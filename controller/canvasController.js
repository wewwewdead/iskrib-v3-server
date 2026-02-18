import {
    createCanvasRemixService
} from "../services/canvasService.js";

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
