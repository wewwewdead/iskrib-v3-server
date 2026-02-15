import supabase from "./supabase.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

const POST_TYPE_CANVAS = 'canvas';
const ALLOWED_STAMP_TYPES = new Set(['heart', 'star', 'question', 'fire']);
const ALLOWED_MARGIN_ITEM_TYPES = new Set(['doodle', 'sticky']);
const STAMP_SELECT = 'id, journal_id, user_id, snippet_id, word_key, stamp_type, x, y, created_at, users!user_id(id, name, image_url)';
const MARGIN_SELECT = 'id, journal_id, user_id, item_type, payload, created_at, updated_at, users!user_id(id, name, image_url)';
const MAX_DOODLE_POINTS = 2400;
const MAX_STICKY_TEXT_LENGTH = 280;

const normalizeStampPayload = (stamp) => ({
    id: stamp?.id,
    journal_id: stamp?.journal_id,
    user_id: stamp?.user_id,
    snippet_id: stamp?.snippet_id,
    word_key: stamp?.word_key,
    stamp_type: stamp?.stamp_type,
    x: stamp?.x,
    y: stamp?.y,
    created_at: stamp?.created_at,
    user_name: stamp?.users?.name || null,
    user_image_url: stamp?.users?.image_url || null
});

const normalizeMarginPayload = (item) => ({
    id: item?.id,
    journal_id: item?.journal_id,
    user_id: item?.user_id,
    item_type: item?.item_type,
    payload: item?.payload || null,
    created_at: item?.created_at,
    updated_at: item?.updated_at,
    user_name: item?.users?.name || null,
    user_image_url: item?.users?.image_url || null
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseNumberInRange = (value, fieldName) => {
    const parsed = Number(value);
    if(Number.isNaN(parsed)){
        throw {status: 400, error: `${fieldName} should be a number`};
    }
    if(parsed < 0 || parsed > 1){
        throw {status: 400, error: `${fieldName} should be between 0 and 1`};
    }
    return parsed;
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

const validateDoodlePayload = (payload) => {
    if(!isPlainObject(payload)){
        throw {status: 400, error: 'doodle payload should be an object'};
    }

    const points = Array.isArray(payload.points) ? payload.points.map((point) => Number(point)) : [];
    if(points.length < 4 || points.length % 2 !== 0){
        throw {status: 400, error: 'doodle payload points should contain at least 2 points'};
    }
    if(points.length > MAX_DOODLE_POINTS){
        throw {status: 400, error: `doodle payload points should not exceed ${MAX_DOODLE_POINTS}`};
    }
    if(points.some((point) => Number.isNaN(point) || point < 0 || point > 1)){
        throw {status: 400, error: 'doodle points should be numbers between 0 and 1'};
    }

    const size = Number(payload.size);
    const normalizedSize = Number.isNaN(size) ? 2.8 : Math.min(Math.max(size, 1), 14);
    const color = typeof payload.color === 'string' && payload.color.trim()
        ? payload.color.trim().slice(0, 32)
        : '#5f92ff';

    return {
        points: points,
        size: normalizedSize,
        color: color
    };
}

const validateStickyPayload = (payload) => {
    if(!isPlainObject(payload)){
        throw {status: 400, error: 'sticky payload should be an object'};
    }

    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if(!text){
        throw {status: 400, error: 'sticky text is required'};
    }
    if(text.length > MAX_STICKY_TEXT_LENGTH){
        throw {status: 400, error: `sticky text should be less than ${MAX_STICKY_TEXT_LENGTH + 1} characters`};
    }

    const x = parseNumberInRange(payload.x, 'sticky x');
    const y = parseNumberInRange(payload.y, 'sticky y');
    const color = typeof payload.color === 'string' && payload.color.trim()
        ? payload.color.trim().slice(0, 32)
        : '#fff4a8';

    return {
        text: text,
        x: x,
        y: y,
        color: color
    };
}

const assertCanvasJournalAccess = async(journalId, viewerId = null) => {
    if(!journalId){
        throw {status: 400, error: 'journalId is undefined'};
    }

    const {data: journal, error: journalError} = await supabase
    .from('journals')
    .select('id, user_id, title, post_type, canvas_doc, privacy')
    .eq('id', journalId)
    .maybeSingle();

    if(journalError){
        console.error('supabase error while fetching canvas journal', journalError.message);
        throw {status: 500, error: 'supabase error while fetching canvas journal'};
    }

    if(!journal){
        throw {status: 404, error: 'journal not found'};
    }

    if(journal.post_type !== POST_TYPE_CANVAS){
        throw {status: 400, error: 'journal is not a canvas post'};
    }

    const isOwner = viewerId && journal.user_id === viewerId;
    if(journal.privacy === 'private' && !isOwner){
        throw {status: 403, error: 'canvas journal is private'};
    }

    return journal;
}

export const addCanvasStampService = async({journalId, userId, snippetId, wordKey, stampType, x, y}) => {
    if(!userId){
        throw {status: 401, error: 'userId is undefined'};
    }

    await assertCanvasJournalAccess(journalId, userId);

    if(!snippetId || typeof snippetId !== 'string'){
        throw {status: 400, error: 'snippetId should be a string'};
    }

    const normalizedStampType = typeof stampType === 'string' ? stampType.trim().toLowerCase() : '';
    if(!ALLOWED_STAMP_TYPES.has(normalizedStampType)){
        throw {status: 400, error: 'invalid stamp_type'};
    }

    const normalizedX = parseNumberInRange(x, 'x');
    const normalizedY = parseNumberInRange(y, 'y');
    const normalizedWordKey = typeof wordKey === 'string' && wordKey.trim() ? wordKey.trim().slice(0, 128) : null;

    const insertPayload = {
        journal_id: journalId,
        user_id: userId,
        snippet_id: snippetId.trim(),
        word_key: normalizedWordKey,
        stamp_type: normalizedStampType,
        x: normalizedX,
        y: normalizedY
    };

    const {data: insertedStamp, error: insertError} = await supabase
    .from('canvas_stamps')
    .insert(insertPayload)
    .select(STAMP_SELECT)
    .single();

    if(insertError){
        console.error('supabase error while adding canvas stamp:', insertError.message);
        throw {status: 500, error: 'supabase error while adding canvas stamp'};
    }

    return normalizeStampPayload(insertedStamp);
}

export const getCanvasStampsService = async(journalId, viewerId = null) => {
    await assertCanvasJournalAccess(journalId, viewerId);

    const {data: stamps, error: stampsError} = await supabase
    .from('canvas_stamps')
    .select(STAMP_SELECT)
    .eq('journal_id', journalId)
    .order('created_at', {ascending: true});

    if(stampsError){
        console.error('supabase error while fetching canvas stamps:', stampsError.message);
        throw {status: 500, error: 'supabase error while fetching canvas stamps'};
    }

    return (stamps || []).map(normalizeStampPayload);
}

export const deleteCanvasStampService = async(stampId, userId) => {
    if(!stampId){
        throw {status: 400, error: 'stampId is undefined'};
    }
    if(!userId){
        throw {status: 401, error: 'userId is undefined'};
    }

    const {data: stamp, error: stampError} = await supabase
    .from('canvas_stamps')
    .select('id, user_id, journal_id')
    .eq('id', stampId)
    .maybeSingle();

    if(stampError){
        console.error('supabase error while fetching stamp:', stampError.message);
        throw {status: 500, error: 'supabase error while fetching canvas stamp'};
    }

    if(!stamp){
        throw {status: 404, error: 'canvas stamp not found'};
    }

    const journal = await assertCanvasJournalAccess(stamp.journal_id, userId);
    const isStampOwner = stamp.user_id === userId;
    const isJournalOwner = journal.user_id === userId;
    if(!isStampOwner && !isJournalOwner){
        throw {status: 403, error: 'not authorized to delete this stamp'};
    }

    const {error: deleteError} = await supabase
    .from('canvas_stamps')
    .delete()
    .eq('id', stampId);

    if(deleteError){
        console.error('supabase error while deleting canvas stamp:', deleteError.message);
        throw {status: 500, error: 'supabase error while deleting canvas stamp'};
    }

    return {message: 'success'};
}

export const createCanvasRemixService = async({sourceJournalId, userId, titleOverride = ''}) => {
    if(!userId){
        throw {status: 401, error: 'userId is undefined'};
    }

    const sourceJournal = await assertCanvasJournalAccess(sourceJournalId, userId);
    const fallbackTitle = sourceJournal?.title ? `Remix: ${sourceJournal.title}` : 'Canvas Remix';
    const normalizedTitle = typeof titleOverride === 'string' && titleOverride.trim()
        ? titleOverride.trim().slice(0, 180)
        : fallbackTitle.slice(0, 180);

    const plainText = extractCanvasPlainText(sourceJournal?.canvas_doc);
    const embedding = await GenerateEmbeddings(normalizedTitle, plainText);
    if(!Array.isArray(embedding) || embedding.length === 0){
        throw {status: 500, error: 'failed to generate remix embedding'};
    }

    const remixPayload = {
        user_id: userId,
        title: normalizedTitle,
        post_type: POST_TYPE_CANVAS,
        content: null,
        canvas_doc: sourceJournal.canvas_doc,
        embeddings: embedding,
        is_remix: true,
        remix_source_journal_id: sourceJournal.id
    };

    let insertResult = await supabase
    .from('journals')
    .insert(remixPayload)
    .select('id, title, post_type, created_at')
    .single();

    if(insertResult.error){
        const errorMessage = insertResult.error?.message || '';
        const missingRemixColumns = errorMessage.includes('is_remix') || errorMessage.includes('remix_source_journal_id');
        if(missingRemixColumns){
            insertResult = await supabase
            .from('journals')
            .insert({
                user_id: userId,
                title: normalizedTitle,
                post_type: POST_TYPE_CANVAS,
                content: null,
                canvas_doc: sourceJournal.canvas_doc,
                embeddings: embedding
            })
            .select('id, title, post_type, created_at')
            .single();
        }
    }

    if(insertResult.error){
        console.error('supabase error while creating canvas remix:', insertResult.error.message);
        throw {status: 500, error: 'failed to create canvas remix'};
    }

    return {
        journal: insertResult.data,
        source_journal_id: sourceJournal.id
    };
}

export const getCanvasMarginsService = async(journalId, viewerId = null) => {
    await assertCanvasJournalAccess(journalId, viewerId);

    const {data: marginItems, error: marginError} = await supabase
    .from('canvas_margin_items')
    .select(MARGIN_SELECT)
    .eq('journal_id', journalId)
    .order('created_at', {ascending: true});

    if(marginError){
        console.error('supabase error while fetching canvas margin items:', marginError.message);
        throw {status: 500, error: 'failed to fetch canvas margin items'};
    }

    return (marginItems || []).map(normalizeMarginPayload);
}

export const addCanvasMarginService = async({journalId, userId, itemType, payload}) => {
    if(!userId){
        throw {status: 401, error: 'userId is undefined'};
    }

    await assertCanvasJournalAccess(journalId, userId);

    const normalizedType = typeof itemType === 'string' ? itemType.trim().toLowerCase() : '';
    if(!ALLOWED_MARGIN_ITEM_TYPES.has(normalizedType)){
        throw {status: 400, error: 'invalid item_type'};
    }

    const normalizedPayload = normalizedType === 'doodle'
        ? validateDoodlePayload(payload)
        : validateStickyPayload(payload);

    const {data: insertedItem, error: insertError} = await supabase
    .from('canvas_margin_items')
    .insert({
        journal_id: journalId,
        user_id: userId,
        item_type: normalizedType,
        payload: normalizedPayload
    })
    .select(MARGIN_SELECT)
    .single();

    if(insertError){
        console.error('supabase error while adding canvas margin item:', insertError.message);
        throw {status: 500, error: 'failed to add canvas margin item'};
    }

    return normalizeMarginPayload(insertedItem);
}

export const deleteCanvasMarginService = async(marginId, userId) => {
    if(!marginId){
        throw {status: 400, error: 'marginId is undefined'};
    }
    if(!userId){
        throw {status: 401, error: 'userId is undefined'};
    }

    const {data: marginItem, error: marginError} = await supabase
    .from('canvas_margin_items')
    .select('id, journal_id, user_id')
    .eq('id', marginId)
    .maybeSingle();

    if(marginError){
        console.error('supabase error while fetching margin item:', marginError.message);
        throw {status: 500, error: 'failed to fetch canvas margin item'};
    }

    if(!marginItem){
        throw {status: 404, error: 'canvas margin item not found'};
    }

    const journal = await assertCanvasJournalAccess(marginItem.journal_id, userId);
    const isOwner = marginItem.user_id === userId;
    const isCanvasAuthor = journal.user_id === userId;
    if(!isOwner && !isCanvasAuthor){
        throw {status: 403, error: 'not authorized to delete this margin item'};
    }

    const {error: deleteError} = await supabase
    .from('canvas_margin_items')
    .delete()
    .eq('id', marginId);

    if(deleteError){
        console.error('supabase error while deleting margin item:', deleteError.message);
        throw {status: 500, error: 'failed to delete canvas margin item'};
    }

    return {message: 'success'};
}
