import supabase from "./supabase.js";

export const deleteJournalImageService = async(token, filepath) =>{
    if(!token){
        console.error('token is undefined');
        throw {status: 400, error:'token is undefined'};
    }
    
    if(!filepath){
        console.error('filepath is undefined');
        throw {status: 400, error: 'filepath is undefined'}
    }

    const {data: authData,error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error while validating user:', errorAuthData.message);
        throw {status: 500, error: 'user is not authorized'}
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

export const deleteJournalContentService = async(journalId, token) =>{
    if(!journalId){
        console.error('journalid is undefined')
        throw {status: 400, error:' journalId is undefined'}
    }

    if(!token){
        console.error('token is undefined');
        throw {status: 400, error: 'token is undefined'}
    }

    const {error: errorDeletingData} = await supabase
    .from('journals')
    .delete()
    .eq('id', journalId)

    if(errorDeletingData){
        console.error('supabase error while deleting the journal content', errorDeletingData.message);
        throw {status: 500, error: 'supabase error while deleting the journal content'}
    }

    return true;
}