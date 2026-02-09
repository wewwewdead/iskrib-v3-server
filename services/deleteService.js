import supabase from "./supabase.js";

export const deleteJournalImageService = async(userId, filepath) =>{
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error:'userId is undefined'};
    }
    
    if(!filepath){
        console.error('filepath is undefined');
        throw {status: 400, error: 'filepath is undefined'}
    }

    const {error} = await supabase.storage
        .from('journal-images')
        .remove(filepath);

    if(error){
        console.error('supabase error while deleting image:', error.message);
        throw {status: 500, error: 'supabase error while deleting image'};
    }

    return true;
}

export const deleteJournalContentService = async(journalId, userId) =>{
    if(!journalId){
        console.error('journalid is undefined')
        throw {status: 400, error:' journalId is undefined'}
    }

    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'}
    }

    const {error: errorDeletingData} = await supabase
    .from('journals')
    .delete()
    .eq('id', journalId)
    .eq('user_id', userId)

    if(errorDeletingData){
        console.error('supabase error while deleting the journal content', errorDeletingData.message);
        throw {status: 500, error: 'supabase error while deleting the journal content'}
    }

    return true;
}
