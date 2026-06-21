import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));

vi.mock("../services/supabase.js", () => ({
    default: { storage: { from: mockStorageFrom } },
}));

const mockToBuffer = vi.fn();
const sharpChain = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: mockToBuffer,
};
const mockSharp = vi.fn(() => sharpChain);
vi.mock("sharp", () => ({ default: mockSharp }));

// Keep the static-image pipeline isolated (imageUploader is exercised separately).
const mockImageUploader = vi.fn();
vi.mock("../utils/imageUploader.js", () => ({ imageUploader: mockImageUploader }));

// Avoid loading the heavy embeddings stack when importing uploadService.js.
vi.mock("@xenova/transformers", () => ({ pipeline: vi.fn() }));

// ── Helpers ──
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

const posterFile = (overrides = {}) => ({
    fieldname: "poster",
    originalname: "poster.webp",
    mimetype: "image/webp",
    buffer: Buffer.from("poster-bytes"),
    size: 512,
    ...overrides,
});

describe("uploadBackgroundGifService", () => {
    let uploadBackgroundGifService;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockUpload.mockResolvedValue({ error: null });
        mockGetPublicUrl.mockImplementation((path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }));
        mockToBuffer.mockResolvedValue(Buffer.from("poster-webp-bytes"));
        ({ uploadBackgroundGifService } = await import("../services/backgroundGifService.js"));
    });

    it("rejects a missing GIF file", async () => {
        await expect(uploadBackgroundGifService("user-1", undefined, undefined)).rejects.toMatchObject({
            status: 400,
        });
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it("rejects a non-GIF mimetype", async () => {
        const file = gifFile({ mimetype: "image/png", originalname: "bg.png", buffer: Buffer.from("notagif") });
        await expect(uploadBackgroundGifService("user-1", file, undefined)).rejects.toMatchObject({
            status: 400,
            error: "file must be a GIF",
        });
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it("rejects wrong magic bytes even when the filename ends with .gif", async () => {
        const file = gifFile({ buffer: Buffer.from("NOTGIFDATA") });
        await expect(uploadBackgroundGifService("user-1", file, undefined)).rejects.toMatchObject({
            status: 400,
            error: "invalid GIF file",
        });
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it("rejects an oversized GIF", async () => {
        const file = gifFile({ size: 9 * 1024 * 1024 });
        await expect(uploadBackgroundGifService("user-1", file, undefined)).rejects.toMatchObject({
            status: 400,
        });
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it("accepts a valid GIF87a", async () => {
        const file = gifFile({ buffer: gifBytes("GIF87a") });
        const result = await uploadBackgroundGifService("user-1", file, undefined);
        expect(result.gifUrl).toContain(".gif");
    });

    it("accepts a valid GIF89a", async () => {
        const file = gifFile({ buffer: gifBytes("GIF89a") });
        const result = await uploadBackgroundGifService("user-1", file, undefined);
        expect(result.gifUrl).toContain(".gif");
    });

    it("uploads the GIF as-is with contentType image/gif (no Sharp pipeline)", async () => {
        await uploadBackgroundGifService("user-1", gifFile(), undefined);

        const gifUploadCall = mockUpload.mock.calls.find(([path]) => path.endsWith(".gif"));
        expect(gifUploadCall).toBeTruthy();
        expect(gifUploadCall[2]).toMatchObject({ contentType: "image/gif", cacheControl: "31536000" });
        // The raw GIF buffer is uploaded untouched.
        expect(Buffer.isBuffer(gifUploadCall[1])).toBe(true);
        // No Sharp processing when there is no poster.
        expect(mockSharp).not.toHaveBeenCalled();
    });

    it("uploads the poster as WebP via Sharp and returns both URLs", async () => {
        const result = await uploadBackgroundGifService("user-1", gifFile(), posterFile());

        expect(mockSharp).toHaveBeenCalledTimes(1);
        const posterUploadCall = mockUpload.mock.calls.find(([path]) => path.includes("__poster"));
        expect(posterUploadCall).toBeTruthy();
        expect(posterUploadCall[2]).toMatchObject({ contentType: "image/webp" });

        expect(result.gifUrl).toContain(".gif");
        expect(result.posterUrl).toContain("__poster.webp");
    });

    it("never runs Sharp on the GIF buffer itself", async () => {
        await uploadBackgroundGifService("user-1", gifFile(), posterFile());
        // Sharp is only ever called with the poster buffer, never the GIF buffer.
        const gifBuffer = gifFile().buffer;
        const calledWithGif = mockSharp.mock.calls.some(([buf]) => Buffer.isBuffer(buf) && buf.equals(gifBuffer));
        expect(calledWithGif).toBe(false);
    });
});

describe("uploadBackgroundService (static image path unchanged)", () => {
    let uploadBackgroundService;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockImageUploader.mockResolvedValue("https://cdn.test/user_id_user-1/bg__detail.webp");
        ({ uploadBackgroundService } = await import("../services/uploadService.js"));
    });

    it("still routes static images through imageUploader into the background bucket", async () => {
        const file = { buffer: Buffer.from("png-bytes"), mimetype: "image/png" };
        const url = await uploadBackgroundService("user-1", file);

        expect(mockImageUploader).toHaveBeenCalledWith(file, "user-1", "background");
        expect(url).toContain(".webp");
    });
});
