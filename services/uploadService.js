import sharp from "sharp";
import { imageUploader } from "../routes/routes.js";
import supabase from "./supabase.js";
import ParseContent from "../utils/parseData.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

const POST_TYPE_TEXT = 'text';
const POST_TYPE_CANVAS = 'canvas';

const normalizePostType = (postType) => {
    if(typeof postType !== 'string'){
        return POST_TYPE_TEXT;
    }

    const normalized = postType.trim().toLowerCase();
    return normalized === POST_TYPE_CANVAS ? POST_TYPE_CANVAS : POST_TYPE_TEXT;
}

const parseCanvasDocInput = (canvasDoc) => {
    if(!canvasDoc){
        return null;
    }

    const parsedCanvasDoc = typeof canvasDoc === 'string' ? JSON.parse(canvasDoc) : canvasDoc;
    if(!parsedCanvasDoc || typeof parsedCanvasDoc !== 'object'){
        throw new Error('canvas_doc should be a valid object');
    }

    if(!Array.isArray(parsedCanvasDoc.snippets)){
        throw new Error('canvas_doc.snippets should be an array');
    }

    return parsedCanvasDoc;
}

const extractCanvasPlainText = (canvasDoc) => {
    if(!canvasDoc || !Array.isArray(canvasDoc.snippets)){
        return '';
    }

    return canvasDoc.snippets
        .map((snippet) => (typeof snippet?.text === 'string' ? snippet.text.trim() : ''))
        .filter(Boolean)
        .join(' ');
}

const parseTextContentSafely = (content) => {
    if(typeof content !== 'string' || !content.trim()){
        return null;
    }

    const parsedData = ParseContent(content);
    if(!parsedData || typeof parsedData !== 'object'){
        return null;
    }

    return parsedData;
}

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

export const uploadJournalContentService = async(
    content,
    title,
    userId,
    postType = POST_TYPE_TEXT,
    canvasDocInput = null,
    remixSourceJournalId = null,
    isRemix = false
) =>{
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'};
    }

    const resolvedPostType = normalizePostType(postType);
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';

    if(!trimmedTitle){
        console.error('title is missing!');
        throw {status: 400, error: 'title is missing!'};
    }

    let embeddingBody = '';
    const shouldSaveRemixMetadata = Boolean(
        remixSourceJournalId
        && typeof remixSourceJournalId === 'string'
        && remixSourceJournalId.trim()
    );
    const normalizedIsRemix = shouldSaveRemixMetadata || String(isRemix).toLowerCase() === 'true';
    let payload = {
        user_id: userId,
        title: trimmedTitle,
        post_type: resolvedPostType
    };

    if(resolvedPostType === POST_TYPE_CANVAS){
        let parsedCanvasDoc = null;
        try {
            parsedCanvasDoc = parseCanvasDocInput(canvasDocInput);
        } catch (error) {
            console.error('invalid canvas doc on insert:', error?.message || error);
            throw {status: 400, error: 'invalid canvas_doc'};
        }

        if(!parsedCanvasDoc){
            console.error('canvas_doc is missing for canvas post');
            throw {status: 400, error: 'canvas_doc is missing'};
        }

        embeddingBody = extractCanvasPlainText(parsedCanvasDoc);
        payload = {
            ...payload,
            content: null,
            canvas_doc: parsedCanvasDoc
        };
    } else {
        if(!content){
            console.error('content is missing for text post!');
            throw {status: 400, error: 'content is missing for text post'};
        }

        const parseData = parseTextContentSafely(content);
        if(!parseData){
            console.error('error while parsing text content data');
            throw {status: 400, error: 'error while parsing text content data'};
        }

        embeddingBody = parseData.wholeText || '';
        payload = {
            ...payload,
            content: content,
            canvas_doc: null
        };
    }

    const embeddingResult = await GenerateEmbeddings(trimmedTitle, embeddingBody);

    if(!embeddingResult || !Array.isArray(embeddingResult) || embeddingResult.length === 0){
        console.error('error while generating embeddings on a post!');
        throw {status: 400, error: 'error while generating embeddings on a post!'};
    }

    const insertPayload = {
        ...payload,
        embeddings: embeddingResult
    };

    if(normalizedIsRemix){
        insertPayload.is_remix = true;
    }
    if(shouldSaveRemixMetadata){
        insertPayload.remix_source_journal_id = remixSourceJournalId.trim();
    }

    let {error} = await supabase
    .from('journals')
    .insert(insertPayload);

    if(error){
        const missingRemixColumns = error?.message?.includes('is_remix') || error?.message?.includes('remix_source_journal_id');
        if(missingRemixColumns){
            const fallbackPayload = {
                ...payload,
                embeddings: embeddingResult
            };

            const retry = await supabase
            .from('journals')
            .insert(fallbackPayload);
            error = retry.error;
        }
    }

    if(error){
        console.error('supabase error while uploading content:',error.message);
        throw {status: 500, error: 'supabase error while uploading content'};
    }
    return true;
}

export const updateJournalService = async(content, title, journalId, userId, postType = null, canvasDocInput = null) => {
    if(!journalId){
        console.error('journalid is undefined');
        throw {status: 400, error: 'journalId is undefined'}
    }

    if(!userId){
        console.error('userId is undefined')
        throw({status: 400, error: 'userId is undefined'})
    }

    const resolvedRequestedPostType = postType ? normalizePostType(postType) : null;

    const {data: existingJournal, error: existingJournalError} = await supabase
    .from('journals')
    .select('id, user_id, content, title, post_type, canvas_doc')
    .eq('id', journalId)
    .eq('user_id', userId)
    .maybeSingle();

    if(existingJournalError){
        console.error('failed to fetch existing journal for update', existingJournalError.message);
        throw {status: 500, error: 'failed to fetch existing journal for update'};
    }

    if(!existingJournal){
        console.error('journal not found for update');
        throw {status: 404, error: 'journal not found for update'};
    }

    const resolvedPostType = resolvedRequestedPostType || normalizePostType(existingJournal.post_type);
    const resolvedTitle = typeof title === 'string' && title.trim() ? title.trim() : existingJournal.title;
    if(!resolvedTitle){
        console.error('title is undefined');
        throw {status: 400, error: 'title is undefined'};
    }

    let resolvedContent = existingJournal.content;
    let resolvedCanvasDoc = existingJournal.canvas_doc;
    let embeddingBody = '';

    if(resolvedPostType === POST_TYPE_CANVAS){
        if(canvasDocInput){
            try {
                resolvedCanvasDoc = parseCanvasDocInput(canvasDocInput);
            } catch (error) {
                console.error('invalid canvas doc on update:', error?.message || error);
                throw {status: 400, error: 'invalid canvas_doc'};
            }
        }

        if(!resolvedCanvasDoc){
            console.error('canvas_doc is missing for canvas post update');
            throw {status: 400, error: 'canvas_doc is missing for canvas post update'};
        }

        resolvedContent = null;
        embeddingBody = extractCanvasPlainText(resolvedCanvasDoc);
    } else {
        if(typeof content === 'string' && content.trim()){
            resolvedContent = content;
        }

        if(!resolvedContent){
            console.error('text content is missing for text post update');
            throw {status: 400, error: 'text content is missing for text post update'};
        }

        const parseData = parseTextContentSafely(resolvedContent);
        if(!parseData){
            console.error('failed to parse text content for update');
            throw {status: 400, error: 'failed to parse text content for update'};
        }

        resolvedCanvasDoc = null;
        embeddingBody = parseData.wholeText || '';
    }

    const embeddings = await GenerateEmbeddings(resolvedTitle, embeddingBody);

    const embeddingResult = embeddings;
    if(!embeddingResult || !Array.isArray(embeddingResult) || embeddingResult.length === 0){
        console.error('failed to generate embeddings')
        throw {status: 400, error: 'failed to generate embeddings'};
    }

    const journalData = {
        content: resolvedContent,
        title: resolvedTitle,
        post_type: resolvedPostType,
        canvas_doc: resolvedCanvasDoc,
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
