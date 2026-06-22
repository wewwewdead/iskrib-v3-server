import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted, so their referenced state must be too.
const m = vi.hoisted(() => {
    const mockUpload = vi.fn(async () => ({ error: null }));
    const mockGetPublicUrl = vi.fn((path) => ({ data: { publicUrl: `https://cdn.test/background/${path}` } }));
    const mockRemove = vi.fn(async () => ({ error: null }));
    const mockFrom = vi.fn(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl, remove: mockRemove }));
    return { mockUpload, mockGetPublicUrl, mockRemove, mockFrom };
});
const { mockUpload, mockGetPublicUrl, mockRemove, mockFrom } = m;
vi.mock("../services/supabase.js", () => ({ default: { storage: { from: m.mockFrom } } }));

// Keep Sharp out of the way (backgroundGifUploader imports it at module load).
vi.mock("sharp", () => ({ default: vi.fn(() => ({})) }));

// Override only processGif; keep the real error classes / constants / validators.
vi.mock("../services/animatedBackgroundProcessor.js", async (importActual) => {
    const actual = await importActual();
    return { ...actual, processGif: vi.fn() };
});

// Override only the fallback uploader; keep the real isGifUpload validator.
vi.mock("../utils/backgroundGifUploader.js", async (importActual) => {
    const actual = await importActual();
    return { ...actual, uploadBackgroundGifAssets: vi.fn() };
});

import {
    processAnimatedBackgroundUpload,
    deleteOldBackgroundAssets,
    collectBackgroundAssetUrls,
    storagePathForUserUrl,
} from "../services/profileBackgroundService.js";
import { processGif, AnimatedBackgroundError } from "../services/animatedBackgroundProcessor.js";
import { uploadBackgroundGifAssets } from "../utils/backgroundGifUploader.js";

const gifBytes = (magic = "GIF89a") =>
    Buffer.concat([Buffer.from(magic, "ascii"), Buffer.from([0x01, 0x02, 0x03, 0x04])]);

const gifFile = (overrides = {}) => ({
    fieldname: "gif",
    originalname: "background.gif",
    mimetype: "image/gif",
    buffer: gifBytes(),
    size: 1024,
    ...overrides,
});

const posterFile = () => ({ fieldname: "poster", buffer: Buffer.from("poster"), size: 256 });

const okProcessorResult = () => ({
    poster: Buffer.from("poster"),
    mp4: Buffer.from("mp4-bytes"),
    webm: Buffer.from("webm-bytes"),
    width: 720,
    height: 1280,
    durationMs: 3200,
    frames: 30,
    bytes: { poster: 6, mp4: 9, webm: 9 },
});

beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockImplementation((path) => ({ data: { publicUrl: `https://cdn.test/background/${path}` } }));
    mockRemove.mockResolvedValue({ error: null });
});

describe("processAnimatedBackgroundUpload — happy path", () => {
    it("returns a video manifest with poster + mp4 (+webm) under the user's prefix", async () => {
        processGif.mockResolvedValue(okProcessorResult());

        const manifest = await processAnimatedBackgroundUpload("user-1", gifFile(), posterFile());

        expect(manifest.type).toBe("animated_background");
        expect(manifest.mediaType).toBe("video");
        expect(manifest.processing.status).toBe("ready");
        expect(manifest.posterUrl).toContain("__poster.webp");
        expect(manifest.mp4Url).toContain(".mp4");
        expect(manifest.webmUrl).toContain(".webm");
        expect(manifest.playback).toMatchObject({ loop: true, muted: true, objectFit: "cover" });

        const paths = mockUpload.mock.calls.map((c) => c[0]);
        expect(paths.every((p) => p.startsWith("user_id_user-1/"))).toBe(true);
        expect(paths.some((p) => p.endsWith(".mp4"))).toBe(true);
        expect(paths.some((p) => p.endsWith(".gif"))).toBe(true);
        expect(paths.some((p) => p.includes("__poster.webp"))).toBe(true);

        // No fallback when conversion succeeds.
        expect(uploadBackgroundGifAssets).not.toHaveBeenCalled();
    });
});

describe("processAnimatedBackgroundUpload — validation", () => {
    it("rejects a missing GIF", async () => {
        await expect(processAnimatedBackgroundUpload("user-1", undefined)).rejects.toMatchObject({ status: 400 });
        expect(processGif).not.toHaveBeenCalled();
    });

    it("rejects a non-GIF mimetype/extension", async () => {
        const file = gifFile({ mimetype: "image/png", originalname: "bg.png", buffer: Buffer.from("notagif") });
        await expect(processAnimatedBackgroundUpload("user-1", file)).rejects.toMatchObject({
            status: 400,
            error: "file must be a GIF",
        });
    });

    it("rejects a bad GIF signature even when named .gif", async () => {
        const file = gifFile({ buffer: Buffer.from("NOTGIFDATA") });
        await expect(processAnimatedBackgroundUpload("user-1", file)).rejects.toMatchObject({
            status: 400,
            error: "invalid GIF file",
        });
    });

    it("rejects an oversized GIF", async () => {
        await expect(
            processAnimatedBackgroundUpload("user-1", gifFile({ size: 9 * 1024 * 1024 }))
        ).rejects.toMatchObject({ status: 400 });
        expect(processGif).not.toHaveBeenCalled();
    });

    it("rethrows a user-facing processing error without falling back", async () => {
        processGif.mockRejectedValue(new AnimatedBackgroundError("GIF is longer than 8s", { code: "too_long" }));
        await expect(processAnimatedBackgroundUpload("user-1", gifFile())).rejects.toMatchObject({ status: 400 });
        expect(uploadBackgroundGifAssets).not.toHaveBeenCalled();
    });
});

describe("processAnimatedBackgroundUpload — graceful fallback", () => {
    it("falls back to the legacy GIF path when ffmpeg is unavailable", async () => {
        processGif.mockRejectedValue({ code: "ffmpeg_unavailable" });
        uploadBackgroundGifAssets.mockResolvedValue({
            gifUrl: "https://cdn.test/background/user_id_user-1/x.gif",
            posterUrl: "https://cdn.test/background/user_id_user-1/x__poster.webp",
        });

        const manifest = await processAnimatedBackgroundUpload("user-1", gifFile(), posterFile());

        expect(uploadBackgroundGifAssets).toHaveBeenCalled();
        expect(manifest.mediaType).toBe("gif");
        expect(manifest.mp4Url).toBeNull();
        expect(manifest.originalUrl).toContain(".gif");
        expect(manifest.processing.status).toBe("error");
        expect(manifest.processing.error).toBe("ffmpeg_unavailable");
    });
});

describe("background asset cleanup", () => {
    it("collects URLs from both manifest and legacy CSS shapes", () => {
        const urls = collectBackgroundAssetUrls({
            mp4Url: "https://cdn.test/background/user_id_1/a.mp4",
            posterUrl: "https://cdn.test/background/user_id_1/a.webp",
            backgroundImage: "url(https://cdn.test/background/user_id_1/b.gif)",
        });
        expect(urls).toHaveLength(3);
        expect(urls).toContain("https://cdn.test/background/user_id_1/b.gif");
    });

    it("only maps URLs under the user's own prefix to a path", () => {
        expect(storagePathForUserUrl("https://cdn.test/background/user_id_1/a.mp4", "1")).toBe("user_id_1/a.mp4");
        expect(storagePathForUserUrl("https://cdn.test/background/user_id_2/a.mp4", "1")).toBeNull();
        expect(storagePathForUserUrl("https://evil.test/whatever", "1")).toBeNull();
    });

    it("removes old assets not referenced by the new background (best effort)", async () => {
        const oldBg = {
            mp4Url: "https://cdn.test/background/user_id_1/old.mp4",
            posterUrl: "https://cdn.test/background/user_id_1/old.webp",
            originalUrl: "https://cdn.test/background/user_id_1/old.gif",
        };
        const newBg = { backgroundImage: "url(https://cdn.test/background/user_id_1/new.webp)" };

        const result = await deleteOldBackgroundAssets("1", oldBg, newBg);

        expect(result.removed).toBe(3);
        const removedPaths = mockRemove.mock.calls[0][0];
        expect(removedPaths).toEqual(
            expect.arrayContaining(["user_id_1/old.mp4", "user_id_1/old.webp", "user_id_1/old.gif"])
        );
    });

    it("keeps assets still referenced by the new background", async () => {
        const url = "https://cdn.test/background/user_id_1/keep.mp4";
        const result = await deleteOldBackgroundAssets("1", { mp4Url: url }, { mp4Url: url });
        expect(result.removed).toBe(0);
        expect(mockRemove).not.toHaveBeenCalled();
    });

    it("never throws when storage removal fails", async () => {
        mockRemove.mockResolvedValue({ error: { message: "boom" } });
        const result = await deleteOldBackgroundAssets("1", { mp4Url: "https://cdn.test/background/user_id_1/x.mp4" }, null);
        expect(result.ok).toBe(false);
    });
});
