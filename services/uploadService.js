import sharp from "sharp";
import { imageUploader } from "../utils/imageUploader.js";
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

// ─── V3: parent thread validation ───
//
// `parent_journal_id` lets a user mark a journal as a continuation of
// any earlier published journal ("Continue this thought") — the parent
// may belong to any user, so threads can be cross-user conversations.
// This helper returns {id, rootJournalId} for a valid parent, or null.
// It rejects:
//   - non-string inputs
//   - parents that don't exist
//   - parents that are themselves still drafts
//
// `rootJournalId` is the parent's own root_journal_id if set,
// otherwise the parent's id (the parent is its own root). Callers
// stamp the new child's root_journal_id with this value so every
// thread member shares the same root pointer.
//
// On any rejection we return null (treated as "no parent") rather
// than throwing, so that a bad parent id never blocks a publish.
// userId is accepted for signature stability with existing callers
// but no longer used for authorization — any authenticated user may
// thread onto any published journal.
// eslint-disable-next-line no-unused-vars
const resolveValidParentJournal = async (rawParentId, userId) => {
    if(typeof rawParentId !== 'string'){
        return null;
    }
    const trimmed = rawParentId.trim();
    if(!trimmed){
        return null;
    }

    const {data, error} = await supabase
        .from('journals')
        .select('id, user_id, status, root_journal_id')
        .eq('id', trimmed)
        .maybeSingle();

    if(error){
        // If the column doesn't exist yet (pre-migration), retry without
        // root_journal_id so we still honor parent/child linkage.
        if(error?.message?.includes('root_journal_id')){
            const fallback = await supabase
                .from('journals')
                .select('id, status')
                .eq('id', trimmed)
                .maybeSingle();
            if(fallback.error || !fallback.data){
                return null;
            }
            if(fallback.data.status !== 'published'){
                return null;
            }
            return {id: fallback.data.id, rootJournalId: null};
        }
        console.error('parent journal lookup failed:', error.message);
        return null;
    }
    if(!data){
        return null;
    }
    if(data.status !== 'published'){
        return null;
    }

    return {
        id: data.id,
        rootJournalId: data.root_journal_id ?? data.id,
    };
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
        if(!/^[a-z0-9](?:[a-z0-9]*(?:-[a-z0-9]+)*)?$/.test(trimmed)){
            throw {status: 400, error: 'username must start/end with a letter or number and cannot have consecutive hyphens'};
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

    let parsedProfileBg;
    if (profileBg) {
        try {
            parsedProfileBg = JSON.parse(profileBg);
        } catch {
            throw { status: 400, error: 'invalid profileBg JSON' };
        }
    }
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
        throw {status: 500, error: 'error while uploading journal images'};
    }
}

export const uploadJournalContentService = async(
    content,
    title,
    userId,
    remixSourceJournalId = null,
    isRemix = false,
    promptId = null,
    parentJournalId = null
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
    const preview_text = parseData.slicedText || '';
    const thumbnail_url = parseData.firstImage?.src || null;
    const reading_time = Math.ceil((embeddingBody.trim().split(/\s+/).length) / 150) || 1;
    const payload = {
        user_id: userId,
        title: trimmedTitle,
        post_type: POST_TYPE_TEXT,
        content: content,
        preview_text,
        thumbnail_url,
        reading_time,
        status: 'published',
        published_at: new Date().toISOString(),
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

    const validatedParent = await resolveValidParentJournal(parentJournalId, userId);
    if(validatedParent){
        insertPayload.parent_journal_id = validatedParent.id;
        // Child inherits the parent's root. If the parent has no stored
        // root yet (pre-migration), use the parent's id — which matches
        // the "root is self" invariant.
        insertPayload.root_journal_id = validatedParent.rootJournalId ?? validatedParent.id;
    }

    let insertResult = await supabase
    .from('journals')
    .insert(insertPayload)
    .select('id')
    .single();

    let error = insertResult.error;

    if(error){
        const missingRemixColumns = error?.message?.includes('is_remix') || error?.message?.includes('remix_source_journal_id');
        const missingParentColumn = error?.message?.includes('parent_journal_id');
        const missingRootColumn = error?.message?.includes('root_journal_id');
        if(missingRemixColumns || missingParentColumn || missingRootColumn){
            const fallbackPayload = {
                ...payload,
                embeddings: embeddingResult
            };
            if(promptId){
                const parsedPromptId = parseInt(promptId, 10);
                if(!isNaN(parsedPromptId)){
                    fallbackPayload.prompt_id = parsedPromptId;
                }
            }

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

    // Maintain the "every row has a non-null root" invariant: if this
    // post has no parent, it IS its own root. We couldn't set this at
    // insert time because Postgres doesn't expose the new row's id in
    // the INSERT payload, so we run a targeted UPDATE right after.
    // Non-fatal on pre-migration envs (the column might not exist).
    if(journalId && !validatedParent){
        try {
            await supabase
                .from('journals')
                .update({root_journal_id: journalId})
                .eq('id', journalId)
                .is('root_journal_id', null);
        } catch (rootErr) {
            console.error('non-fatal: self-root update failed:', rootErr?.message || rootErr);
        }
    }

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

    return { success: true, streakResult, journalId };
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
    const preview_text = parseData.slicedText || '';
    const thumbnail_url = parseData.firstImage?.src || null;
    const reading_time = Math.ceil((embeddingBody.trim().split(/\s+/).length) / 150) || 1;
    const embeddings = await GenerateEmbeddings(resolvedTitle, embeddingBody);

    if(!embeddings || !Array.isArray(embeddings) || embeddings.length === 0){
        console.error('failed to generate embeddings')
        throw {status: 400, error: 'failed to generate embeddings'};
    }

    const journalData = {
        content: resolvedContent,
        title: resolvedTitle,
        post_type: POST_TYPE_TEXT,
        embeddings: embeddings,
        preview_text,
        thumbnail_url,
        reading_time,
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

export const saveDraftService = async(content, title, userId, draftId = null, promptId = null, parentJournalId = null) => {
    if(!userId){
        throw {status: 400, error: 'userId is undefined'};
    }

    if(!content || typeof content !== 'string' || !content.trim()){
        throw {status: 400, error: 'content is required'};
    }

    // Validate content is parseable JSON
    try {
        JSON.parse(content);
    } catch {
        throw {status: 400, error: 'content must be valid JSON'};
    }

    const trimmedTitle = typeof title === 'string' ? title.trim() : '';

    if(draftId){
        // Update existing draft — verify ownership
        const {data: existing, error: fetchError} = await supabase
            .from('journals')
            .select('id, user_id, status')
            .eq('id', draftId)
            .eq('user_id', userId)
            .eq('status', 'draft')
            .maybeSingle();

        if(fetchError){
            console.error('failed to fetch draft for update:', fetchError.message);
            throw {status: 500, error: 'failed to fetch draft'};
        }

        if(!existing){
            throw {status: 404, error: 'draft not found'};
        }

        const {error: updateError} = await supabase
            .from('journals')
            .update({
                title: trimmedTitle,
                content: content,
            })
            .eq('id', draftId)
            .eq('user_id', userId);

        if(updateError){
            console.error('supabase error updating draft:', updateError.message);
            throw {status: 500, error: 'failed to update draft'};
        }

        return {id: draftId};
    }

    // Create new draft
    const payload = {
        user_id: userId,
        title: trimmedTitle,
        content: content,
        post_type: POST_TYPE_TEXT,
        status: 'draft',
    };

    if(promptId){
        const parsedPromptId = parseInt(promptId, 10);
        if(!isNaN(parsedPromptId)){
            payload.prompt_id = parsedPromptId;
        }
    }

    const validatedParent = await resolveValidParentJournal(parentJournalId, userId);
    if(validatedParent){
        payload.parent_journal_id = validatedParent.id;
        payload.root_journal_id = validatedParent.rootJournalId ?? validatedParent.id;
    }

    let insertResult = await supabase
        .from('journals')
        .insert(payload)
        .select('id')
        .single();

    // Fallback for pre-migration environments where parent_journal_id
    // and/or root_journal_id columns don't exist yet. Same pattern as
    // the publish path.
    if(insertResult.error){
        const msg = insertResult.error?.message || '';
        if(msg.includes('parent_journal_id') || msg.includes('root_journal_id')){
            const fallbackPayload = {...payload};
            delete fallbackPayload.parent_journal_id;
            delete fallbackPayload.root_journal_id;
            insertResult = await supabase
                .from('journals')
                .insert(fallbackPayload)
                .select('id')
                .single();
        }
    }

    if(insertResult.error){
        console.error('supabase error creating draft:', insertResult.error.message);
        throw {status: 500, error: 'failed to create draft'};
    }

    const newDraftId = insertResult.data.id;

    // Self-root invariant for drafts without a parent. Non-fatal if the
    // column isn't there yet. When the draft is later published, the
    // row already carries the correct root_journal_id.
    if(newDraftId && !validatedParent){
        try {
            await supabase
                .from('journals')
                .update({root_journal_id: newDraftId})
                .eq('id', newDraftId)
                .is('root_journal_id', null);
        } catch (rootErr) {
            console.error('non-fatal: draft self-root update failed:', rootErr?.message || rootErr);
        }
    }

    return {id: newDraftId};
}

export const publishDraftService = async(journalId, userId) => {
    if(!journalId){
        throw {status: 400, error: 'journalId is required'};
    }
    if(!userId){
        throw {status: 400, error: 'userId is required'};
    }

    const {data: draft, error: fetchError} = await supabase
        .from('journals')
        .select('id, user_id, status, title, content, prompt_id')
        .eq('id', journalId)
        .eq('user_id', userId)
        .maybeSingle();

    if(fetchError){
        console.error('failed to fetch draft for publish:', fetchError.message);
        throw {status: 500, error: 'failed to fetch draft'};
    }

    if(!draft){
        throw {status: 404, error: 'draft not found'};
    }

    if(draft.status !== 'draft'){
        throw {status: 400, error: 'journal is not a draft'};
    }

    const trimmedTitle = typeof draft.title === 'string' ? draft.title.trim() : '';
    if(!trimmedTitle){
        throw {status: 400, error: 'title is required to publish'};
    }

    if(!draft.content){
        throw {status: 400, error: 'content is required to publish'};
    }

    const parseData = parseTextContentSafely(draft.content);
    if(!parseData){
        throw {status: 400, error: 'failed to parse content for publish'};
    }

    const embeddingBody = parseData.wholeText || '';
    const preview_text = parseData.slicedText || '';
    const thumbnail_url = parseData.firstImage?.src || null;
    const reading_time = Math.ceil((embeddingBody.trim().split(/\s+/).length) / 150) || 1;

    const embeddings = await GenerateEmbeddings(trimmedTitle, embeddingBody);

    if(!embeddings || !Array.isArray(embeddings) || embeddings.length === 0){
        console.error('failed to generate embeddings for draft publish');
        throw {status: 400, error: 'failed to generate embeddings'};
    }

    const {error: updateError} = await supabase
        .from('journals')
        .update({
            status: 'published',
            published_at: new Date().toISOString(),
            embeddings,
            preview_text,
            thumbnail_url,
            reading_time,
            title: trimmedTitle,
        })
        .eq('id', journalId)
        .eq('user_id', userId);

    if(updateError){
        console.error('supabase error publishing draft:', updateError.message);
        throw {status: 500, error: 'failed to publish draft'};
    }

    // Non-fatal: send mention notifications
    try {
        const mentionedUserIds = extractMentionUserIds(draft.content);
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
                console.error('[mentions] publish draft: insert failed:', notifError.message);
            }
        }
    } catch (mentionErr) {
        console.error('[mentions] publish draft error:', mentionErr?.message || mentionErr);
    }

    // Non-fatal: record publish for writing streak
    let streakResult = null;
    try {
        const { recordPublishForStreak } = await import('./streakService.js');
        streakResult = await recordPublishForStreak(userId);
    } catch (streakErr) {
        console.error('non-fatal: streak record failed:', streakErr?.message || streakErr);
    }

    return { success: true, streakResult, journalId };
}

export const getDraftsService = async(userId) => {
    if(!userId){
        throw {status: 400, error: 'userId is required'};
    }

    const {data, error} = await supabase
        .from('journals')
        .select('id, title, created_at, updated_at')
        .eq('user_id', userId)
        .eq('status', 'draft')
        .order('updated_at', {ascending: false})
        .limit(50);

    if(error){
        console.error('supabase error fetching drafts:', error.message);
        throw {status: 500, error: 'failed to fetch drafts'};
    }

    return {data: data || []};
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
