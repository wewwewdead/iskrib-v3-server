import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

/**
 * Animated background processor.
 *
 * Converts an uploaded GIF into optimized, hardware-decodable background assets
 * (poster + MP4/H.264 + optional WebM) so the profile page can render a single
 * <video> layer instead of an expensive animated CSS background. This is the
 * production rendering path: an animated GIF as a CSS background (especially
 * blurred / under a backdrop-filter) forces costly decode+paint+composite work
 * on mobile Safari, which is what made iPhones run hot.
 *
 * This module does NOT touch Supabase or the database — it only inspects the
 * GIF, validates it, and runs ffmpeg/Sharp against temp files, returning raw
 * output buffers. profileBackgroundService.js handles upload + manifest. Keeping
 * the heavy work isolated here means it can later move into a worker/queue with
 * no change to the controller or the client.
 *
 * FFmpeg is resolved defensively at runtime (env override → ffmpeg-static →
 * `ffmpeg` on PATH). If no usable ffmpeg is available the caller is told (via a
 * thrown FfmpegUnavailableError) and falls back to the legacy GIF path so the
 * feature degrades gracefully instead of breaking.
 */

// ── Limits (security + abuse) ────────────────────────────────────────────────
// 8 MB matches the upload multer cap and the legacy GIF fallback pipeline, so
// the primary and fallback paths agree on a single ceiling.
export const MAX_GIF_BYTES = 8 * 1024 * 1024; // 8 MB original
export const HARD_MAX_DIMENSION = 1920; // reject anything larger on a side
export const TARGET_MAX_DIMENSION = 1280; // downscale longest side to this
export const MAX_DURATION_MS = 8000; // 8 seconds
export const MAX_FRAMES = 600; // frame-count ceiling
export const MAX_ANIMATED_MEGAPIXELS = 900; // frames * w * h / 1e6 ceiling
export const MAX_OUTPUT_BYTES = 25 * 1024 * 1024; // sanity cap per output

// Per-encode timeout. mp4 of a downscaled <=8s clip is fast; the cap is just a
// guard against a hung/abusive job.
const FFMPEG_TIMEOUT_MS = 45 * 1000;
const FFMPEG_PROBE_TIMEOUT_MS = 5 * 1000;

// GIF magic bytes — a real GIF starts with "GIF87a" or "GIF89a". Validating the
// signature (not just the mimetype/extension, which the client controls) is the
// security-relevant check.
export const GIF_MAGIC_SIGNATURES = ["GIF87a", "GIF89a"];

export const hasValidGifMagic = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
    return GIF_MAGIC_SIGNATURES.includes(buffer.toString("ascii", 0, 6));
};

export class AnimatedBackgroundError extends Error {
    constructor(message, { status = 400, code = "invalid_gif" } = {}) {
        super(message);
        this.name = "AnimatedBackgroundError";
        this.status = status;
        this.code = code;
    }
}

export class FfmpegUnavailableError extends Error {
    constructor(message = "ffmpeg is not available") {
        super(message);
        this.name = "FfmpegUnavailableError";
        this.code = "ffmpeg_unavailable";
    }
}

// ── Pure helpers (unit-testable without ffmpeg) ──────────────────────────────

/**
 * Read GIF dimensions, frame count, and total duration from the buffer using
 * Sharp (libvips reads animated GIFs without re-encoding them). Returns
 * { width, height, frames, durationMs }. Throws AnimatedBackgroundError if the
 * buffer can't be read as an animated image.
 */
export const inspectGif = async (gifBuffer) => {
    let meta;
    try {
        meta = await sharp(gifBuffer, { animated: true }).metadata();
    } catch {
        throw new AnimatedBackgroundError("could not read GIF metadata");
    }

    const width = Number(meta?.width) || 0;
    // For an animated image Sharp reports `pageHeight` as the per-frame height
    // (the full `height` is pages stacked). Prefer pageHeight when present.
    const height = Number(meta?.pageHeight) || Number(meta?.height) || 0;
    const frames = Number(meta?.pages) || 1;

    let durationMs = 0;
    if (Array.isArray(meta?.delay) && meta.delay.length) {
        durationMs = meta.delay.reduce((sum, d) => sum + (Number(d) || 0), 0);
    }

    if (!width || !height) {
        throw new AnimatedBackgroundError("GIF has invalid dimensions");
    }

    return { width, height, frames, durationMs };
};

/**
 * Validate the inspected GIF against the abuse limits. Throws
 * AnimatedBackgroundError on the first violation.
 */
export const validateGifConstraints = ({ width, height, frames, durationMs }) => {
    if (width > HARD_MAX_DIMENSION || height > HARD_MAX_DIMENSION) {
        throw new AnimatedBackgroundError(
            `GIF dimensions exceed ${HARD_MAX_DIMENSION}px`,
            { code: "too_large" }
        );
    }
    if (durationMs > MAX_DURATION_MS) {
        throw new AnimatedBackgroundError(
            `GIF is longer than ${MAX_DURATION_MS / 1000}s`,
            { code: "too_long" }
        );
    }
    if (frames > MAX_FRAMES) {
        throw new AnimatedBackgroundError(`GIF has too many frames`, { code: "too_many_frames" });
    }
    const megapixels = (frames * width * height) / 1e6;
    if (megapixels > MAX_ANIMATED_MEGAPIXELS) {
        throw new AnimatedBackgroundError("GIF is too heavy to process", { code: "too_heavy" });
    }
    return true;
};

/**
 * Compute the target output dimensions: scale the longest side down to at most
 * TARGET_MAX_DIMENSION (never upscale), then force both sides even (H.264/VP9
 * require even dimensions). Always returns a minimum of 2px per side.
 */
export const computeTargetDimensions = (width, height, maxLongest = TARGET_MAX_DIMENSION) => {
    const longest = Math.max(width, height);
    const ratio = longest > maxLongest ? maxLongest / longest : 1;
    let w = Math.round(width * ratio);
    let h = Math.round(height * ratio);
    w -= w % 2;
    h -= h % 2;
    return { width: Math.max(2, w), height: Math.max(2, h) };
};

// ── FFmpeg resolution (defensive) ────────────────────────────────────────────

let ffmpegPathCache; // undefined = unresolved, string = path
let ffmpegAvailableCache; // undefined = unprobed, boolean otherwise

export const resolveFfmpegPath = async () => {
    if (ffmpegPathCache !== undefined) return ffmpegPathCache;
    if (process.env.FFMPEG_PATH) {
        ffmpegPathCache = process.env.FFMPEG_PATH;
        return ffmpegPathCache;
    }
    try {
        const mod = await import("ffmpeg-static");
        const p = mod?.default || mod;
        ffmpegPathCache = typeof p === "string" && p ? p : "ffmpeg";
    } catch {
        // Package not installed — assume a system ffmpeg on PATH; the probe below
        // will reveal whether it actually exists.
        ffmpegPathCache = "ffmpeg";
    }
    return ffmpegPathCache;
};

const spawnFfmpeg = (ffmpegPath, args, { timeoutMs }) =>
    new Promise((resolve) => {
        let child;
        try {
            child = spawn(ffmpegPath, args, { windowsHide: true });
        } catch (err) {
            resolve({ ok: false, code: null, error: err, stderr: "" });
            return;
        }

        let stderr = "";
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };

        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            } catch {
                /* already gone */
            }
            finish({ ok: false, code: null, timedOut: true, stderr });
        }, timeoutMs);

        if (child.stderr) {
            child.stderr.on("data", (d) => {
                // Bound the captured stderr so a chatty/abusive run can't grow it
                // unboundedly.
                if (stderr.length < 8000) stderr += d.toString();
            });
        }
        child.on("error", (err) => finish({ ok: false, code: null, error: err, stderr }));
        child.on("close", (code) => finish({ ok: code === 0, code, stderr }));
    });

/**
 * Probe whether a usable ffmpeg exists (cached). Never throws.
 */
export const isFfmpegAvailable = async () => {
    if (ffmpegAvailableCache !== undefined) return ffmpegAvailableCache;
    const ffmpegPath = await resolveFfmpegPath();
    const result = await spawnFfmpeg(ffmpegPath, ["-version"], {
        timeoutMs: FFMPEG_PROBE_TIMEOUT_MS,
    });
    ffmpegAvailableCache = result.ok === true;
    return ffmpegAvailableCache;
};

// Test seam: reset the cached resolution between cases.
export const __resetFfmpegCacheForTests = () => {
    ffmpegPathCache = undefined;
    ffmpegAvailableCache = undefined;
};

// ── Encoding ─────────────────────────────────────────────────────────────────

const mp4Args = (input, output, target) => [
    "-y",
    "-i",
    input,
    "-an", // strip any (unexpected) audio
    "-vf",
    `scale=${target.width}:${target.height}:flags=lanczos`,
    "-movflags",
    "+faststart",
    "-pix_fmt",
    "yuv420p", // required for Safari/iOS
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline", // maximize iOS/Safari compatibility
    "-level",
    "3.1",
    "-preset",
    "veryfast",
    "-crf",
    "28", // background loop — small files matter more than pristine quality
    output,
];

const webmArgs = (input, output, target) => [
    "-y",
    "-i",
    input,
    "-an",
    "-vf",
    `scale=${target.width}:${target.height}`,
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "0",
    "-crf",
    "38",
    "-row-mt",
    "1",
    "-deadline",
    "good",
    "-cpu-used",
    "4",
    output,
];

/**
 * Process a GIF buffer into background assets.
 *
 * @param {Buffer} gifBuffer
 * @param {{ withWebm?: boolean }} [opts]
 * @returns {Promise<{
 *   poster: Buffer, mp4: Buffer, webm: Buffer|null,
 *   width: number, height: number, durationMs: number, frames: number,
 *   bytes: { poster: number, mp4: number, webm: number|null }
 * }>}
 *
 * Throws FfmpegUnavailableError when no ffmpeg is present (caller falls back),
 * or AnimatedBackgroundError on an invalid/oversized GIF or a failed encode.
 */
export const processGif = async (gifBuffer, opts = {}) => {
    const { withWebm = true } = opts;

    if (!hasValidGifMagic(gifBuffer)) {
        throw new AnimatedBackgroundError("invalid GIF file");
    }
    if (gifBuffer.length > MAX_GIF_BYTES) {
        throw new AnimatedBackgroundError("GIF exceeds the size limit", { code: "too_large" });
    }

    const info = await inspectGif(gifBuffer);
    validateGifConstraints(info);
    const target = computeTargetDimensions(info.width, info.height);

    const available = await isFfmpegAvailable();
    if (!available) {
        throw new FfmpegUnavailableError();
    }
    const ffmpegPath = await resolveFfmpegPath();

    // Poster: first frame, downscaled, as WebP. Generated from the GIF itself
    // (never trusting a client-supplied poster) so it always matches the media.
    let poster;
    try {
        poster = await sharp(gifBuffer, { page: 0 })
            .resize(target.width, target.height, { fit: "cover", withoutEnlargement: true })
            .webp({ quality: 80, effort: 4 })
            .toBuffer();
    } catch {
        throw new AnimatedBackgroundError("could not generate poster frame");
    }

    let dir;
    try {
        dir = await mkdtemp(join(tmpdir(), "iskrib-bg-"));
        const base = randomUUID();
        const inputPath = join(dir, `${base}.gif`);
        const mp4Path = join(dir, `${base}.mp4`);
        const webmPath = join(dir, `${base}.webm`);

        await writeFile(inputPath, gifBuffer);

        const mp4Result = await spawnFfmpeg(ffmpegPath, mp4Args(inputPath, mp4Path, target), {
            timeoutMs: FFMPEG_TIMEOUT_MS,
        });
        if (!mp4Result.ok) {
            console.error("[animatedBg] mp4 encode failed", {
                code: mp4Result.code,
                timedOut: mp4Result.timedOut || false,
                stderr: (mp4Result.stderr || "").slice(-500),
            });
            throw new AnimatedBackgroundError("video conversion failed", {
                status: 500,
                code: "encode_failed",
            });
        }

        const mp4 = await readFile(mp4Path);
        if (!mp4.length || mp4.length > MAX_OUTPUT_BYTES) {
            throw new AnimatedBackgroundError("video output failed sanity check", {
                status: 500,
                code: "encode_failed",
            });
        }

        let webm = null;
        if (withWebm) {
            const webmResult = await spawnFfmpeg(ffmpegPath, webmArgs(inputPath, webmPath, target), {
                timeoutMs: FFMPEG_TIMEOUT_MS,
            });
            if (webmResult.ok) {
                try {
                    const buf = await readFile(webmPath);
                    if (buf.length && buf.length <= MAX_OUTPUT_BYTES) webm = buf;
                } catch {
                    webm = null; // best effort — mp4 is the required output
                }
            } else {
                console.warn("[animatedBg] webm encode skipped (non-fatal)", {
                    code: webmResult.code,
                    timedOut: webmResult.timedOut || false,
                });
            }
        }

        return {
            poster,
            mp4,
            webm,
            width: target.width,
            height: target.height,
            durationMs: info.durationMs,
            frames: info.frames,
            bytes: {
                poster: poster.length,
                mp4: mp4.length,
                webm: webm ? webm.length : null,
            },
        };
    } finally {
        if (dir) {
            await rm(dir, { recursive: true, force: true }).catch((err) =>
                console.warn("[animatedBg] temp cleanup failed", err?.message || err)
            );
        }
    }
};
