import { getBookmarksService, getCommentsService, getJournalByIdService, getJournalsService, getMonthlyHottestJournalsService, getOpinionReplyService, getProfileMediaService, getUserJournalsService, getViewOpinionService, getVisitedUserJournalsService, searchJournalsService } from "../services/getService.js";


export const getJournalsController = async(req, res) =>{
    const {limit= 5, before, userId} = req.query;

    try {
        const journalData = await getJournalsService(limit, userId, before);
        return res.status(200).json(journalData);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to fetch journals'});
    }
}

export const getUserJournalsController = async(req, res) =>{
    const {limit = 5, before} = req.query;
    const userId = req.userId || req.query.userId;

    try {
        const data = await getUserJournalsService(limit, before, userId);

        return res.status(200).json(data);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to fetch user journals'})
    }
}

export const getVisitedUserJournalsController = async(req, res) =>{
    const {limit = 5, before, userId, loggedInUserId} = req.query;
    
    try {
        const data = await getVisitedUserJournalsService(limit, before, userId, loggedInUserId)
        return res.status(200).json(data);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to fetch user journals'});
    }
}

export const getViewOpinionController = async(req, res) =>{
    const {postId, userId} = req.params;

    try {
        const response = await getViewOpinionService(postId, userId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to fetch opinion'});
    }
}

export const getCommentsController = async(req, res) =>{
    const {postId, limit = 10, before} = req.query;

    try {
        const response = await getCommentsService(postId, limit, before);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to fetch comments'})
    }
}

export const getReplyOpinionsController = async(req, res) =>{
    const {parentId} = req.params;
    const {limit, cursor} = req.query;

    try {
        const response = await getOpinionReplyService(parentId, limit, cursor);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to fetch opinion replies'});
    }
}

export const getBookmarksController = async(req, res) =>{
    const {before, limit} = req.query;
    const userId = req.userId || req.query.userId;

    try {
        const response = await getBookmarksService(userId, before, limit);

        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'Failed to fetch bookmarks'})
    }
}

export const getJournalByIdController = async (req, res) => {
    const { journalId } = req.params;
    const { userId } = req.query;

    try {
        const journal = await getJournalByIdService(journalId, userId);
        if (!journal) {
            return res.status(404).json({ error: 'journal not found' });
        }
        return res.status(200).json({ journal });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'failed to fetch journal' });
    }
}

export const searchJournalsController = async(req, res) => {
    const {query = '', limit = 10, userId} = req.query;

    try {
        const response = await searchJournalsService(query, limit, userId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to search journals'});
    }
}

export const getMonthlyHottestJournalsController = async(req, res) => {
    const {limit = 10, userId} = req.query;

    try {
        const response = await getMonthlyHottestJournalsService(limit, userId);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to fetch monthly hottest journals'});
    }
}

export const getProfileMediaController = async(req, res) => {
    const userId = req.userId;
    const {limit = 5, cursor = null} = req.query;

    try {
        const response = await getProfileMediaService(userId, limit, cursor);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to fetch profile media'});
    }
}

export const getVisitedProfileMediaController = async(req, res) => {
    const {userId, limit = 5, cursor = null} = req.query;

    if(!userId){
        return res.status(400).json({error: 'userId is undefined'});
    }

    try {
        const response = await getProfileMediaService(userId, limit, cursor);
        return res.status(200).json(response);
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || 'failed to fetch visited profile media'});
    }
}
