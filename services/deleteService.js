import supabase from "./supabase.js";

const ALLOWED_MEDIA_BUCKETS = new Set(["background", "journal-images", "avatars"]);

const normalizeUrl = (url = "") => {
    if(typeof url !== "string" || !url){
        return "";
    }

    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return "";
    }
};

const extractBackgroundImageUrl = (background) => {
    if(!background || typeof background !== "object"){
        return "";
    }

    const rawBackgroundImage = background?.backgroundImage;
    if(typeof rawBackgroundImage !== "string"){
        return "";
    }

    const match = rawBackgroundImage.match(/url\(['"]?(.*?)['"]?\)/i);
    const extractedUrl = match?.[1] || rawBackgroundImage;
    return normalizeUrl(extractedUrl);
};

const doesUrlMatchDeletedPath = (candidateUrl, bucket, path, deletedPublicUrl = "", providedUrl = "") => {
    const normalizedCandidateUrl = normalizeUrl(candidateUrl);
    if(!normalizedCandidateUrl){
        return false;
    }

    const normalizedDeletedPublicUrl = normalizeUrl(deletedPublicUrl);
    const normalizedProvidedUrl = normalizeUrl(providedUrl);

    if(normalizedDeletedPublicUrl && normalizedCandidateUrl === normalizedDeletedPublicUrl){
        return true;
    }

    if(normalizedProvidedUrl && normalizedCandidateUrl === normalizedProvidedUrl){
        return true;
    }

    return normalizedCandidateUrl.endsWith(`/${bucket}/${path}`);
};

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

export const deleteProfileMediaImageService = async(userId, bucket, path, url = "") => {
    if(!userId){
        console.error("userId is undefined");
        throw {status: 400, error: "userId is undefined"};
    }

    if(!bucket || typeof bucket !== "string"){
        console.error("bucket is undefined");
        throw {status: 400, error: "bucket is undefined"};
    }

    if(!ALLOWED_MEDIA_BUCKETS.has(bucket)){
        console.error("bucket is not allowed");
        throw {status: 400, error: "bucket is not allowed"};
    }

    if(!path || typeof path !== "string"){
        console.error("path is undefined");
        throw {status: 400, error: "path is undefined"};
    }

    const normalizedPath = path.trim();
    const expectedPrefix = `user_id_${userId}/`;
    if(!normalizedPath.startsWith(expectedPrefix)){
        console.error("forbidden media path for user");
        throw {status: 403, error: "forbidden media path"};
    }

    const {error: removeError} = await supabase.storage
        .from(bucket)
        .remove([normalizedPath]);

    if(removeError){
        console.error("supabase error while deleting profile media image:", removeError.message);
        throw {status: 500, error: "supabase error while deleting profile media image"};
    }

    let clearedAvatar = false;
    let clearedBackground = false;

    if(bucket === "avatars" || bucket === "background"){
        const {data: userData, error: userDataError} = await supabase
            .from("users")
            .select("id, image_url, background")
            .eq("id", userId)
            .maybeSingle();

        if(userDataError){
            console.error("supabase error while loading user profile for media cleanup:", userDataError.message);
            throw {status: 500, error: "supabase error while loading user profile for media cleanup"};
        }

        if(userData){
            const {data: publicUrlData} = supabase.storage
                .from(bucket)
                .getPublicUrl(normalizedPath);

            const deletedPublicUrl = publicUrlData?.publicUrl || "";
            const updates = {};

            if(bucket === "avatars"){
                const matchesAvatar = doesUrlMatchDeletedPath(userData?.image_url, bucket, normalizedPath, deletedPublicUrl, url);
                if(matchesAvatar){
                    updates.image_url = null;
                    clearedAvatar = true;
                }
            }

            if(bucket === "background"){
                const backgroundImageUrl = extractBackgroundImageUrl(userData?.background);
                const matchesBackground = doesUrlMatchDeletedPath(backgroundImageUrl, bucket, normalizedPath, deletedPublicUrl, url);
                if(matchesBackground){
                    updates.background = null;
                    clearedBackground = true;
                }
            }

            if(Object.keys(updates).length > 0){
                const {error: updateProfileError} = await supabase
                    .from("users")
                    .update(updates)
                    .eq("id", userId);

                if(updateProfileError){
                    console.error("supabase error while clearing profile media references:", updateProfileError.message);
                    throw {status: 500, error: "supabase error while clearing profile media references"};
                }
            }
        }
    }

    return {
        deleted: true,
        bucket: bucket,
        path: normalizedPath,
        clearedAvatar: clearedAvatar,
        clearedBackground: clearedBackground
    };
};

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
