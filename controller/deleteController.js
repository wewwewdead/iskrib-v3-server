import { deleteJournalContentService, deleteJournalImageService } from "../services/deleteService.js";

export const deleteJournalImageController = async(req, res) =>{
    const token = req.headers.authorization?.split(' ')[1];

    const {filepath} = req.body;

    try {
        await deleteJournalImageService(token, filepath);
        return res.status(200).json({message: 'Image deleted succesfully'})
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to delete image'})
    }

}

export const deleteJournalContent = async(req, res) =>{
    const {journalId} = req.params;
    const token = req.headers?.authorization?.split(' ')[1];

    try {
        await deleteJournalContentService(journalId, token);
        return res.status(200).json({message:'success'});
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to delete content'})
    }
}
