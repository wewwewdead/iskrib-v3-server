import {
    isGifUpload,
    hasValidGifMagic,
    uploadBackgroundGifAssets,
    MAX_GIF_BYTES,
    MAX_POSTER_BYTES,
} from "../utils/backgroundGifUploader.js";

/**
 * Validate and store an animated GIF profile background.
 *
 * GIFs are background-only. Validation is intentionally strict and server-side
 * (client accept filters are not security):
 *   - GIF file required
 *   - mimetype image/gif OR filename ends with .gif
 *   - size within the 8MB limit
 *   - valid GIF87a / GIF89a magic bytes
 * An oversized poster is dropped (non-fatal) rather than rejecting the upload.
 * Returns { gifUrl, posterUrl }.
 */
export const uploadBackgroundGifService = async (userId, gifFile, posterFile) => {
    if (!userId) {
        throw { status: 400, error: "userId is undefined" };
    }
    if (!gifFile || !gifFile.buffer) {
        throw { status: 400, error: "gif file is required" };
    }
    if (!isGifUpload(gifFile)) {
        throw { status: 400, error: "file must be a GIF" };
    }
    if (
        (typeof gifFile.size === "number" && gifFile.size > MAX_GIF_BYTES) ||
        gifFile.buffer.length > MAX_GIF_BYTES
    ) {
        throw { status: 400, error: "gif exceeds the 8MB limit" };
    }
    if (!hasValidGifMagic(gifFile.buffer)) {
        throw { status: 400, error: "invalid GIF file" };
    }

    let posterBuffer = null;
    if (posterFile && posterFile.buffer) {
        const posterTooLarge =
            typeof posterFile.size === "number" && posterFile.size > MAX_POSTER_BYTES;
        if (!posterTooLarge && posterFile.buffer.length <= MAX_POSTER_BYTES) {
            posterBuffer = posterFile.buffer;
        }
    }

    const result = await uploadBackgroundGifAssets(gifFile.buffer, posterBuffer, userId);
    if (!result?.gifUrl) {
        throw { status: 500, error: "error uploading background gif" };
    }
    return result;
};
