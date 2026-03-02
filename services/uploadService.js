import sharp from "sharp";
import { imageUploader } from "../routes/routes.js";
import supabase from "./supabase.js";
import ParseContent from "../utils/parseData.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";
import { extractMentionUserIds } from "../utils/extractMentions.js";
import { updateUserInterestsEmbedding } from "./interestEmbeddingService.js";

const POST_TYPE_TEXT = 'text';

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

export const uploadUserDataService = async(bio, name, image, userId, userEmail, username) =>{
    if(!userId){
        throw {status: 400, error: 'userId is undefined'};
    }
    if(!name || typeof name !== 'string' || name.length > 20){
        throw {status: 400, error: 'name should be a string and not more than 20 characters'}
    }
    if(!bio || typeof bio !== 'string' || bio.length > 150){
        throw {status: 400, error: 'bio should be a string and not more than 150 characters'}
    }

    // Validate username if provided
    let validatedUsername = null;
    if(username && typeof username === 'string'){
        const trimmed = username.trim().toLowerCase();
        if(trimmed.length < 3 || trimmed.length > 50){
            throw {status: 400, error: 'username must be 3-50 characters'};
        }
        if(!/^[a-z0-9-]+$/.test(trimmed)){
            throw {status: 400, error: 'username can only contain lowercase letters, numbers, and hyphens'};
        }
        // Check uniqueness
        const {data: existing} = await supabase
            .from('users')
            .select('id')
            .ilike('username', trimmed)
            .limit(1);
        if(existing && existing.length > 0){
            throw {status: 409, error: 'username is already taken'};
        }
        validatedUsername = trimmed;
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

    if(validatedUsername){
        data.username = validatedUsername;
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

export const completeOnboardingService = async(userId, writingInterests, writingGoal) => {
    if(!userId){
        throw {status: 400, error: 'userId is undefined'};
    }

    const payload = {
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
    };

    if(Array.isArray(writingInterests)){
        payload.writing_interests = writingInterests.filter(i => typeof i === 'string').slice(0, 16);
    }
    if(writingGoal && typeof writingGoal === 'string'){
        payload.writing_goal = writingGoal;
    }

    const {error} = await supabase
        .from('users')
        .update(payload)
        .eq('id', userId);

    if(error){
        console.error('supabase error completing onboarding:', error.message);
        throw {status: 500, error: 'failed to complete onboarding'};
    }

    // Fire-and-forget: generate interests embedding for personalized feed
    if(Array.isArray(writingInterests) && writingInterests.length > 0){
        updateUserInterestsEmbedding(userId, writingInterests)
            .catch(err => console.error('non-blocking interests embedding error:', err?.message || err));
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

    const parsedProfileBg = profileBg ? JSON.parse(profileBg) : undefined;
    const payload = {
        name: name,
        bio: bio,
    }

    if(parsedProfileBg !== undefined){
        payload.background = parsedProfileBg;
    }
    if(dominantColors){
        payload.dominant_colors = dominantColors;
    }
    if(secondaryColors){
        payload.secondary_colors = secondaryColors;
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
    remixSourceJournalId = null,
    isRemix = false,
    promptId = null
) =>{
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'};
    }

    const trimmedTitle = typeof title === 'string' ? title.trim() : '';

    if(!trimmedTitle){
        console.error('title is missing!');
        throw {status: 400, error: 'title is missing!'};
    }

    const shouldSaveRemixMetadata = Boolean(
        remixSourceJournalId
        && typeof remixSourceJournalId === 'string'
        && remixSourceJournalId.trim()
    );
    const normalizedIsRemix = shouldSaveRemixMetadata || String(isRemix).toLowerCase() === 'true';

    if(!content){
        console.error('content is missing for text post!');
        throw {status: 400, error: 'content is missing for text post'};
    }

    const parseData = parseTextContentSafely(content);
    if(!parseData){
        console.error('error while parsing text content data');
        throw {status: 400, error: 'error while parsing text content data'};
    }

    const embeddingBody = parseData.wholeText || '';
    const payload = {
        user_id: userId,
        title: trimmedTitle,
        post_type: POST_TYPE_TEXT,
        content: content,
    };

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
    if(promptId){
        const parsedPromptId = parseInt(promptId, 10);
        if(!isNaN(parsedPromptId)){
            insertPayload.prompt_id = parsedPromptId;
        }
    }

    let insertResult = await supabase
    .from('journals')
    .insert(insertPayload)
    .select('id')
    .single();

    let error = insertResult.error;

    if(error){
        const missingRemixColumns = error?.message?.includes('is_remix') || error?.message?.includes('remix_source_journal_id');
        if(missingRemixColumns){
            const fallbackPayload = {
                ...payload,
                embeddings: embeddingResult
            };

            insertResult = await supabase
            .from('journals')
            .insert(fallbackPayload)
            .select('id')
            .single();
            error = insertResult.error;
        }
    }

    if(error){
        console.error('supabase error while uploading content:',error.message);
        throw {status: 500, error: 'supabase error while uploading content'};
    }

    const journalId = insertResult.data?.id;

    // Non-fatal: send mention notifications
    if(journalId){
        try {
            const mentionedUserIds = extractMentionUserIds(content);
            const filtered = mentionedUserIds
                .filter(id => id !== userId)
                .slice(0, 50);

            if(filtered.length > 0){
                const notifRows = filtered.map(receiverId => ({
                    sender_id: userId,
                    receiver_id: receiverId,
                    type: 'mention',
                    journal_id: journalId,
                    read: false
                }));

                const {error: notifError} = await supabase
                    .from('notifications')
                    .insert(notifRows);

                if(notifError){
                    console.error('[mentions] new post: insert failed:', notifError.message);
                }
            }
        } catch (mentionErr) {
            console.error('[mentions] new post error:', mentionErr?.message || mentionErr);
        }
    }

    // Non-fatal: record publish for writing streak
    let streakResult = null;
    try {
        const { recordPublishForStreak } = await import('./streakService.js');
        streakResult = await recordPublishForStreak(userId);
    } catch (streakErr) {
        console.error('non-fatal: streak record failed:', streakErr?.message || streakErr);
    }

    return { success: true, streakResult };
}

export const updateJournalService = async(content, title, journalId, userId) => {
    if(!journalId){
        console.error('journalid is undefined');
        throw {status: 400, error: 'journalId is undefined'}
    }

    if(!userId){
        console.error('userId is undefined')
        throw({status: 400, error: 'userId is undefined'})
    }

    const {data: existingJournal, error: existingJournalError} = await supabase
    .from('journals')
    .select('id, user_id, content, title, post_type')
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

    const resolvedTitle = typeof title === 'string' && title.trim() ? title.trim() : existingJournal.title;
    if(!resolvedTitle){
        console.error('title is undefined');
        throw {status: 400, error: 'title is undefined'};
    }

    let resolvedContent = existingJournal.content;
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

    const embeddingBody = parseData.wholeText || '';
    const embeddings = await GenerateEmbeddings(resolvedTitle, embeddingBody);

    if(!embeddings || !Array.isArray(embeddings) || embeddings.length === 0){
        console.error('failed to generate embeddings')
        throw {status: 400, error: 'failed to generate embeddings'};
    }

    const journalData = {
        content: resolvedContent,
        title: resolvedTitle,
        post_type: POST_TYPE_TEXT,
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

    // Non-fatal: send mention notifications on edit
    try {
        const mentionedUserIds = extractMentionUserIds(resolvedContent);
        const filtered = mentionedUserIds
            .filter(id => id !== userId)
            .slice(0, 50);

        // Remove old mention notifications for this journal to avoid duplicates
        const { error: deleteError } = await supabase
            .from('notifications')
            .delete()
            .eq('type', 'mention')
            .eq('journal_id', journalId);

        if (deleteError) console.error('[mentions] edit: clear old failed:', deleteError.message);

        if (filtered.length > 0) {
            const notifRows = filtered.map(receiverId => ({
                sender_id: userId,
                receiver_id: receiverId,
                type: 'mention',
                journal_id: journalId,
                read: false
            }));

            const { error: notifError } = await supabase
                .from('notifications')
                .insert(notifRows);

            if (notifError) console.error('[mentions] edit: insert failed:', notifError.message);
        }
    } catch (mentionErr) {
        console.error('[mentions] edit error:', mentionErr?.message || mentionErr);
    }

    return true;
}

export const updateRepostCaptionService = async(journalId, userId, caption) => {
    if(!journalId){
        throw {status: 400, error: 'journalId is undefined'};
    }
    if(!userId){
        throw {status: 400, error: 'userId is undefined'};
    }

    const trimmedCaption = typeof caption === 'string' ? caption.trim() : '';
    if(trimmedCaption.length > 280){
        throw {status: 400, error: 'caption must be 280 characters or less'};
    }

    const {data: journal, error: fetchError} = await supabase
        .from('journals')
        .select('id, user_id, is_repost')
        .eq('id', journalId)
        .eq('user_id', userId)
        .maybeSingle();

    if(fetchError){
        console.error('failed to fetch journal for repost caption update:', fetchError.message);
        throw {status: 500, error: 'failed to fetch journal'};
    }

    if(!journal){
        throw {status: 404, error: 'journal not found'};
    }

    if(!journal.is_repost){
        throw {status: 400, error: 'journal is not a repost'};
    }

    const {error: updateError} = await supabase
        .from('journals')
        .update({repost_caption: trimmedCaption || null})
        .eq('id', journalId)
        .eq('user_id', userId);

    if(updateError){
        console.error('supabase error while updating repost caption:', updateError.message);
        throw {status: 500, error: 'failed to update repost caption'};
    }

    return true;
}

export const updateInterestsService = async(userId, writingInterests, writingGoal) => {
    if(!userId){
        throw {status: 400, error: 'userId is undefined'};
    }

    const payload = {};

    if(Array.isArray(writingInterests)){
        payload.writing_interests = writingInterests.filter(i => typeof i === 'string').slice(0, 16);
    }
    if(writingGoal && typeof writingGoal === 'string'){
        payload.writing_goal = writingGoal;
    }

    if(Object.keys(payload).length === 0){
        throw {status: 400, error: 'no valid fields to update'};
    }

    const {error} = await supabase
        .from('users')
        .update(payload)
        .eq('id', userId);

    if(error){
        console.error('supabase error updating interests:', error.message);
        throw {status: 500, error: 'failed to update interests'};
    }

    // Await embedding so it's in the DB before response (feed refetch needs it)
    if(Array.isArray(writingInterests) && writingInterests.length > 0){
        await updateUserInterestsEmbedding(userId, writingInterests);
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
