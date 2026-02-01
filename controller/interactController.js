import { addBoorkmarkSetvice, addCommentService, likeService, uploadOpinionReplyService } from "../services/interactService.js";

export const likeController = async(req, res) => {
    const {journalId, receiverId,} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];
    try {
        const response = await likeService(journalId, receiverId, token);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to like or unlike'})
    }
}

export const addCommentController = async(req, res) =>{
    const {comments, postId, receiverId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];

    try {
        const response = await addCommentService(token, comments, postId, receiverId);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to add comments'})
    }
}

export const addBoorkmarkController = async(req, res) =>{
    const token = req.headers.authorization.split(' ')[1];
    const {journalId} = req.body;

    try {
        const response = await addBoorkmarkSetvice(token, journalId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json('Failed to add bookmarks')
    }
}

export const addOpinionReplyController = async(req, res) =>{
    const {parent_id, user_id, receiver_id} = req.params;
    const {opinion} = req.body;

    try {
        const response = await uploadOpinionReplyService(parent_id, opinion, user_id, receiver_id);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to upload opinion reply'})
    }
}