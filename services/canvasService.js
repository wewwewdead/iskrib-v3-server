import supabase from "./supabase.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

const POST_TYPE_CANVAS = 'canvas';

const extractCanvasPlainText = (canvasDoc) => {
    if(!canvasDoc || !Array.isArray(canvasDoc.snippets)){
        return '';
    }

    return canvasDoc.snippets
        .map((snippet) => (typeof snippet?.text === 'string' ? snippet.text.trim() : ''))
        .filter(Boolean)
        .join(' ');
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
