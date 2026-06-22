import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted above the file body, so the mock state they
// reference must be created with vi.hoisted (also hoisted) to avoid a TDZ error.
const h = vi.hoisted(() => {
    const spawnCalls = [];
    // state.plan(args) => exit code number | "error" (spawn failure).
    const state = { plan: () => 0 };

    const spawn = (path, args) => {
        spawnCalls.push({ path, args });
        const handlers = {};
        const child = {
            stderr: { on: () => {} },
            kill: () => {},
            on(ev, cb) {
                handlers[ev] = cb;
                return child;
            },
        };
        queueMicrotask(() => {
            const outcome = state.plan(args);
            if (outcome === "error") handlers.error?.(new Error("spawn ENOENT"));
            else handlers.close?.(outcome);
        });
        return child;
    };

    const fs = {
        mkdtemp: vi.fn(async (prefix) => `${prefix}tmpdir`),
        writeFile: vi.fn(async () => undefined),
        readFile: vi.fn(async (p) => Buffer.from(`${String(p)}-bytes`)),
        rm: vi.fn(async () => undefined),
    };

    const sharpChain = {
        metadata: vi.fn(),
        resize: vi.fn(),
        webp: vi.fn(),
        toBuffer: vi.fn(),
    };
    sharpChain.resize.mockReturnValue(sharpChain);
    sharpChain.webp.mockReturnValue(sharpChain);

    return { spawnCalls, state, spawn, fs, sharpChain };
});

vi.mock("node:child_process", () => ({ spawn: (...a) => h.spawn(...a) }));
vi.mock("node:fs/promises", () => h.fs);
vi.mock("sharp", () => ({ default: vi.fn(() => h.sharpChain) }));

import {
    processGif,
    inspectGif,
    validateGifConstraints,
    computeTargetDimensions,
    hasValidGifMagic,
    isFfmpegAvailable,
    __resetFfmpegCacheForTests,
    AnimatedBackgroundError,
    HARD_MAX_DIMENSION,
    MAX_DURATION_MS,
} from "../services/animatedBackgroundProcessor.js";

const gifBuffer = (magic = "GIF89a") =>
    Buffer.concat([Buffer.from(magic, "ascii"), Buffer.from([0x01, 0x02, 0x03, 0x04])]);

beforeEach(() => {
    vi.clearAllMocks();
    h.spawnCalls.length = 0;
    h.state.plan = () => 0;
    __resetFfmpegCacheForTests();
    process.env.FFMPEG_PATH = "/usr/bin/ffmpeg"; // deterministic resolution
    h.sharpChain.metadata.mockResolvedValue({
        width: 800,
        height: 600,
        pageHeight: 600,
        pages: 20,
        delay: Array.from({ length: 20 }, () => 100),
    });
    h.sharpChain.resize.mockReturnValue(h.sharpChain);
    h.sharpChain.webp.mockReturnValue(h.sharpChain);
    h.sharpChain.toBuffer.mockResolvedValue(Buffer.from("poster-webp-bytes"));
    h.fs.readFile.mockImplementation(async (p) => Buffer.from(`${String(p)}-bytes`));
});

describe("hasValidGifMagic", () => {
    it("accepts GIF87a / GIF89a and rejects others", () => {
        expect(hasValidGifMagic(gifBuffer("GIF87a"))).toBe(true);
        expect(hasValidGifMagic(gifBuffer("GIF89a"))).toBe(true);
        expect(hasValidGifMagic(Buffer.from("NOTAGIF!"))).toBe(false);
        expect(hasValidGifMagic(Buffer.from("GIF"))).toBe(false);
        expect(hasValidGifMagic("not a buffer")).toBe(false);
    });
});

describe("computeTargetDimensions", () => {
    it("downscales the longest side to <= 1280 and forces even dims", () => {
        expect(computeTargetDimensions(1920, 1080)).toEqual({ width: 1280, height: 720 });
        expect(computeTargetDimensions(1080, 1920)).toEqual({ width: 720, height: 1280 });
    });
    it("never upscales smaller media", () => {
        expect(computeTargetDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    });
    it("always returns even, >= 2px dimensions", () => {
        const { width, height } = computeTargetDimensions(3, 3);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
        expect(width).toBeGreaterThanOrEqual(2);
    });
});

describe("inspectGif", () => {
    it("reads dimensions, frame count and duration", async () => {
        const info = await inspectGif(gifBuffer());
        expect(info).toEqual({ width: 800, height: 600, frames: 20, durationMs: 2000 });
    });
    it("throws when Sharp can't read the buffer", async () => {
        h.sharpChain.metadata.mockRejectedValueOnce(new Error("bad"));
        await expect(inspectGif(gifBuffer())).rejects.toBeInstanceOf(AnimatedBackgroundError);
    });
});

describe("validateGifConstraints", () => {
    it("passes a normal GIF", () => {
        expect(validateGifConstraints({ width: 800, height: 600, frames: 20, durationMs: 2000 })).toBe(true);
    });
    it("rejects oversized dimensions", () => {
        expect(() =>
            validateGifConstraints({ width: HARD_MAX_DIMENSION + 1, height: 100, frames: 1, durationMs: 100 })
        ).toThrow(AnimatedBackgroundError);
    });
    it("rejects overlong duration", () => {
        expect(() =>
            validateGifConstraints({ width: 100, height: 100, frames: 10, durationMs: MAX_DURATION_MS + 1 })
        ).toThrow(AnimatedBackgroundError);
    });
    it("rejects a too-heavy animation (megapixels)", () => {
        expect(() =>
            validateGifConstraints({ width: 1920, height: 1920, frames: 600, durationMs: 1000 })
        ).toThrow(AnimatedBackgroundError);
    });
});

describe("isFfmpegAvailable", () => {
    it("returns true when the probe exits 0 and caches the result", async () => {
        expect(await isFfmpegAvailable()).toBe(true);
        expect(await isFfmpegAvailable()).toBe(true);
        const versionCalls = h.spawnCalls.filter((c) => c.args.includes("-version"));
        expect(versionCalls).toHaveLength(1);
    });
    it("returns false when the probe fails", async () => {
        h.state.plan = () => "error";
        expect(await isFfmpegAvailable()).toBe(false);
    });
});

describe("processGif", () => {
    it("produces poster + mp4 (+webm) buffers and cleans up temp files", async () => {
        const result = await processGif(gifBuffer());

        expect(Buffer.isBuffer(result.poster)).toBe(true);
        expect(Buffer.isBuffer(result.mp4)).toBe(true);
        expect(Buffer.isBuffer(result.webm)).toBe(true);
        expect(result.width).toBe(800);
        expect(result.height).toBe(600);
        expect(result.durationMs).toBe(2000);
        expect(result.bytes.mp4).toBe(result.mp4.length);

        expect(h.spawnCalls.some((c) => c.args.includes("libx264"))).toBe(true);
        expect(h.spawnCalls.some((c) => c.args.includes("libvpx-vp9"))).toBe(true);

        expect(h.fs.rm).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
    });

    it("throws an encode error and still cleans up when ffmpeg fails", async () => {
        h.state.plan = (args) => (args.includes("libx264") ? 1 : 0); // probe ok, mp4 fails
        await expect(processGif(gifBuffer())).rejects.toMatchObject({ code: "encode_failed" });
        expect(h.fs.rm).toHaveBeenCalled();
    });

    it("treats webm failure as non-fatal (mp4 still returned)", async () => {
        h.state.plan = (args) => (args.includes("libvpx-vp9") ? 1 : 0);
        const result = await processGif(gifBuffer());
        expect(Buffer.isBuffer(result.mp4)).toBe(true);
        expect(result.webm).toBeNull();
    });

    it("rejects an invalid GIF signature before doing any work", async () => {
        await expect(processGif(Buffer.from("NOTAGIF!"))).rejects.toBeInstanceOf(AnimatedBackgroundError);
        expect(h.spawnCalls).toHaveLength(0);
    });

    it("signals ffmpeg_unavailable when no ffmpeg is present", async () => {
        h.state.plan = () => "error"; // probe fails → unavailable
        await expect(processGif(gifBuffer())).rejects.toMatchObject({ code: "ffmpeg_unavailable" });
    });
});
