import { uploadUserDataService, updateUserDataService, uploadBackgroundService, uploadJournalImageService, uploadJournalContentService, updateJournalService, addReplyOpinionService } from "../services/uploadService.js";

export const uploadUserDataController = async(req, res) =>{
    const {bio, name} = req.body;
    const file = req.file;
    const userId = req.userId;
    const userEmail = req.authUser?.email;

    try {
        await uploadUserDataService(bio, name, file, userId, userEmail)
        return res.status(200).json({message: 'success'})
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'error upload user data'})
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
        return res.status(500).json({error: 'error updating user data'});
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
        throw {status: 500, error: 'error uploading journal images'}
    }
}

export const uploadJournalContentController = async(req, res) =>{
    const {
        content,
        title,
        post_type: postType,
        canvas_doc: canvasDoc,
        remix_source_journal_id: remixSourceJournalId,
        is_remix: isRemix
    } = req.body;
    const userId = req.userId;
    try {
        await uploadJournalContentService(content, title, userId, postType, canvasDoc, remixSourceJournalId, isRemix);
        return res.status(200).json({message: 'Content saved successfully!'});
    } catch (error) {
        console.error('failed to upload content:', error);
        return res.status(500).json({error: 'failed to upload content!'})
    }
}

export const updateJournalController = async(req, res) =>{
    const {content, title, journalId, post_type: postType, canvas_doc: canvasDoc} = req.body;
    const userId = req.userId;

    try {
        await updateJournalService(content, title, journalId, userId, postType, canvasDoc);
        return res.status(200).json({message: 'journal was updated successfuly'});
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to update journal'})
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
