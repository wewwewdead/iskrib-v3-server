import { deleteJournalContentService, deleteJournalImageService, deleteProfileMediaImageService } from "../services/deleteService.js";

export const deleteJournalImageController = async(req, res) =>{
    const userId = req.userId;
    const {filepath} = req.body;

    try {
        await deleteJournalImageService(userId, filepath);
        return res.status(200).json({message: 'Image deleted succesfully'})
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to delete image'})
    }

}

export const deleteJournalContent = async(req, res) =>{
    const {journalId} = req.params;
    const userId = req.userId;

    try {
        await deleteJournalContentService(journalId, userId);
        return res.status(200).json({message:'success'});
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to delete content'})
    }
}

export const deleteProfileMediaImageController = async(req, res) => {
    const userId = req.userId;
    const {bucket, path, url} = req.body || {};

    try {
        const response = await deleteProfileMediaImageService(userId, bucket, path, url);
        return res.status(200).json({
            message: "media image deleted successfully",
            ...response
        });
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || "failed to delete media image"});
    }
};
