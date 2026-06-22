import supabase from "./supabase.js";
import {
    processGif,
    hasValidGifMagic,
    MAX_GIF_BYTES,
    AnimatedBackgroundError,
} from "./animatedBackgroundProcessor.js";
import { isGifUpload, uploadBackgroundGifAssets } from "../utils/backgroundGifUploader.js";

/**
 * Profile animated-background upload orchestration.
 *
 * Flow:
 *   1. Validate the uploaded GIF (presence, mimetype/ext, size, magic bytes).
 *   2. Convert it to optimized assets (poster + MP4 + optional WebM) via the
 *      isolated processor.
 *   3. Upload every output to the user's storage folder.
 *   4. Return an `animated_background` manifest the client stores in
 *      `users.background` and renders with a dedicated <video> layer.
 *
 * If ffmpeg is unavailable or the encode fails, we DON'T reject the upload —
 * we fall back to the legacy GIF path (raw GIF + static poster) and mark the
 * manifest's processing status so the client renders the GIF compatibly (single
 * non-blurred layer) instead of breaking the feature. A genuinely invalid or
 * abusive GIF (bad signature, too large/long/heavy) is still rejected.
 */

export const MANIFEST_TYPE = "animated_background";
export const MANIFEST_VERSION = 1;
const BACKGROUND_BUCKET = "background";

// AnimatedBackgroundError codes that mean "the user's file is the problem" —
// these reject the upload. Anything else (encode_failed / ffmpeg missing) is an
// infrastructure problem we degrade around.
const USER_FACING_ERROR_CODES = new Set([
    "invalid_gif",
    "too_large",
    "too_long",
    "too_many_frames",
    "too_heavy",
]);

const DEFAULT_PLAYBACK = { loop: true, muted: true, objectFit: "cover", position: "center" };

const buildVideoManifest = ({
    originalUrl,
    posterUrl,
    mp4Url,
    webmUrl,
    width,
    height,
    durationMs,
    bytes,
}) => ({
    type: MANIFEST_TYPE,
    version: MANIFEST_VERSION,
    mediaType: "video",
    sourceMediaType: "gif",
    originalUrl: originalUrl || null,
    posterUrl: posterUrl || null,
    mp4Url: mp4Url || null,
    webmUrl: webmUrl || null,
    width: width || null,
    height: height || null,
    durationMs: durationMs || null,
    bytes: bytes || null,
    playback: { ...DEFAULT_PLAYBACK },
    processing: { status: "ready", error: null },
});

const buildFallbackManifest = ({ originalUrl, posterUrl, originalBytes, errorCode }) => ({
    type: MANIFEST_TYPE,
    version: MANIFEST_VERSION,
    // mediaType "gif" tells the client to render the GIF compatibly (single,
    // non-blurred layer) rather than expecting a <video>.
    mediaType: "gif",
    sourceMediaType: "gif",
    originalUrl: originalUrl || null,
    posterUrl: posterUrl || null,
    mp4Url: null,
    webmUrl: null,
    width: null,
    height: null,
    durationMs: null,
    bytes: { original: originalBytes || null, poster: null, mp4: null, webm: null },
    playback: { ...DEFAULT_PLAYBACK },
    processing: { status: "error", error: errorCode || "processing_failed" },
});

const uploadBuffer = async (path, buffer, contentType) => {
    const { error } = await supabase.storage.from(BACKGROUND_BUCKET).upload(path, buffer, {
        contentType,
        cacheControl: "31536000",
        upsert: true,
    });
    if (error) {
        console.error(`[profileBackground] upload failed path=${path}:`, error.message);
        throw { status: 500, error: "error uploading background asset" };
    }
    const { data } = supabase.storage.from(BACKGROUND_BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
};

/**
 * Validate + process an uploaded animated background.
 * @returns {Promise<object>} the manifest to persist in users.background.
 */
export const processAnimatedBackgroundUpload = async (userId, gifFile, posterFile) => {
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
        throw { status: 400, error: "gif exceeds the size limit" };
    }
    if (!hasValidGifMagic(gifFile.buffer)) {
        throw { status: 400, error: "invalid GIF file" };
    }

    const folder = `user_id_${userId}`;
    const base = `${Date.now()}_${crypto.randomUUID()}`;

    try {
        const result = await processGif(gifFile.buffer, { withWebm: true });

        // Upload the required outputs first; webm is best-effort.
        const originalUrl = await uploadBuffer(`${folder}/${base}.gif`, gifFile.buffer, "image/gif");
        const posterUrl = await uploadBuffer(`${folder}/${base}__poster.webp`, result.poster, "image/webp");
        const mp4Url = await uploadBuffer(`${folder}/${base}.mp4`, result.mp4, "video/mp4");

        let webmUrl = null;
        if (result.webm) {
            try {
                webmUrl = await uploadBuffer(`${folder}/${base}.webm`, result.webm, "video/webm");
            } catch {
                webmUrl = null; // mp4 is enough; never block on webm
            }
        }

        return buildVideoManifest({
            originalUrl,
            posterUrl,
            mp4Url,
            webmUrl,
            width: result.width,
            height: result.height,
            durationMs: result.durationMs,
            bytes: {
                original: gifFile.buffer.length,
                poster: result.bytes.poster,
                mp4: result.bytes.mp4,
                webm: result.bytes.webm,
            },
        });
    } catch (err) {
        // A genuinely bad/abusive file is the caller's problem — reject it.
        if (err instanceof AnimatedBackgroundError && USER_FACING_ERROR_CODES.has(err.code)) {
            throw { status: err.status || 400, error: err.message };
        }

        // ffmpeg missing or encode/upload failure → degrade to the legacy GIF
        // path so the feature still works (just without the optimized video).
        const errorCode = err?.code || "processing_failed";
        console.warn(`[profileBackground] animated processing failed (${errorCode}); using legacy GIF fallback`);
        try {
            const fallback = await uploadBackgroundGifAssets(
                gifFile.buffer,
                posterFile && posterFile.buffer ? posterFile.buffer : null,
                userId
            );
            return buildFallbackManifest({
                originalUrl: fallback.gifUrl,
                posterUrl: fallback.posterUrl,
                originalBytes: gifFile.buffer.length,
                errorCode,
            });
        } catch (fallbackErr) {
            console.error("[profileBackground] legacy GIF fallback also failed:", fallbackErr);
            throw { status: 500, error: "error processing background gif" };
        }
    }
};

// ── Cleanup of generated assets ──────────────────────────────────────────────

const urlFromCss = (value) => {
    if (typeof value !== "string") return null;
    const match = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(value);
    return match ? match[1] : null;
};

/**
 * Collect every storage URL a background object/manifest references. Handles
 * both the new manifest (originalUrl/posterUrl/mp4Url/webmUrl) and legacy CSS
 * forms (backgroundImage / backgroundPosterImage as url(...)).
 */
export const collectBackgroundAssetUrls = (background) => {
    const urls = new Set();
    if (!background || typeof background !== "object") return [];
    for (const key of ["originalUrl", "posterUrl", "mp4Url", "webmUrl"]) {
        if (typeof background[key] === "string" && background[key]) urls.add(background[key]);
    }
    for (const key of ["backgroundImage", "backgroundPosterImage"]) {
        const u = urlFromCss(background[key]);
        if (u) urls.add(u);
    }
    return [...urls];
};

/**
 * Map a public Supabase URL to its storage path inside the background bucket,
 * but ONLY when that path lives under this user's own prefix. Returns null for
 * anything else, so cleanup can never touch another user's or an arbitrary file.
 */
export const storagePathForUserUrl = (url, userId) => {
    if (typeof url !== "string") return null;
    const marker = `/${BACKGROUND_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    let path = url.slice(idx + marker.length).split("?")[0];
    try {
        path = decodeURIComponent(path);
    } catch {
        /* keep raw */
    }
    const prefix = `user_id_${userId}/`;
    return path.startsWith(prefix) ? path : null;
};

/**
 * Best-effort removal of the generated assets referenced by `oldBackground`
 * that are NOT still referenced by `newBackground`. User-scoped (only deletes
 * under the user's own storage prefix) and never throws — a cleanup failure must
 * never block a profile save that has already persisted the new background.
 */
export const deleteOldBackgroundAssets = async (userId, oldBackground, newBackground) => {
    try {
        if (!userId) return { removed: 0, ok: true };
        const oldUrls = collectBackgroundAssetUrls(oldBackground);
        if (!oldUrls.length) return { removed: 0, ok: true };

        const keep = new Set(collectBackgroundAssetUrls(newBackground));
        const paths = [];
        for (const url of oldUrls) {
            if (keep.has(url)) continue;
            const path = storagePathForUserUrl(url, userId);
            if (path) paths.push(path);
        }
        if (!paths.length) return { removed: 0, ok: true };

        const { error } = await supabase.storage.from(BACKGROUND_BUCKET).remove(paths);
        if (error) {
            console.warn(`[profileBackground] asset cleanup failed user=${userId}:`, error.message);
            return { removed: 0, ok: false };
        }
        return { removed: paths.length, ok: true };
    } catch (err) {
        console.warn(`[profileBackground] asset cleanup threw user=${userId}:`, err?.message || err);
        return { removed: 0, ok: false };
    }
};
