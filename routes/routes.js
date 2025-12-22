import express, { json, Router } from "express";
import supabase from "../services/supabase.js";
import multer from "multer";
import sharp from 'sharp';
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";
import ParseContent from "../utils/parseData.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {fileSize: 10 * 1024 * 1024},
}).single('image');

export const imageUploader = async(file, userId, bucket) =>{
    if(!file){
        return res.status(500).json({error: 'no file received'});
    }

    let img_buffer = null
    let img_url = null
    img_buffer = await sharp(file.buffer)
    .webp({quality: 80})
    .toBuffer();

    const folderName = `user_id_${userId}`;
    const fileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
    const filePath = `${folderName}/${fileName}`;

    const {data: uploadImage, error: errorUploadImage} = await supabase.storage
    .from(bucket)
    .upload(filePath, img_buffer, {
        contentType: 'image/webp',
        upsert: true
    })
    if(errorUploadImage){
        console.error('supabase error while uploading image to supabase bucket', errorUploadImage)
        return res.status(500).json({error: 'error uploading image into supabase bucket'});
    }
    const {data: data_url} = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath)
    
    if(data_url){
        img_url = data_url.publicUrl;
        return img_url;
    } else {
        throw new Error('Error uploading the image');
    }
}

router.post('/verify-turnstile', async(req, res) =>{
    const {token} = req.body;

    if(!token){
        return res.status(400).json({success: false, message: 'No token provided'})
    }

    const secretKey = process.env.SECRET_KEY;

    try {
        const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                secret: secretKey,
                response: token
            })
        })

        const data = await result.json();
        if(data.success){
            return res.status(200).json({success: true});
        }else {
            return res.status(400).json({success: false, message: 'Verification failed'})
        }
    } catch (error) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
})
router.get('/getUserData', async(req, res) => {
    const {userId} = req.query
    if(!userId){
        return res.status(400).json({error: 'No userId provided'});
    }

    const userDataPromise = supabase
    .from('users')
    .select('*')
    .eq('id', userId)

    const followerCountPromise = supabase
    .from('follows')
    .select('*', {count: 'exact', head: true})
    .eq('following_id', userId)

    const followingCountPromise = supabase
    .from('follows')
    .select('*', {count: 'exact', head: true})
    .eq('follower_id', userId)

    const [userDataResult, followerCountResult, followingCountResult] = await Promise.all([
        userDataPromise,
        followerCountPromise,
        followingCountPromise
    ])


    const {data: userData, error: errorUserData} = userDataResult;
    const {count: followerCount, error: errorFollowerCount} = followerCountResult;
    const {count: followingCount, error: errorFollowingCount} = followingCountResult;

    if(errorUserData || errorFollowerCount || errorFollowingCount){
        console.error('supabase error while fetching user data:', errorUserData || errorFollowerCount || errorFollowingCount)
        return res.status(500).json({error: 'supabase error while fetching user data'});
    }
    return res.status(200).json({userData, followerCount, followingCount});
})

router.get('/check-user', async(req, res) => {
    const userId= req.query.userId;
    if(!userId){
        return res.status(400).json({error: 'No user Id provided'})
    }
    const {data: userData, error: errorFetching} = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)

    if(errorFetching){
        return res.status(500).json({error: errorFetching.message});
    }
    
    return res.status(200).json({exist: userData.length > 0})
})

router.post('/upload-user-data',upload, async(req, res) =>{
    const {bio, name, userEmail} = req.body;
    const image = req.file;

    const token = req.headers.authorization.split(' ')[1];
    if(!token){
        return res.status(400).json({error: 'no token provided'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token)
    const userId = authData?.user?.id;

    if(errorAuthData){
        return res.status(400).json({error: errorAuthData})
    }

    let webBuffer = null
    let publicUrl = null
    if(image){
        const dataUrl = await imageUploader(image, userId, 'avatars');

        publicUrl = dataUrl;
    }

    const data = {
        bio: bio,
        name: name,
        id: authData.user.id,
        user_email: authData.user.email,
        image_url: publicUrl ? publicUrl : null
    }
    const {data: uploadData, error:errorUploadData} = await supabase
    .from('users')
    .insert([data])

    if(errorUploadData){
        return res.status(500).json({error: errorUploadData})
    }
    return res.status(200).json({success: uploadData})
})

router.post('/update-user-data', upload, async(req, res) => {
    let avatar_url = null
    const {name, bio, profileBg, dominantColors, secondaryColors, fontColor} = req.body;

    const payload = {
        name: name,
        bio: bio,
        profile_font_color: fontColor,
        dominant_colors: dominantColors,
        secondary_colors: secondaryColors
    }

    try {
        payload.background = JSON.parse(profileBg);
    } catch (error) {
        console.error("Failed to parse JSON string from FormData:", e);
    }

    const token = req.headers?.authorization?.split(' ')[1];
    if(!token) return res.status(400).json({error: 'Not authorized'});

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
    if(errorAuthData) return res.status(400).json({error: errorAuthData});

    const file = req.file;
    if(file){
        const img_url = await imageUploader(file, authData?.user?.id, 'avatars');
        if(img_url){
            avatar_url = img_url
            payload.image_url = avatar_url
        }
    }

    const {data: uploadData, error: errorUploadData} = await supabase
    .from('users')
    .update(payload)
    .eq('id', authData?.user?.id);

    if(errorUploadData) return res.status(500).json({error: errorUploadData});

    console.log(payload);
    
    return res.status(200).json({data: uploadData}) 
})
router.post('/updateFontColor',upload, async(req, res) => {
    const {fontColor} = req.body;
    if(!fontColor) return res.status(400).json({error: 'Missing font data'});

    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(400).json({error: 'Not authorized'});

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
    if(errorAuthData) return res.status(500).json({error: errorAuthData});

    const userId = authData?.user?.id;

    const {data: upadteFont, error: errorUpdateFont} = await supabase
    .from('users')
    .update({profile_font_color: fontColor})
    .eq('id', userId);

    if(errorUpdateFont) return res.status(500).json({error: errorUpdateFont});

    return res.status(200).json({message: 'success'});
})

router.post('/uploadBackground', upload, async(req, res) => {
    const {userId} = req.body;
    const file = req.file
    if(!file || !userId) return res.status(400).json({error: 'Missing file or userid'});

    try {
        const image_url = await imageUploader(file, userId, 'background');
        if(image_url){
            return res.status(200).json({data: image_url});
        } else {
            return res.status(500).json({error: image_url});
        }
    } catch (error) {
        console.error('upload image error', error);
        res.status(400).json({error: 'Failed to upload image'})
    }
})

router.post('/save-journal-image', upload, async(req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if(!token) return res.status(400).json({error: 'Not authorized'})
    
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData) {
        console.error('supabase error while checking users authentication', errorAuthData)
        return res.status(500).json({error: 'error checking users authentication'});
    }

    const user_id = authData.user.id;

    const file = req.file;
    if(!file){
        return res.status(500).json({error: 'no file received'});
    }

    let img_buffer = null
    let img_url = null
    img_buffer = await sharp(file.buffer)
    .webp({quality: 80})
    .toBuffer();

    //make a helper function if yoou have time 
    //in helper function you pass the parameters(ID, FILE AND THE BUCKET_NAME)
    // const folderName = `user_id_${user_id}`;
    // const fileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
    // const filePath = `${folderName}/${fileName}`;

    // const {data: uploadImage, error: errorUploadImage} = await supabase.storage
    // .from('journal-images')
    // .upload(filePath, img_buffer, {
    //     contentType: 'image/webp',
    //     upsert: true
    // })
    // if(errorUploadImage){
    //     console.error('supabase error while uploading image into supabase', errorUploadImage)
    //     return res.status(500).json({error: 'supabase error while uploading image into supabase bucket'});
    // }
    // const {data: data_url} = supabase.storage
    // .from('journal-images')
    // .getPublicUrl(filePath)

    const data_url = await imageUploader(file, user_id, 'journal-images');
    
    if(data_url){
        img_url = data_url;
        return res.status(200).json({img_url: img_url})
    } else {
        res.status(500).json({error: 'no image url available'})
    }
})
router.post('/delete-journal-images', async(req, res) =>{
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const {filepath} = req.body;

        // console.log(filepath)

        if(!token){
            return res.status(400).json({error: 'No token provided'})
        }

        if(!filepath){
            return res.status(400).json({error: 'Filepath not received!'})
        }
        const {error} = await supabase.storage
        .from('journal-images')
        .remove(filepath);

        if(error){
            console.error('supabase error while deleting data from supabase', error)
            return res.status(500).json({error: 'error deleting data from database'})
        }
        return res.status(200).json({message: 'Image deleted successfully'});
        } catch (error) {
            console.error('Delete image error', error);
            res.status(400).json({error: 'Failed to delete image'})
        }
})
router.post('/save-journal', upload, async(req, res) => {
    try {
        const {content, title} = req.body;

        const token = req.headers.authorization?.split(' ')[1];
        if(!token) return res.status(400).json({error: 'No token provided'});

        if(!content || !title) {
            res.status(400).json({error: 'Title or content is not available'});
        }

        const parsedData = ParseContent(content);
        // console.log(parsedData.wholeText)

        // const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
        const authData = supabase.auth.getUser(token);
        const embeddingPromise = GenerateEmbeddings(title, parsedData.wholeText)

        const [auhtDataResult, embeddingResult] = await Promise.all([
            authData,
            embeddingPromise
        ])

        if(auhtDataResult.error) {
            console.error('supabase error while checking users authentication', auhtDataResult.error);
            return res.status(400).json({error: 'error checking users authenication'})
        }

        const userId = auhtDataResult?.data?.user?.id;
        const embedding = embeddingResult;

        if(!Array.isArray(embedding)){
            throw new Error('Embedding generation failed')
        }
        
        const {data, error} = await supabase
        .from('journals')
        .insert({user_id: userId, content: content, title: title, embeddings: embedding});

        if(error) {
            console.error('supabase error while inserting data into supabase', error)
            return res.status(500).json({error: 'error inserting journal into supabase'})
        }
        
        return res.status(200).json({message: 'Content saved successfully!'})
    } catch (error) {
        console.error('Failed to save editor state:', error);
    }
})

router.post('/update-journal', upload, async(req, res) => {
    try {
        const {content, title, journalId} = req.body;
        const token = req.headers?.authorization?.split(' ')[1];

        if(!token){
            console.error('error: token validation is undefined')
            return res.status(400).json({error: 'not authorized'});
        }
        if(!content || !title || !journalId){
            console.error('error: content, title or journalId is missing');
            return res.status(400).json({error: 'content, tilte or journalId is undefined'});
        }

        const parsedData = ParseContent(content);

        const authDataPromise = supabase.auth.getUser(token);
        const embeddingPromise = GenerateEmbeddings(title, parsedData.wholeText);

        const [auhtDataResult, embeddingResult] = await Promise.all([
            authDataPromise,
            embeddingPromise
        ])

        const {data: authData, error: errorAuthData} = auhtDataResult
        const embeddings = embeddingResult;

        if(!Array.isArray(embeddings)){
            throw new Error('embedding generation failed');
        }

        if(errorAuthData){
            console.error('supabase error while checking authorization:', errorAuthData.message);
            return res.status(500).json({error: 'error in validating user authorization'});
        }

        const userId = authData?.user?.id;

        const journaldData = {
            content: content,
            title: title,
            embeddings: embeddings
        }

        const {data, error} = await supabase
        .from('journals')
        .update(journaldData)
        .eq('id', journalId)
        .eq('user_id', userId)

        if(error) {
            console.error('error updating journal:', error.message)
            return res.status(500).json({error: 'supabase error while updating the columns in journals table'})
        }

        return res.status(200).json({message: 'journal was updated successfuly'})
    } catch (error) {
        console.error('Failed to save editor state:', error);
    }
})

router.get('/journals', async(req, res) => {
    const {limit = 5, before, userId} = req.query;
    // console.log(userId);

    if(!userId) {
        console.error('error: userId is undefined')
        return res.status(400).json({error: 'no userId'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20){
        return res.status(400).json({error: 'limit must be between 1 and 20'});
    }

    try {
        let query = supabase
        .from('journals')
        .select(`
            *, users(*), 
            like_count: likes(count),
            comment_count: comments(count), 
            bookmark_count: bookmarks(count)
            `
        )
        .order('created_at', {ascending: false})
        .order('id', {ascending: false})
        .eq('privacy', 'public')
        .limit(parsedLimit + 1)


        //if cursor(before) exist then fetch only the older post;
        if(before) {
            query = query.lt('created_at', before); // fetch only less than before(dates)
        }

        const {data, error} = await query;

        if(!data || data.length === 0) {
            return res.status(200).json({data: [], hasMore: false});
        }
        
        const journalIds = data?.map(journal => journal.id);

        let userLikesPromise;
        let userBookmarksPromise;

        if(journalIds){
            userLikesPromise = supabase
            .from('likes')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId)

            userBookmarksPromise = supabase
            .from('bookmarks')
            .select('journal_id')
            .in('journal_id', journalIds)
            .eq('user_id', userId)


        }
        
        const [userLikes, userBookmarks] = await Promise.all([
            userLikesPromise, userBookmarksPromise
        ])
        
       
        const {data: userLikesResult, error: errorUserLikes} =  userLikes
        const {data: userBookmarksResult, error: errorUserBookmarks} =  userBookmarks

        if(error) {
            console.error('supabase error while fetching journals', error)
            return res.status(500).json({error: 'error fetching journals'});
        }

        if(errorUserLikes || errorUserBookmarks){
            console.error('supabase error while fetching likes and bookmarks:', errorUserLikes.message || errorUserBookmarks.message)
            return res.status(500).json({error: 'supabase error while feching user likes and bookmarks'})
        }
        
        const userLikesSet = new Set(
            userLikesResult?.map( r => r.journal_id) || []
        )
        const userBookmarksSet = new Set(
            userBookmarksResult?.map(r => r.journal_id) || []
        )

        //look up sets
        const formatted = data.map((journal) => ({
            ...journal,
            has_liked: userLikesSet?.has(journal.id),
            has_bookmarked: userBookmarksSet?.has(journal.id)
        }))

        const hasMore = data.length > parsedLimit;
        const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

        res.status(200).json({data: slicedData, hasMore: hasMore}); 
    } catch (error) {
        console.error('Error fetching posts:', error);
        return res.status(500).json({ error: error.message });
    }
})

router.get('/userJournals', async(req, res) => {
    const {limit = 5, before, userId} = req.query;

    if(!userId){
        console.error('error: userId is undefined')
        return res.status(400).json({error: 'no userId'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20){
        return res.status(400).json({error: 'limit must be between 1 and 20'})
    }

    let query = supabase
    .from('journals')
    .select(`
        *, 
        users(name, image_url, user_email, id),
        like_count: likes(count),
        comment_count: comments(count),
        bookmark_count: bookmarks(count)
        `)
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: journals, error: errorJournals} = await query;

    if(errorJournals){
        console.error('supabase error:', errorJournals);
        return res.status(500).json({error: 'supabase error while fetching user journals'})
    }

    if(!journals || journals.length === 0){
        return res.status(200).json({data: [], hasMore: false})
    }

    const journalIds = journals.map((journal) => journal.id);

    let userLikesPromise;
    let userBookmarksPromise;

    if(journalIds){
        userLikesPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)

        userBookmarksPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)
    }

    const [userLikes, userBookmarks] = await Promise.all([
        userLikesPromise, userBookmarksPromise
    ])

    const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
    const {data: userBookmarksResult, error: errorBookmarksResult} = userBookmarks;

    if(errorUserLikeResult || errorBookmarksResult) {
        console.error('supabase error while fetching userlikes and userbookmarks', errorUserLikeResult || errorBookmarksResult);
        return res.status(500).json({error: 'error fetching user likes and user bookmarks'})
    }

    //lookup sets
    const userLikesSet = new Set(userLikesResult.map((journal) => journal.journal_id) || []);
    const userBookmarksSet= new Set(userBookmarksResult.map((bookmark) => bookmark.journal_id) || []);

    const formatted = journals.map((journal) => ({
        ...journal,
        has_liked: userLikesSet.has(journal.id),
        has_bookmarked: userBookmarksSet.has(journal.id)
     }))

     const hasMore = journals.length > parsedLimit;
     const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

     return res.status(200).json({data: slicedData, hasMore: hasMore})

})

router.get('/visitedUserJournals', async(req, res) => {
    const {limit = 5, before, userId, loggedInUserId} = req.query;

    if(!userId){
        console.error('error: userId is undefined')
        return res.status(400).json({error: 'no userId'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20){
        return res.status(400).json({error: 'limit must be between 1 and 20'})
    }

    let query = supabase
    .from('journals')
    .select(`
        *, 
        users(name, image_url, user_email, id),
        like_count: likes(count),
        comment_count: comments(count),
        bookmark_count: bookmarks(count)
        `)
    .eq('user_id', userId)
    .eq('privacy', 'public')
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: journals, error: errorJournals} = await query;

    if(errorJournals){
        console.error('supabase error:', errorJournals);
        return res.status(500).json({error: 'supabase error while fetching user journals'})
    }

    if(!journals || journals.length === 0){
        return res.status(200).json({data: [], hasMore: false})
    }

    const journalIds = journals.map((journal) => journal.id);

    let userLikesPromise;
    let userBookmarksPromise;

    if(journalIds){
        userLikesPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', loggedInUserId)

        userBookmarksPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', loggedInUserId)
    }

    const [userLikes, userBookmarks] = await Promise.all([
        userLikesPromise, userBookmarksPromise
    ])

    const {data: userLikesResult, error: errorUserLikeResult} = userLikes;
    const {data: userBookmarksResult, error: errorBookmarksResult} = userBookmarks;

    if(errorUserLikeResult || errorBookmarksResult) {
        console.error('supabase error while fetching userlikes and userbookmarks', errorUserLikeResult || errorBookmarksResult);
        return res.status(500).json({error: 'error fetching user likes and user bookmarks'})
    }

    //lookup sets
    const userLikesSet = new Set(userLikesResult.map((journal) => journal.journal_id) || []);
    const userBookmarksSet= new Set(userBookmarksResult.map((bookmark) => bookmark.journal_id) || []);

    const formatted = journals.map((journal) => ({
        ...journal,
        has_liked: userLikesSet.has(journal.id),
        has_bookmarked: userBookmarksSet.has(journal.id)
     }))

     const hasMore = journals.length > parsedLimit;
     const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

     return res.status(200).json({data: slicedData, hasMore: hasMore})

})

router.delete('/deleteJournal/:journalId', async(req, res) => {
    const {journalId} = req.params;
    const token = req.headers?.authorization?.split(' ')[1];
    if(!journalId){
        comments.error('journalId is undefined');
        return res.status(400).json({error: 'journalId is required'})
    }
    if(!token){
        console.error('token is undefined')
        return res.status(400).json({error: 'not auhtorized'})
    }

    const {error: errorDeletingData} = await supabase
    .from('journals')
    .delete()
    .eq('id', journalId)

    if(errorDeletingData){
        console.error(errorDeletingData);
        return res.status(500).json({error: 'supabase error while deleting the journal'});
    }
    return res.status(200).json({message: 'success'})
})


router.post('/like', async(req, res) =>{
    const {journalId, receiverId,} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token) return res.status(400).json({error: 'Not Authorized'});
    if(!journalId) return res.status(400).json({error: 'No post Id!'});
    if(!receiverId) return res.status(400).json({error: 'No receiver id!'});

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData) {
        console.error('supabae error while checking users authentication', errorAuthData)
        return res.status(500).json({error: 'error checking user authentication'})
    };

    const userId = authData.user.id;
    const isOwnContent = userId === receiverId

    const {data: existingLike, error: errorExistingLike} = await supabase
    .from('likes')
    .select('user_id')
    .eq('user_id', userId)
    .eq('journal_id', journalId)
    .maybeSingle()

    if(errorExistingLike){
        console.error('supabase error while checking existing like', errorExistingLike)
        return res.status(500).json({error: 'error checking existing like'});
    }

    if(!existingLike){  
        const inserNotifPromise = supabase
        .from('notifications')
        .insert({
            sender_id: userId,
            receiver_id: receiverId,
            journal_id: journalId,
            type: 'like',
            read: false
        })

        const inserLikePromise = supabase
        .from('likes')
        .insert({user_id: userId, journal_id: journalId})

        const [insertNotif, insertLike] = await Promise.all([
            isOwnContent ? Promise.resolve({error: null}) : inserNotifPromise,
            inserLikePromise,
        ])

        const {data: insertNotifcationResult, error: errorInsertNotificationResult} = insertNotif;

        const {data: insertLikeResult, error: errorInserLikeResult} = insertLike;

        if(errorInsertNotificationResult || errorInserLikeResult) {
            console.log('supabase error:', errorInserLikeResult || errorInsertNotificationResult);
            return res.status(500).json({error: 'error inserting data into likes table or notifications table'});
        }

        return res.status(200).json({message: 'liked'});
    } else {
        const deleteNotifPromise = supabase
        .from('notifications')
        .delete()
        .eq('receiver_id', receiverId)
        .eq('journal_id', journalId)
        .eq('type', 'like')

        const deleteLikePromise = await supabase
        .from('likes')
        .delete()
        .eq('user_id', userId)
        .eq('journal_id', journalId)

        const [deleteNotif, deleteLike] = await Promise.all([
            isOwnContent ? Promise.resolve({error: null}) : deleteNotifPromise,
            deleteLikePromise
        ])

        const {error: errorDeleteNotif} = deleteNotif;
        const {error: errorDeleteLike} = deleteLike;

        if(errorDeleteLike || errorDeleteNotif) {
            console.error('supabase error while deleting notifcation or likes', errorDeleteLike || errorDeleteNotif)
            return res.status(500).json({error: 'error deleting like or notif'});
        }

        return res.status(200).json({message: 'unliked'});
    }

})

router.post('/addComment',upload, async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token) return res.status(400).json({error: 'Not authorized'});
    // console.log(req.body)
    const {comments, postId, receiverId} = req.body;

    if(!comments || !postId){
        return res.status(400).json({error: 'no postId or Comment recieve'});
    }
    if(!receiverId) return res.status(400).json({error: 'no receiverId'});

    const{data: authData, errorAuthData} = await supabase.auth.getUser(token)

    if(errorAuthData) {
        console.error('supabae error while checking users authentication', errorAuthData)
        return res.status(500).json({error: 'error checking user authentication'})
    };

    const isOwnContent = receiverId === authData?.user?.id;

    const insertNotifPromise = supabase
    .from('notifications')
    .insert(
        {
            sender_id: authData?.user.id,
            receiver_id: receiverId,
            journal_id: postId,
            read: false,
            type: 'comment'
        }
    )
    const insertCommentPromise = supabase
    .from('comments')
    .insert(
        {
            comment: comments,post_id: postId,
            user_id: authData?.user?.id
        }
    )

    const [insertNotif, insertComment] = await Promise.all([
        isOwnContent ? Promise.resolve({error: null}) : insertNotifPromise,
        insertCommentPromise,
    ])

    const {data: addComment, error: errorAddComment} = insertComment;

    const {data: insertNotifResul, error: errorAddNotif} = insertNotif;

    if(errorAddComment || errorAddNotif){
        console.error('supabase error while inserting comments or notif', errorAddComment || errorAddNotif)
        return res.status(500).json({error: 'error adding comments or notif'});
    } 
        

    return res.status(200).json({message: 'success'});
})

router.get('/getComments', async(req, res) =>{
    const {postId, limit = 10, before} = req.query;
    // console.log(before)

    if(!postId){
        return res.status(400).json({error: 'no postId'})
    }

    try {
        
        let query = supabase
        .from('comments')
        .select('*, users(name, image_url)')
        .eq('post_id', postId)
        .order('created_at', {ascending: false})
        .order('id', {ascending: false})
        .limit(parseInt(limit) + 1) //peek ahead +1, get 1 more data if the data in the table has more than the limit

        if(before){
            query = query.lt('created_at', before)
        }

        const {data: comments, error: errorFetchComments} = await query;
        if(errorFetchComments){
            console.error('supabase error while fetching comments', errorFetchComments)
            return res.status(500).json({error: 'failed to fect comments'});
        }

        const hasMore = comments.length > limit; // return true if it has peek ahead
        const commentsData = hasMore ? comments.slice(0, parseInt(limit)) : comments;

        return res.status(200).json({comments: commentsData, hasMore: hasMore});
    } catch (error) {
        console.error('Error fetching comments:', error);
        return res.status(500).json({ error: error.message });
    }
})

router.post('/addBoorkmark',upload, async(req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const {journalId} = req.body;

    if(!token) return res.status(400).json({error: 'Not authorized'});
    if(!journalId) return res.status(400).json({error: 'No journalId!'})
    
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData) {
        console.error('error:', errorAuthData)
        return res.status(500).json({error: "supabase error while checking user's authorization"});
    }
    const user_id = authData?.user?.id;

    const {data:checkExisting, error: errorCheckExisting} = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id',user_id)
    .eq('journal_id', journalId)
    .maybeSingle()

    if(errorCheckExisting){
        console.error('supabase error while checking existing bookmark', errorCheckExisting);
        return res.status(500).json({error: 'suabase error while checking existing bookmark'});
    }

    if(!checkExisting){
        const {data: uploadData, error: errorUploadData} = await supabase
        .from('bookmarks')
        .insert({user_id: user_id, journal_id: journalId})

        if(errorUploadData){
            console.error('error:', errorUploadData);
            return res.status(500).json({error: 'supabase error while uploading bookmark data.'});
        }
        return res.status(200).json({message: 'success'});
    } else {
        const {data: removeBookmark, error: errorRemoveBookmark} = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id',user_id)
        .eq('journal_id', journalId)

        if(errorRemoveBookmark){
            console.error('error while deleting bookmark', errorRemoveBookmark)
            return res.status(500).json({error: 'error removing bookmark'})
        }

        return res.status(200).json({message: 'deleted'})
    }  
})

router.get('/getBookmarks', async(req, res) => {
    const {before, limit, userId} = req.query;

    if(!userId) {
        console.error('no userId')
        return res.status(400).json({error: 'no userId!'})
    }

    let query = supabase
    .from('bookmarks')
    .select(`*,
        journals(
        id, created_at, user_id, content, title, 
        comment_count: comments(count),
        bookmark_count: bookmarks(count),

        users(name, user_email, image_url),

        like_count: likes(count),
        has_liked: likes!left(user_id),
        has_bookmarked: bookmarks!left(user_id)
        )
        `, {count: 'exact'})

    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parseInt(limit) + 1) //peek ahead to check if it has more bookmarks

    if(before) {
        query = query.lt('created_at', before)
    }
    
    const {data: bookmarks, error: errorBookmarks, count} = await query;
    // console.log(bookmarks)
    if(errorBookmarks){
        console.error('supabase error while getting bookmarks:', errorBookmarks);
        return res.status(500).json({error: 'error while fetchin bookmarks from database'});
    }

    // console.log(bookmarks)

    const formatted = bookmarks.map((bookmark) => ({
        ...bookmark,
        journals:{
            ...bookmark.journals,
            has_liked: Array.isArray(bookmark.journals?.has_liked) && bookmark?.journals.has_liked.length > 0,
            has_bookmarked: Array.isArray(bookmark?.journals.has_bookmarked) && bookmark?.journals.has_bookmarked.length > 0
        }
    }))

    const hasMore = bookmarks.length > parseInt(limit);
    const slicedData = hasMore ? formatted.slice(0, parseInt(limit)) : formatted;

    // console.log(bookmarks);
    
    return res.status(200).json({
        bookmarks: slicedData, 
        hasMore: hasMore, 
        totalBookmarks: before ? null : count});
})

router.post('/addFollows', upload, async(req, res) => {
    console.log(req.body);
    const {followerId, followingId} = req.body;
    

    if(!followerId && !followingId) return res.status(400).json({error: 'No followerId and followingId'});

    const {data: existing, error: errorExisting} = await supabase
    .from('follows')
    .select('*')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();

    if(errorExisting){
        console.error('error:', errorExisting);
        return res.status(500).json({error: 'supabase error while checking the existence of the followerId and followingId'});
    }
    if(existing){
        const {data: removeData, error: errorRemoveData} = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('following_id', followingId)

        if(errorRemoveData){
            console.error('error:', errorRemoveData);
            return res.status(500).json({error: 'supabase error while removing the existing follows data'});
        }
         return res.status(200).json({message: 'deleted follows data'});

    } else {
            const data = {
                follower_id: followerId,
                following_id: followingId,
            }

            const {data: inserData,  error: errorInserData} = await supabase
            .from('follows')
            .insert(data)

            if(errorInserData){
                console.error('error:', errorInserData)
                return res.status(500).json({error: 'error inserting follows data'});
            }

            return res.status(200).json({message: 'success'});
        }

})

router.get('/getFollowsData', async(req, res) => {
    const {userId, loggedInUserId} = req.query;
    if(!userId && !loggedInUserId) return res.status(400).json({error: 'userId or loggendUserId is undefined '});
    // console.log(req.query)
    try {
        const followersCountPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('following_id', userId);

        const followingCountPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('follower_id', userId)

        const isFollowingPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('follower_id', loggedInUserId)
        .eq('following_id', userId)

        const [followersCountResult, followingsCountResult, isFollowingResult] = await Promise.all([
            followersCountPromise, followingCountPromise, isFollowingPromise,
        ])


        const {count: followersCount, error: errorFollowers } = followersCountResult;
        const {count: followingsCount, error: errorFollowings} = followingsCountResult;
        const {count: isFollowingCount, error: errorIsfollowing} = isFollowingResult;

        if(errorFollowers || errorFollowings || errorIsfollowing){
            console.error('supabase error while fetching data:', errorFollowers.message, errorFollowings.message, errorIsfollowing.message)
            return res.status(500).json({error: 'failed to fetch data'})
        }

        return res.status(200).json({
            followersCount: followersCount,
            followingsCount: followingsCount,
            isFollowing: isFollowingCount > 0
        })

    } catch (error) {
        console.error('Error in Promise.all:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
    }

})

router.get('/getCountNotifications', async(req, res) =>{
    const {userId} = req.query;
    if(!userId) return res.attachment(400).json({error: 'no userid'});

    const {count, error} = await supabase
    .from('notifications')
    .select('id', {count: 'exact', head: true})
    .eq('receiver_id', userId)
    .eq('read', false)

    if(error){
        console.error('error fetching count in notifications table', error);
        return res.status(500).json({error: 'error fecthing count in notifications table'});
    }

    return res.status(200).json({count: count});
}) 

router.get('/getNotifications', async(req, res) =>{
    const {before, limit} = req.query;

    const token = req.headers?.authorization?.split(' ')[1];
    if(!token){
        console.error('not authorized')
        return res.status(400).json({error:'not authorized'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error:', errorAuthData.message);
        return res.status(500).json({error: 'error on checking authorization'})
    }

    const userId = authData?.user?.id;

    let notifQueryPromise = supabase
    .from('notifications')
    .select(
        `*,
        journals!journal_id(title, content, created_at, likes(count), comments(count), bookmarks(count)),
        users!sender_id(name, user_email, image_url, id)
        `
    )
    .eq('receiver_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parseInt(limit) + 1) //peek ahead for detecting if hasMore

    if(before){
        notifQueryPromise = notifQueryPromise.lt('created_at', before);
    }

    const notifQuery = await notifQueryPromise;

    const {data: notifQueryResult, error: errorNotifQuery} = notifQuery;

    if(errorNotifQuery){
        console.error('error while fetching data from notifcation table:', errorNotifQuery);
        return res.status(500).json({error: 'error fetching data from notifcation table'});
    }

    const journalIds = notifQueryResult.map((notif) => notif.journal_id);

    let hasLikedPromise;
    let hasBookmarkedPromise;
    if(journalIds){
        hasLikedPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)

        hasBookmarkedPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)  
    }

    const [hasLiked, hasBookMarked] = await Promise.all([
            hasLikedPromise,
            hasBookmarkedPromise
        ])

    const {data: hasLikedResult, error: errorHasLikedResult} = hasLiked;
    const {data: hasBookMarkedResult, error: errorHasBookmarkedResult} = hasBookMarked;


    if(errorHasLikedResult || errorHasBookmarkedResult){
        console.error('supabase error while fetching data:', errorHasLikedResult || errorHasBookmarkedResult);
    }

    const userHasLikedSet = new Set(hasLikedResult.map((likes) => likes.journal_id) || []);
    const userHasBookmarkedSet = new Set(hasBookMarkedResult.map((bookmarks) => bookmarks.journal_id) || []);

    const formatted = notifQueryResult.map((notif) => ({
        ...notif,
        hasLiked: userHasLikedSet?.has(notif.journal_id),
        hasBookMarked: userHasBookmarkedSet?.has(notif.journal_id)
    }))

    const hasMore = notifQueryResult.length > parseInt(limit);
    const slicedData = hasMore ? formatted.slice(0, parseInt(limit)) : formatted;

    return res.status(200).json(
        {
            hasMore: hasMore,
            data: slicedData,
        }
    )

})

router.post('/readNotification', async(req, res) => {
    const {notifId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token){
        console.error('no token!')
        return res.status(400).json({error: 'Not authorized'})
    }
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error authorizing user')
        return res.status(500).json({error: 'failed to authorized user'})
    }
    const userId = authData?.user?.id;

    const {data : readNotification, error: errorReadNotification} = await supabase
    .from('notifications')
    .update({
        read: true
    })
    .eq('receiver_id', userId)
    .eq('id', notifId)

    if(errorReadNotification){
        console.error('error updating the notification read: boolean', errorReadNotification)
        return res.status(500).json({error: 'error updating the notification read: boolean'})
    }

    return res.status(200).json({message: 'notification was read!'})
})
router.get('/getUnreadNotification', async(req, res) => {
    const token = req.headers?.authorization?.split(' ')[1];
    const {limit, before} = req.query;
    if(!token){
        console.error('no token provided!')
        return res.status(400).json({error: 'not authorized'})
    }
    const{ data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error checking user authorization:', errorAuthData.message)
        return res.status(500).json({error: 'error checking authorization'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 20){
        return res.status(400).json({error: 'limit must be between 1 and 20'});
    }

    const receiverId = authData?.user?.id;
    let query;

    query = supabase
    .from('notifications')
    .select(`
        *, 
        journals!journal_id(title, content, created_at, likes(count), comments(count), bookmarks(count)),
        users!sender_id(name, user_email, image_url, id)
        `)
    .eq('receiver_id', receiverId)
    .eq('read', false)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: getUnreadNotification, error: errorGetUnreadNotification} = await query;

    if(errorGetUnreadNotification){
        console.error('supabase error:', errorGetUnreadNotification.message);
        return res.status(500).json({error: 'supabase error while getting unread notification'})
    }
    
    const journalIds = getUnreadNotification.map((unreadNotification) => unreadNotification.journal_id) || [];

    let hasLikedPromise;
    let hasBookmarkedPromise;
    if(journalIds){
        hasLikedPromise = supabase
        .from('likes')
        .select('journal_id')
        .eq('user_id', receiverId)
        .in('journal_id', journalIds)

        hasBookmarkedPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .eq('user_id', receiverId)
        .in('journal_id', journalIds)
    }
    const [hasLiked, hasBookMarked] = await Promise.all([
        hasLikedPromise,
        hasBookmarkedPromise
    ])

    const {data: hasLikedResult, error: errorHasLikedResult} = hasLiked;
    const {data: hasBookMarkedResult, error: errorHasBookmarkedResult} = hasBookMarked;

    if(errorHasLikedResult || errorHasBookmarkedResult){
        console.error('error', errorHasLikedResult || errorHasBookmarkedResult)
        return res.status(500).json({error: 'supabase error on likes or bookmarks table'})
    }

    const userHasLikedSet = new Set(hasLikedResult.map((like) => like.journal_id) || []) ;
    const userHasBookmarkedSet = new Set(hasBookMarkedResult.map((bookmark) => bookmark.journal_id) || []);

    const formatted = getUnreadNotification.map((notification) =>({
        ...notification,
        hasLiked: userHasLikedSet?.has(notification?.journal_id),
        hasBookMarked: userHasBookmarkedSet?.has(notification?.journal_id)
    }))

    const hasMore = getUnreadNotification?.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json({
        data: slicedData,
        hasMore: hasMore
    })
})

router.delete('/deleteNotification/:notifId', async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    const {notifId} = req.params;

    if(!token){
        console.error('no token is provided!')
        return res.status(400).json({error: 'not auhtorized'})
    }
    if(!notifId){
        console.error('no notification id provided')
        return res.status(400).json({error: 'not notifId'})
    }

    const {data : authData, error: errorAuthData} = await supabase.auth.getUser(token);
    
    if(errorAuthData){
        console.error('error checking authorization:', errorAuthData);
        return res.status(500).json({error: 'Error checking user authorization'});
    }
    const userId = authData?.user?.id;

    const {data: deleteNotif, error: errorDeleteNotif} = await  supabase
    .from('notifications')
    .delete()
    .eq('receiver_id', userId)
    .eq('id', notifId)

    if(errorDeleteNotif){
        console.error('supabase error while deleting notification:', errorDeleteNotif.message);
        return res.status(500).json({error: 'supabase error while deleting notification'})
    }

    return res.status(200).json({message: 'success'});
})


router.post('/addViews', upload, async(req, res) => {
    const {journalId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];

    if(!journalId) {
        console.error('not journalId');
        return res.status(400).json({error: 'no journalId!'});
    }
    if(!token){
        console.error('error: no token provided!');
        return res.status(400).json({error: 'no token!'});
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error:', errorAuthData);
        return res.status(500).json({error: 'supabase error while checking user authentication'})
    }

    const viewerId = authData?.user?.id;

    const {data: addViews, error: errorAddViews} = await supabase
    .from('journal_views')
    .insert({
        viewer_id: viewerId,
        journal_id: journalId
    })

    if(errorAddViews){
        console.error('error:', errorAddViews.message);
        return res.status(500).json({error: 'error adding views'});
    }

    await supabase.rpc('increment_journal_view', {j_post_id: journalId});

    return res.status(200).json({message: 'success!'});

})

router.post('/updatePrivacy', upload, async(req, res) => {
    const token = req.headers?.authorization?.split(' ')[1];
    const {journalId, privacy} = req.body;
    // console.log(privacy)

    if(!token){
        console.error('error: no token!')
        return res.status(400).json({error: 'no token!'})
    }
    if(!journalId){
        console.error('no journalId')
        return res.status(400).json({error: 'no journalId'});
    }
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
    
    if(errorAuthData){
        console.error('supabase error while checking authorization:', errorAuthData.message);
        return res.status(500).json({error: 'supabase error while checking authorization'})
    }
    const userId = authData?.user?.id;

    const {data: updatePrivacy, error: errorUpdatePrivacy} = await supabase
    .from('journals')
    .update({privacy: privacy})
    .eq('id', journalId)
    .eq('user_id', userId)

    if(errorUpdatePrivacy){
        console.error('updating journal privacy error:', errorUpdatePrivacy);
        return res.status(500).json({error: 'error updating journal privacy'});
    }

    return res.status(200).json({message: 'success'});
})

router.post('/addCollections', upload, async(req, res) => {
    const token = req.headers?.authorization?.split(' ')[1];
    let {journalIds, title, description} = req.body;

    if(typeof journalIds === 'string'){
        journalIds = journalIds.split(',').map(id => id.trim()).filter(id => id !== '');
    }

    if(!token){
        console.error('no token provided!')
        return res.status(400).json({error: 'no token!'})
    }
    if(!title || !description){
        console.error('no collections title or description')
        return res.status(400).json({error: 'no collections title or description'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('error getting authorization', errorAuthData.message);
        return res.status(500).json({error: 'supabase error while checking authorization'})
    }

    const userId = authData.user.id;

    try {
        const {data: collections, error: errorCollections} = await supabase
        .from('collections')
        .insert({
            name: title,
            description: description,
            is_public: false,
            user_id: userId
        })
        .select()
        .single()

        if(errorCollections){
            console.error('error inserting data to database', errorCollections.message)
            return res.status(500).json({error: 'error inserting data to database'})
        }

        if(Array.isArray(journalIds) && journalIds.length > 0){
            const collectionJournals = journalIds.map(journalId => ({
                collection_id: collections.id,
                journal_id: journalId,
            }))

            const {data: linkedJournals, error: errorLinkedJournals} = await supabase
            .from('collection_journal')
            .insert(collectionJournals)

            if(errorLinkedJournals){
                console.error('error inserting linked journals', errorLinkedJournals.message);
                return res.status(500).json({error: 'error inserting linkedjournals'})
            }
        }

        return res.status(200).json({message: 'success'})
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
})

router.post('/updateCollection', upload, async(req, res) =>{
    let {journalIds, collectionId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];

    if(!token){
        console.error('no token')
        return res.status(400).json({error: 'no token!'})
    }

    if(!collectionId){
        console.error('no collection id')
        return res.status(400).json({error: 'no collection id'})
    }

    if(typeof journalIds === 'string'){
        journalIds = journalIds.split(',').map((id) => id.trim()).filter((id) => id !== '');
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('not authorized', errorAuthData.message);
        return res.status(500).json({error: 'supabase error while authorizing user'})
    }

    if(Array.isArray(journalIds) && journalIds.length > 0){
        const ids = journalIds.map((journalId) => ({
            journal_id: journalId,
            collection_id: collectionId
        }))
        
        console.log(ids);

        const {error: errorUpdatingCollection} = await supabase
            .from('collection_journal')
            .insert(ids)

        
        if(errorUpdatingCollection){
            console.error('error updating collections', errorUpdatingCollection.message)
            return res.status(500).json({eror: 'error updating collections'})
        }
    }

    return res.status(200).json({message: 'success'})

})

router.get('/getCollections', async(req, res) => {
    const {userId, before, limit} = req.query;
    
    if(!userId){
        console.error('error: no collectionid or userid')
        return res.status(400).json({error: 'no collection id or user id'})
    }

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit > 10 || parsedLimit < 1){
        console.error('limit should be between 1 to 10')
        return res.status(400).json({error: 'limit should only between 1 - 10'})
    }

    let query = supabase
    .from('collections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .order('id', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: getCollections, error: errorGetCollections} = await query;

    if(errorGetCollections){
        console.error('error getting collections:', errorGetCollections.message);
        return res.status(500).json({error: 'error getting collections'})
    }

    if(!getCollections || getCollections.length === 0){
        return res.status(200).json({data: [], hasMore: false})
    }

    const hasMore = getCollections.length > parsedLimit;
    const slicedData = hasMore ?  getCollections.slice(0, parsedLimit) : getCollections;

    return res.status(200).json({data: slicedData, hasMore: hasMore})
})

router.get('/getCollectionJournals', async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    const {collectionId, before, limit} = req.query;

    if(!collectionId) {
        console.error('no collectionId')
        return res.status(400).json({error: 'no collection ID'});
    }
    if(!token){
        console.error('not token!')
        return res.status(400).json({error: 'no token!'})
    }

    const parsedLimit = parseInt(limit);

    if(isNaN(parsedLimit) || parsedLimit > 10 || parsedLimit < 1){
        console.error('limit should only between 1-10');
        return res.status(400).json({error: 'Limit should only between 1-10'})
    }

    let authorization = supabase.auth.getUser(token);

    let query = supabase
    .from('collection_journal')
    .select('id, journals(title, created_at, id,content, users(id, image_url, user_email, name), comments!post_id(count), bookmarks!journal_id(count), likes!journal_id(count))')
    .eq('collection_id', collectionId)
    .limit(parsedLimit + 1)
    .order('id', {ascending: false})

    if(before){
        query = query.lt('id', before);
    }

    const [journaResult, authorizationResult] = await Promise.all([
        query, authorization
    ])

    const {data: journals, error: errorJournals} = journaResult;
    const {data: authData, error: errorAuthData} = authorizationResult;

    if(errorJournals || errorAuthData){
        console.error('supabase error while fetching data:', errorJournals.message || errorAuthData.message);
        return res.status(500).json({error: 'supabase error while fetching data'});
    }
    const userId = authData?.user?.id;
    const journalIds = journals?.map((journal) => journal.journals.id) || [];

    let hasLikedPromise;
    let hasBookmarkedPromise;

    if(journalIds){
        hasLikedPromise = supabase
        .from('likes')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)

        hasBookmarkedPromise = supabase
        .from('bookmarks')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('user_id', userId)
    }

    const [hasLikedResult, hasBookMarkedResult] = await Promise.all([hasLikedPromise, hasBookmarkedPromise]);

    const {data: hasLiked, error: errorHasLiked} = hasLikedResult;
    const {data: hasBookMarked, error: errorHasbookmarked} = hasBookMarkedResult;

    if(errorHasLiked || errorHasbookmarked){
        console.error('error fetching data',  errorHasLiked || errorHasbookmarked);
        return res.status(500).json({error: 'error fetching data'});
    }

    const userHasLikedSet = new Set(hasLiked.map((journal) => journal.journal_id) || []);
    const userHasBookmarkedSet = new Set(hasBookMarked.map((bookmark) => bookmark.journal_id) || []);

    const formatted  = journals.map((journal) => ({
        ...journal,
        hasLiked: userHasLikedSet?.has(journal?.journals.id),
        hasBookMarked: userHasBookmarkedSet?.has(journal?.journals.id)
    }))

    const hasMore = journals.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json({data: slicedData, hasMore: hasMore})

})

router.get('/getNotCollectedPost', async(req, res) => {
    const {before, limit, userId, collectionId} = req.query;

    const parsedLimit = parseInt(limit);
    if(isNaN(parsedLimit) || parsedLimit > 10 || parsedLimit < 1){
        console.error('limit should be between 1 to 10');
        return res.status(500).json({error: 'limit should be between 1 to 10'});
    }

    if(!userId){
        console.error('no userId!');
        return res.status(400).json({error: 'no userId'});
    }
    if(!collectionId){
        console.error('no collectionId');
        return res.status(400).json({error: 'no collectionId'})
    }

    let query = supabase
    .from('journals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .limit(parsedLimit + 1)

    if(before){
        query = query.lt('created_at', before);
    }

    const {data: journals, error: errorJournals} = await query;
    

    if(errorJournals){
        console.error('error:', errorJournals.message);
        return res.status(500).json({error: 'error fetching journals or collectionJournals Ids'})
    }
    
    const journalIds = journals.map((journal) => journal.id) || [];

    let collectedJournals;
    if(journalIds){
        collectedJournals = supabase
        .from('collection_journal')
        .select('journal_id')
        .in('journal_id', journalIds)
        .eq('collection_id', collectionId)
    }

    const {data: collectedJournalIds, error: errorCollectedJournalIds} = await collectedJournals;

    if(errorCollectedJournalIds){
        console.error('error:', errorCollectedJournalIds.message);
        return res.status(500).json({error: 'error fetching collected journals'})
    }

    const journalIdSet = new Set(collectedJournalIds.map((j) => j.journal_id)  || []);

    const formatted = journals.map((journal) => ({
        ...journal,
        hasCollected: journalIdSet.has(journal.id)
    }))

    const hasMore = journals.length > parsedLimit;
    const slicedData = hasMore ? formatted.slice(0, parsedLimit) : formatted;

    return res.status(200).json({data: slicedData, hasMore: hasMore});
})

router.delete('/deleteCollection/:collectionId', async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    const {collectionId} = req.params;

    if(!token){
        console.error('no token!')
        return res.status(400).json({error: 'no token!'});
    }
    if(!collectionId){
        console.error('no collectionId');
        return res.status(400).json({error: 'no collectionId'});
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error:', errorAuthData.message);
        return res.status(500).json({error: 'error authorizing user!'})
    }

    const userId = authData.user.id;

    const {data: deleteCollection, error: errorDeleteCollection} = await supabase
    .from('collections')
    .delete()
    .eq('id', collectionId)
    .eq('user_id', userId)

    if(errorDeleteCollection){
        console.error('supabase error while deleting collections', errorDeleteCollection.message);
        return res.status(500).json({error: 'error deleting colletion'});
    }

    return res.status(200).json({message: 'delete successful'});
})

export default router;