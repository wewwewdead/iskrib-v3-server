import { getCommentsService, getJournalsService, getUserJournalsService, getViewOpinionService, getVisitedUserJournalsService } from "../services/getService.js";


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
    const{limit = 5, before, userId} = req.query;

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