import sharp from 'sharp';
import supabase from "../services/supabase.js";
import { MEDIA_VARIANT_CONFIG, createVariantFileNames } from "./mediaVariants.js";

export const imageUploader = async(file, userId, bucket) =>{
    if(!file){
        throw new Error('no file received');
    }

    const sourceBuffer = Buffer.isBuffer(file) ? file : file?.buffer;
    if(!sourceBuffer){
        throw new Error('invalid file payload');
    }

    const folderName = `user_id_${userId}`;
    const baseFileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
    const variantFileNames = createVariantFileNames(baseFileName);
    const bucketVariants = MEDIA_VARIANT_CONFIG[bucket];
    if(!bucketVariants){
        throw new Error(`unsupported bucket for upload: ${bucket}`);
    }

    const variantEntries = Object.entries(bucketVariants);
    const renderedVariants = await Promise.all(
        variantEntries.map(async([variantKey, sizeConfig]) => {
            const renderedBuffer = await sharp(sourceBuffer)
                .rotate()
                .resize(sizeConfig.width, sizeConfig.height, { fit: sizeConfig.fit, withoutEnlargement: true })
                .webp({ quality: variantKey === 'original' ? 82 : 78, effort: 4 })
                .toBuffer();

            return {
                variantKey,
                buffer: renderedBuffer,
                filePath: `${folderName}/${variantFileNames[variantKey]}`
            };
        })
    );

    const uploadResults = await Promise.all(
        renderedVariants.map(({ filePath, buffer }) => supabase.storage
            .from(bucket)
            .upload(filePath, buffer, {
                contentType: 'image/webp',
                cacheControl: '31536000',
                upsert: true
            }))
    );

    const failedUpload = uploadResults.find((result) => result.error);
    if(failedUpload?.error){
        console.error('supabase error while uploading image variants to supabase bucket', failedUpload.error);
        throw new Error('error uploading image into supabase bucket');
    }

    const detailVariant = renderedVariants.find((entry) => entry.variantKey === 'detail');
    const {data: data_url} = supabase.storage
        .from(bucket)
        .getPublicUrl(detailVariant?.filePath || `${folderName}/${variantFileNames.detail}`);

    if(data_url?.publicUrl){
        return data_url.publicUrl;
    }

    throw new Error('Error uploading the image');
}
