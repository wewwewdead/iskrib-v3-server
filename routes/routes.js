import express from "express";
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
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token){
        return res.status(400).json({error: 'No token provided'});
    }
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
    // if(authData){
    //     console.log(authData)
    // }

    if(errorAuthData){
        return res.status(500).json({error: errorAuthData.message});
    }
    const {data: userData, error: errorUserData} = await supabase
    .from('users')
    .select('*')
    .eq('id', authData?.user?.id)

    if(errorUserData){
        return res.status(500).json({error: errorUserData.message});
    }
    return res.status(200).json({userData});
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
        // webBuffer = await sharp(image.buffer)
        // .webp({quality: 80})
        // .toBuffer();

        // const folderName = `user_${authData.user.id}`
        // const fileName = `${authData?.user.id}_${crypto.randomUUID()}.webp`;
        // const filePath = `${folderName}/${fileName}`;

        // const {data: uploadImage, error: errorUploadImage} = await supabase.storage
        // .from('avatars')
        // .upload(filePath, webBuffer, {
        //     contentType: 'image/webp',
        //     upsert: true
        // });
        // if(errorUploadImage){
        //     return res.status(500).json({error: errorUploadImage})
        // }

        // const {data: dataUrl} = supabase.storage
        // .from('avatars')
        // .getPublicUrl(filePath);
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

router.get('/journals', async(req, res) => {
    const {limit = 5, before} = req.query;
    // console.log(before)

    try {
        let query = supabase
        .from('journals')
        .select('*, users(*), likes(*), comments(count)')
        .order('created_at', {ascending: false})
        .limit(parseInt(limit) + 1)

        //if cursor(before) exist then fetch only the older post;
        if(before) {
            query = query.lt('created_at', before); // fetch only less than before(dates)
        }

        const {data, error} = await query;

        if(error) {
            console.error('supabase error while fetching journals', error)
            return res.status(500).json({error: 'error fetching journals'});
        }

        const hasMore = data.length > parseInt(limit);
        const journaldData = hasMore ? data.slice(0, parseInt(limit)) : data;

        res.status(200).json({data: journaldData, hasMore: hasMore}); 
    } catch (error) {
        console.error('Error fetching posts:', error);
        return res.status(500).json({ error: error.message });
    }
})

router.post('/like', async(req, res) =>{
    const {journalId} = req.body;
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token) return res.status(400).json({error: 'Not Authorized'});
    if(!journalId) return res.status(400).json({error: 'No post Id!'})

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData) {
        console.error('supabae error while checking users authentication', errorAuthData)
        return res.status(500).json({error: 'error checking user authentication'})
    };

    const userId = authData.user.id;

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
        const {data, error} = await supabase
        .from('likes')
        .insert({user_id: userId, journal_id: journalId})

        if(error) return res.status(500).json({error: error});

        return res.status(200).json({message: 'liked'});
    } else {
        const userId = authData.user.id;
        const {data, error} = await supabase
        .from('likes')
        .delete()
        .eq('user_id', userId)
        .eq('journal_id', journalId)

        if(error) {
            console.error('supabase error while inserting/ deleing like', error)
            return res.status(500).json({error: 'error add like'});
        }

        return res.status(200).json({message: 'unliked'});
    }

})

router.post('/addComment',upload, async(req, res) =>{
    const token = req.headers?.authorization?.split(' ')[1];
    if(!token) return res.status(400).json({error: 'Not authorized'});
    console.log(req.body)
    const {comments, postId} = req.body;

    if(!comments || !postId){
        return res.status(400).json({error: 'no postId or Comment recieve'});
    }
    const{data: authData, errorAuthData} = await supabase.auth.getUser(token)

    if(errorAuthData) {
        console.error('supabae error while checking users authentication', errorAuthData)
        return res.status(500).json({error: 'error checking user authentication'})
    };

    const {data: addComment, error: errorAddComment} = await supabase
    .from('comments')
    .insert({
        comment: comments,
        post_id: postId,
        user_id: authData?.user?.id
    })

    if(errorAddComment){
        console.error('supabase error while inserting comments', errorAddComment)
        return res.status(500).json({error: 'error adding comments'});
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

// router.get('/getLikes', async(req, res) => {
//     const token = req.headers?.authorization?.split(' ')[1];
//     console.log(token)

//     if(!token){
//         return res.status(400).json({error: 'Not authorized'});
//     }
//     const {data: userData, error: userDataError} = await supabase.auth.getUser(token);

//     if(userDataError){
//         return res.status(500).json({error: userDataError});
//     }
//     const userId = userData.user.id;
//     const {data, error} = await supabase
//     .from('likes')
//     .select('journal_id')
//     .eq('user_id', userId)

//     if(error){
//         return res.status(500).json({error: error})
//     }
//     console.log(data)
//     return res.status(200).json({data: data});

// })
export default router;