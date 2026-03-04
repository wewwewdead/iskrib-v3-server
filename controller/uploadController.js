import { uploadUserDataService, updateUserDataService, uploadBackgroundService, uploadJournalImageService, uploadJournalContentService, updateJournalService, addReplyOpinionService, updateRepostCaptionService, completeOnboardingService, updateInterestsService, saveDraftService, publishDraftService } from "../services/uploadService.js";

export const uploadUserDataController = async(req, res) =>{
    const {bio, name, username} = req.body;
    const file = req.file;
    const userId = req.userId;
    const userEmail = req.authUser?.email;

    try {
        await uploadUserDataService(bio, name, file, userId, userEmail, username)
        return res.status(200).json({message: 'success'})
    } catch (error) {
        console.error(error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'error upload user data'})
    }
}

export const updateUserDataController = async(req, res) =>{
    const {
        name,
        bio,
        profileBg,
        dominantColors,
        secondaryColors,
        fontColor,
        profile_font_color: profileFontColorFromBody,
        fontColors
    } = await req.body;
    const image = req.file;
    const userId = req.userId;
    const profileFontColor = profileFontColorFromBody || fontColor || fontColors;

    try {
        const data =  await updateUserDataService(
            name,
            bio,
            profileBg,
            dominantColors,
            secondaryColors,
            profileFontColor,
            userId,
            image
        );
        return res.status(200).json({data: data});
    } catch (error) {
        console.error('error updating user data', error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'error updating user data'});
    }
}


export const uploadProfileBgController = async(req, res) =>{
    const userId = req.userId || req.body?.userId;
    const file = req.file;

    try {
        const image_url = await uploadBackgroundService(userId, file);
        return res.status(200).json({data: image_url});
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'error while uploading background image'});
    }
}

export const uploadJournalImageController = async(req, res) =>{
    const userId = req.userId;
    const image = req.file;

    try {
        const image_url = await uploadJournalImageService(image, userId);

        return res.status(200).json({img_url: image_url});
    } catch (error) {
        console.error(error);
        return res.status(error?.status || 500).json({error: error?.error || 'error uploading journal images'});
    }
}

export const uploadJournalContentController = async(req, res) =>{
    const {
        content,
        title,
        remix_source_journal_id: remixSourceJournalId,
        is_remix: isRemix,
        prompt_id: promptId
    } = req.body;
    const userId = req.userId;
    try {
        const result = await uploadJournalContentService(content, title, userId, remixSourceJournalId, isRemix, promptId);
        const responsePayload = { message: 'Content saved successfully!' };
        if (result?.streakResult?.streakData) {
            responsePayload.streak = {
                current_streak: result.streakResult.streakData.current_streak,
            };
        }
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error('failed to upload content:', error);
        return res.status(500).json({error: 'failed to upload content!'})
    }
}

export const updateJournalController = async(req, res) =>{
    const {content, title, journalId} = req.body;
    const userId = req.userId;

    try {
        await updateJournalService(content, title, journalId, userId);
        return res.status(200).json({message: 'journal was updated successfuly'});
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to update journal'})
    }
}

export const updateRepostCaptionController = async(req, res) => {
    const {journalId, caption} = req.body;
    const userId = req.userId;

    try {
        await updateRepostCaptionService(journalId, userId, caption);
        return res.status(200).json({message: 'repost caption updated successfully'});
    } catch (error) {
        console.error('failed to update repost caption:', error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'failed to update repost caption'});
    }
}

export const completeOnboardingController = async(req, res) => {
    const userId = req.userId;
    const {writingInterests, writingGoal} = req.body;

    try {
        await completeOnboardingService(userId, writingInterests, writingGoal);
        return res.status(200).json({message: 'onboarding completed'});
    } catch (error) {
        console.error('failed to complete onboarding:', error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'failed to complete onboarding'});
    }
}

export const updateInterestsController = async(req, res) => {
    const userId = req.userId;
    const {writingInterests, writingGoal} = req.body;

    try {
        await updateInterestsService(userId, writingInterests, writingGoal);
        return res.status(200).json({message: 'interests updated'});
    } catch (error) {
        console.error('failed to update interests:', error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'failed to update interests'});
    }
}

export const saveDraftController = async(req, res) => {
    const {content, title, draftId, prompt_id: promptId} = req.body;
    const userId = req.userId;

    try {
        const result = await saveDraftService(content, title, userId, draftId, promptId);
        return res.status(200).json(result);
    } catch (error) {
        console.error('failed to save draft:', error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'failed to save draft'});
    }
}

export const publishDraftController = async(req, res) => {
    const {journalId} = req.body;
    const userId = req.userId;

    try {
        const result = await publishDraftService(journalId, userId);
        const responsePayload = {message: 'Draft published successfully!'};
        if(result?.streakResult?.streakData){
            responsePayload.streak = {
                current_streak: result.streakResult.streakData.current_streak,
            };
        }
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error('failed to publish draft:', error);
        const status = error?.status || 500;
        return res.status(status).json({error: error?.error || 'failed to publish draft'});
    }
}

export const addReplyOpinionController = async(req, res) =>{
    const {reply} = req.body;
    const {parent_id} = req.params;
    const userId = req.userId;

    try {
        await addReplyOpinionService(reply, parent_id, userId);
        return res.status(200).json({message: 'reply was updated successfuly'})
    } catch (error) {
        console.error(error)
        return res.status(500).json({error: 'failed to add reply'})
    }
}
