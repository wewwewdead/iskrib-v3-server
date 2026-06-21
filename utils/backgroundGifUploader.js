import sharp from "sharp";
import supabase from "../services/supabase.js";

// Animated GIFs MUST NOT pass through the Sharp/WebP variant pipeline used for
// static images — re-encoding flattens them to a single frame and destroys the
// animation. So GIF bytes are uploaded verbatim; only the (static) poster is
// processed with Sharp.

export const GIF_MAGIC_SIGNATURES = ["GIF87a", "GIF89a"];
export const MAX_GIF_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_POSTER_BYTES = 2 * 1024 * 1024; // 2 MB
const BACKGROUND_BUCKET = "background";

/**
 * A real GIF starts with the ASCII header "GIF87a" or "GIF89a". Checking the
 * magic bytes (not just the mimetype/extension, which a client controls) is the
 * security-relevant validation.
 */
export const hasValidGifMagic = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
    return GIF_MAGIC_SIGNATURES.includes(buffer.toString("ascii", 0, 6));
};

/** Does the multer file look like a GIF by mimetype or filename? */
export const isGifUpload = (file) => {
    if (!file) return false;
    const name = typeof file.originalname === "string" ? file.originalname.toLowerCase() : "";
    return file.mimetype === "image/gif" || name.endsWith(".gif");
};

/**
 * Upload the raw GIF bytes (as-is, contentType image/gif) and an optional static
 * poster (re-encoded to WebP) to the background bucket. Returns the public URLs.
 * Poster upload failures are non-fatal — a GIF without a poster still works (it
 * just won't have a reduced-motion fallback).
 */
export const uploadBackgroundGifAssets = async (gifBuffer, posterBuffer, userId) => {
    const folder = `user_id_${userId}`;
    const base = `${Date.now()}_${crypto.randomUUID()}`;
    const gifPath = `${folder}/${base}.gif`;

    const { error: gifError } = await supabase.storage
        .from(BACKGROUND_BUCKET)
        .upload(gifPath, gifBuffer, {
            contentType: "image/gif",
            cacheControl: "31536000",
            upsert: true,
        });
    if (gifError) {
        console.error("supabase error uploading background gif", gifError);
        throw { status: 500, error: "error uploading background gif" };
    }

    const { data: gifUrlData } = supabase.storage.from(BACKGROUND_BUCKET).getPublicUrl(gifPath);
    const gifUrl = gifUrlData?.publicUrl || null;
    if (!gifUrl) {
        throw { status: 500, error: "error resolving background gif url" };
    }

    let posterUrl = null;
    if (posterBuffer) {
        try {
            const posterRendered = await sharp(posterBuffer)
                .rotate()
                .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
                .webp({ quality: 80, effort: 4 })
                .toBuffer();
            const posterPath = `${folder}/${base}__poster.webp`;
            const { error: posterError } = await supabase.storage
                .from(BACKGROUND_BUCKET)
                .upload(posterPath, posterRendered, {
                    contentType: "image/webp",
                    cacheControl: "31536000",
                    upsert: true,
                });
            if (posterError) {
                console.error("supabase error uploading background poster", posterError);
            } else {
                const { data: posterUrlData } = supabase.storage
                    .from(BACKGROUND_BUCKET)
                    .getPublicUrl(posterPath);
                posterUrl = posterUrlData?.publicUrl || null;
            }
        } catch (err) {
            console.error("error processing background poster", err);
        }
    }

    return { gifUrl, posterUrl };
};
