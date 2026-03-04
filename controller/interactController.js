import { addBookmarkService, addCommentService, addFollowsService, likeService, repostService, uploadOpinionReplyService } from "../services/interactService.js";

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
    const {comments, postId, receiverId, parentId} = req.body;
    const userId = req.userId;

    try {
        const response = await addCommentService(userId, comments, postId, receiverId, parentId);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to add comments'})
    }
}

export const addBookmarkController = async(req, res) =>{
    const userId = req.userId;
    const {journalId} = req.body;

    try {
        const response = await addBookmarkService(userId, journalId);
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
export const repostController = async(req, res) => {
    const {sourceJournalId, caption} = req.body;
    const userId = req.userId;

    try {
        const response = await repostService(sourceJournalId, caption, userId);
        return res.status(200).json(response);
    } catch (error) {
        const status = error?.status || 500;
        const message = error?.error || 'failed to create repost';
        return res.status(status).json({error: message});
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
