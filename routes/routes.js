import express from "express";
import supabase from "../services/supabase.js";
import multer from "multer";
import sharp from 'sharp';

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {fileSize: 10 * 1024 * 1024},
}).single('image');

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
    const {bio, name} = req.body;
    const image = req.file;

    const token = req.headers.authorization.split(' ')[1];
    if(!token){
        return res.status(400).json({error: 'no token provided'})
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token)

    if(errorAuthData){
        return res.status(4500).json({error: errorAuthData})
    }

    let webBuffer = null
    let publicUrl = null
    if(image){
        webBuffer = await sharp(image.buffer)
        .webp({quality: 80})
        .toBuffer();

        const folderName = `user_${authData.user.id}`
        const fileName = `${authData?.user.id}_${crypto.randomUUID()}.webp`;
        const filePath = `${folderName}/${fileName}`;

        const {data: uploadImage, error: errorUploadImage} = await supabase.storage
        .from('avatars')
        .upload(filePath, webBuffer, {
            contentType: 'image/webp',
            upsert: true
        });
        if(errorUploadImage){
            return res.status(500).json({error: errorUploadImage})
        }

        const {data: dataUrl} = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

        publicUrl = dataUrl.publicUrl;
    }

    const data = {
        bio: bio,
        name: name,
        id: authData.user.id,
        imageUrl: publicUrl ? publicUrl : null
    }
    const {data: uploadData, error:errorUploadData} = await supabase
    .from('users')
    .insert([data])

    if(errorUploadData){
        return res.status(500).json({error: errorUploadData})
    }
    return res.status(200).json({success: uploadData})
})
router.post('/save-journal-image', upload, async(req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if(!token) return res.status(400).json({error: 'Not authorized'})
    
    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);
    if(errorAuthData) return res.status(400).json({error: errorAuthData.message});

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
    const folderName = `user_id_${user_id}`;
    const fileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
    const filePath = `${folderName}/${fileName}`;

    const {data: uploadImage, error: errorUploadImage} = await supabase.storage
    .from('journal-images')
    .upload(filePath, img_buffer, {
        contentType: 'image/webp',
        upsert: true
    })
    if(errorUploadImage){
        return res.status(500).json({error: errorUploadImage});
    }
    const {data: data_url} = supabase.storage
    .from('journal-images')
    .getPublicUrl(filePath)
    
    if(data_url){
        img_url = data_url.publicUrl;
        return res.status(200).json({img_url: img_url})
    } else {
        res.status(500).json({error: 'no image url available'})
    }
})
router.post('/delete-journal-images', async(req, res) =>{
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const {filepath} = req.body;
        if(!token){
            return res.status(400).json({error: 'No token provided'})
        }

        if(!filepath){
            return res.status(400).json({error: 'Filepath not received!'})
        }
        const {error} = await supabase.storage
        .from('journal-images')
        .remove([filepath]);

        if(error) throw error;
        return res.status(200).json({message: 'Image deleted successfully'});
        } catch (error) {
            console.error('Delete image error', error);
            res.status(400).json({error: 'Failed to delete image'})
        }
})
router.post('/save-journal', upload, async(req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if(!token) return res.status(400).json({error: 'No token provided'});

        const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

        if(errorAuthData) return res.status(400).json({error: errorAuthData})
        
        const userId = authData.user.id
        const {content, title} = req.body;
        if(!content || !title) {
            res.status(400).json({error: 'Title or content is not available'});
        }
        const {data, error} = await supabase
        .from('journals')
        .insert({user_id: userId, content: content, title: title});

        if(error) return res.status(500).json({error: error})
        
        return res.status(200).json({message: 'Content saved successfully!'})
    } catch (error) {
        console.error('Failed to save editor state:', error);
    }
})

router.get('/journals', async(req, res) => {
    const {limit = 10, before} = req.query;

    try {
        let query = supabase
        .from('journals')
        .select('*, users(*)')
        .order('created_at', {ascending: false})
        .limit(parseInt(limit))

        //if cursor(before) exist then fetch only the older post;
        if(before) {
            query = query.lt('created_at', before); // fetch only less than before(dates)
        }

        const {data, error} = await query;

        if(error) throw new Error(error.message);

        res.status(200).json({data, hasMore: data.length === parseInt(limit)}); 
    } catch (error) {
        console.error('Error fetching posts:', error);
        return res.status(500).json({ error: error.message });
    }
})
export default router;