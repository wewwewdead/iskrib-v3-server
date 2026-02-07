import e from "express";
import { uploadUserDataService, updateUserDataService, uploadBackgroundService, uploadJournalImageService, uploadJournalContentService, updateJournalService, addReplyOpinionService, uploadProfileNoteImageService } from "../services/uploadService.js";

export const uploadUserDataController = async(req, res) =>{
    const {bio, name} = req.body;
    const file = req.file;
    const token = req.headers.authorization?.split(' ')[1];

    try {
        await uploadUserDataService(bio, name, file, token)
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
        profileLayout,
        dominantColors,
        secondaryColors,
        fontColor,
        profile_font_color: profileFontColorFromBody,
        fontColors
    } = await req.body;
    const image = req.file;
    const token = req.headers.authorization?.split(' ')[1];
    const profileFontColor = profileFontColorFromBody || fontColor || fontColors;

    try {
        const data =  await updateUserDataService(
            name,
            bio,
            profileBg,
            profileLayout,
            dominantColors,
            secondaryColors,
            profileFontColor,
            token,
            image
        );
        return res.status(200).json({data: data});
    } catch (error) {
        console.error('error updating user data', error);
        return res.status(500).json({error: 'error updating user data'});
    }
}


export const uploadProfileBgController = async(req, res) =>{
    const {userId} = req.body;
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
    const token = req.headers.authorization?.split(' ')[1];

    const image = req.file;

    try {
        const image_url = await uploadJournalImageService(image, token);

        return res.status(200).json({img_url: image_url});
    } catch (error) {
        console.error(error);
        throw {status: 500, error: 'error uploading journal images'}
    }
}

export const uploadProfileNoteImageController = async(req, res) =>{
    const token = req.headers.authorization?.split(' ')[1];
    const image = req.file;

    try {
        const image_url = await uploadProfileNoteImageService(image, token);
        return res.status(200).json({img_url: image_url});
    } catch (error) {
        console.error(error);
        throw {status: 500, error: 'error uploading profile note images'}
    }
}

export const uploadJournalContentController = async(req, res) =>{
    const {content, title} = req.body;
    const token = req.headers.authorization?.split(' ')[1];
    try {
        await uploadJournalContentService(content, title, token);
        return res.status(200).json({message: 'Content saved successfully!'});
    } catch (error) {
        console.error('failed to upload content:', error);
        return res.status(500).json({error: 'failed to upload content!'})
    }
}

export const updateJournalController = async(req, res) =>{
    const {content, title, journalId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];

    try {
        await updateJournalService(content, title, journalId, token);
        return res.status(200).json({message: 'journal was updated successfuly'});
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'failed to update journal'})
    }
}

export const addReplyOpinionController = async(req, res) =>{
    const {reply} = req.body;
    const {parent_id} = req.params;
    const token = req.headers?.authorization.split(' ')[1];

    try {
        await addReplyOpinionService(reply, parent_id, token);
        return req.status(200).json({message: 'reply was updated successfuly'})
    } catch (error) {
        console.error(error)
        return res.status(500).json({error: 'failed to add reply'})
    }
}
