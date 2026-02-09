import { addBoorkmarkSetvice, addCommentService, addFollowsService, likeService, uploadOpinionReplyService } from "../services/interactService.js";

export const likeController = async(req, res) => {
    const {journalId, receiverId,} = req.body;
    const userId = req.userId;
    try {
        const response = await likeService(journalId, receiverId, userId);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to like or unlike'})
    }
}

export const addCommentController = async(req, res) =>{
    const {comments, postId, receiverId} = req.body;
    const userId = req.userId;

    try {
        const response = await addCommentService(userId, comments, postId, receiverId);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to add comments'})
    }
}

export const addBoorkmarkController = async(req, res) =>{
    const userId = req.userId;
    const {journalId} = req.body;

    try {
        const response = await addBoorkmarkSetvice(userId, journalId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json('Failed to add bookmarks')
    }
}

export const addOpinionReplyController = async(req, res) =>{
    const {parent_id} = req.params;
    const {opinion} = req.body;
    const userId = req.userId;

    try {
        const response = await uploadOpinionReplyService(parent_id, opinion, userId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to upload opinion reply'})
    }
}
export const addFollowController = async(req, res) => {
    const {followingId} = req.body;
    const followerId = req.userId;

    try {
        const response = await addFollowsService(followerId, followingId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to add or remove follow'})
    }
}
