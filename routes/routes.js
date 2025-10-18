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

export default router;