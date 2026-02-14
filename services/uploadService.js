import sharp from "sharp";
import { imageUploader } from "../routes/routes.js";
import supabase from "./supabase.js";
import ParseContent from "../utils/parseData.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

export const uploadUserDataService = async(bio, name, image, userId, userEmail) =>{
    if(!userId){
        throw {staus: 400, error: 'userId is undefined'};
    }
    if(!name || typeof name !== 'string' || name.length > 20){
        throw {status: 400, error: 'name should be a string and not more than 20 characters'}
    }
    if(!bio || typeof bio !== 'string' || bio.length > 150){
        throw {status: 400, error: 'bio should be a string and not more than 150 characters'}
    }

    let publicUrl = null;
    if(image){
        const dataUrl = await imageUploader(image, userId, 'avatars');

        publicUrl = dataUrl;
    }

    const data = {
        bio: bio,
        name: name,
        id: userId,
        user_email: userEmail || null,
        image_url: publicUrl ? publicUrl : null
    }
    const {data: uploadData, error:errorUploadData} = await supabase
    .from('users')
    .insert([data])

    if(errorUploadData){
        console.error('supabase error:', errorUploadData.message);
        throw {status:500, error:'supabase error while uploading data'}
    }

    return true;
}

export const updateUserDataService = async(name, bio, profileBg, dominantColors, secondaryColors, profileFontColor, userId, image) =>{
    if(!userId){
        console.error('userId is undefined')
        throw {status: 400, error:'userId is undefined'}
    }
    if(!name || typeof name !== 'string' || name.length > 20){
        console.error('error: name should be string and not more than 20 characters')
        throw {status: 400, error: 'error: name should be string and not more than 20 characters'};
    }
    if(!bio || typeof bio !== 'string' || bio.length > 150){
        console.error('error: bio should be a string and not more than 150 characters')
        throw {status: 400, error: 'error: bio should be a string and not more than 150 characters'}
    }

    const parsedProfileBg = JSON.parse(profileBg);
    const payload = {
        name: name,
        bio: bio,
        background: parsedProfileBg,
        dominant_colors: dominantColors, 
        secondary_colors: secondaryColors
    }

    if(profileFontColor){
        payload.profile_font_color = profileFontColor;
    }

    if(image){
        const image_url = await imageUploader(image, userId, 'avatars');
        payload.image_url = image_url;
    }

    const {data: uploadData, error: errorUploadData} = await supabase
    .from('users')
    .update(payload)
    .eq('id', userId);

    if(errorUploadData){
        console.error('supabase error:', errorUploadData.message);
        throw{status: 500, error: 'supabase error while uploading data'}
    }

    const data = uploadData;
    return data;
}

export const uploadBackgroundService = async(userId, image) => {
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'};
    }

    if(!image){
        console.error('image file is null');
        throw {status: 400, error: 'image file is null'};
    }

    const image_url = await imageUploader(image, userId, 'background');
    if(image_url){
        return image_url;
    } else {
        console.error('error while uploading the image');
        throw {status: 500, error: 'error while uploading the image'};
    }
}

export const uploadJournalImageService = async(image, userId) =>{
    if(!userId){
        console.error('userId is undefined');
        throw{status: 400, error: 'userId is undefined'};
    }
    if(!image){
        console.error('file image is null');
        throw {status: 400, error: 'file image is undefined'};
    }

    let image_buffer = await sharp(image.buffer)
    .rotate()
    .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
    .webp({quality: 80, effort: 4})
    .toBuffer()

    const data_url = await imageUploader(image_buffer, userId, 'journal-images');

    if(data_url){
        return data_url;
    } else{
        console.error('error while uploading journal images');
        throw {statu: 500, error: 'error while uploading journal images'};
    }
}

export const uploadJournalContentService = async(content, title, userId) =>{
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'};
    }

    if(!title || !content){
        console.error('content or title is missing!');
        throw {status: 400, error: 'content or title is missing!'};
    }

    const parseData = ParseContent(content);

    if(!parseData){
        console.error('error while parsing content data');
        throw{status: 400, error: 'error while parsing content data'};
    }

    const embeddingResult = await GenerateEmbeddings(title, parseData.wholeText);

    if(!embeddingResult || !Array.isArray(embeddingResult) || embeddingResult.length === 0){
        console.error('error while generating embeddings on a post!');
        throw {status: 400, error: 'error while generating embeddings on a post!'};
    }

    const {data, error} = await supabase
    .from('journals')
    .insert({user_id: userId, content: content, title: title, embeddings: embeddingResult});

    if(error){
        console.error('supabase error while uploading content:',error.message);
        throw {status: 500, error: 'supabase error while uploading content'};
    }
    return true;
}

export const updateJournalService = async(content, title, journalId, userId) => {
    if(!content && !title){
        console.error('content or title is undefined')
        throw {status: 400, error: 'content or title is undefined'};
    }
    if(!journalId){
        console.error('journalid is undefined');
        throw {status: 400, error: 'journalId is undefined'}
    }

    if(!userId){
        console.error('userId is undefined')
        throw({status: 400, error: 'userId is undefined'})
    }

    const parseData = ParseContent(content);

    if(!parseData){
        console.error('failed to parse content');
        throw{status: 400, error: 'failed to parse content'}
    }

    const embeddings = await GenerateEmbeddings(title, parseData.wholeText);

    const embeddingResult = embeddings;
    if(!embeddingResult || !Array.isArray(embeddingResult) || embeddingResult.length === 0){
        console.error('failed to generate embeddings')
        throw {status: 400, error: 'failed to generate embeddings'};
    }

    const journalData = {
        content: content,
        title: title,
        embeddings: embeddings
    }

    const {data, error} = await supabase
    .from('journals')
    .update(journalData)
    .eq('id', journalId)
    .eq('user_id', userId)

    if(error){
        console.error('supabase error while uploading content:', error.message);
        throw{status: 500, error: 'supabase error while uploading content'};
    }

    return true;
}

export const addReplyOpinionService = async(reply, parentId, userId) => {
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'};
    }
    if(!reply || typeof(reply) !== 'string'){
        console.error('reply should be a string');
        throw {status: 400, error: 'reply should be a string'}
    }

    const {data ,error} = await supabase
    .from('opinions')
    .insert({user_id: userId, opinion: reply, parent_id: parentId})

    if(error){
        console.error('supabase error while inserting reply opinion', error.message);
        throw {status: 500, error: 'supabase error'}
    }

    return true;
}
