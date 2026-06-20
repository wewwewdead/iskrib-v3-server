import { describe, expect, it } from "vitest";
import {
    validateProfileTheme,
    isValidColor,
    DEFAULT_PROFILE_THEME,
    MAX_STICKERS,
    ALLOWED_SECTION_IDS,
} from "../utils/profileThemeValidation.js";

const baseValidTheme = () => ({
    version: 1,
    presetId: "midnight",
    colors: {
        text: "#ffffff",
        accent: "#D4A853",
        cardBackground: "rgba(255,255,255,0.55)",
        cardBorder: "rgba(255,255,255,0.22)",
    },
    typography: { font: "lora", scale: "spacious" },
    cards: { style: "glass", radius: "round", border: "soft", shadow: "soft" },
    sections: [
        { id: "hero", visible: true, order: 0 },
        { id: "stats", visible: false, order: 1 },
        { id: "bio", visible: true, order: 2 },
    ],
    stickers: [{ id: "sparkle-01", x: 80, y: 40, rotation: -8, scale: 1 }],
});

describe("isValidColor", () => {
    it("accepts hex and rgba colors", () => {
        expect(isValidColor("#fff")).toBe(true);
        expect(isValidColor("#ffffff")).toBe(true);
        expect(isValidColor("#ffffffaa")).toBe(true);
        expect(isValidColor("rgba(255,255,255,0.5)")).toBe(true);
        expect(isValidColor("rgb(10, 20, 30)")).toBe(true);
    });

    it("rejects malicious / malformed colors", () => {
        expect(isValidColor("red")).toBe(false);
        expect(isValidColor("url(javascript:alert(1))")).toBe(false);
        expect(isValidColor("#fff; background: url(x)")).toBe(false);
        expect(isValidColor("expression(alert(1))")).toBe(false);
        expect(isValidColor("")).toBe(false);
        expect(isValidColor(123)).toBe(false);
    });
});

describe("validateProfileTheme", () => {
    it("passes a valid theme through and normalizes it", () => {
        const result = validateProfileTheme(baseValidTheme());
        expect(result.version).toBe(1);
        expect(result.presetId).toBe("midnight");
        expect(result.colors.text).toBe("#ffffff");
        expect(result.typography.font).toBe("lora");
        expect(result.cards.style).toBe("glass");
        // hero is forced visible, stats stays hidden
        const stats = result.sections.find((s) => s.id === "stats");
        expect(stats.visible).toBe(false);
        expect(result.stickers).toHaveLength(1);
    });

    it("rejects an invalid color value", () => {
        const theme = baseValidTheme();
        theme.colors.accent = "javascript:alert(1)";
        expect(() => validateProfileTheme(theme)).toThrow(/invalid color/i);
    });

    it("strips unknown section ids", () => {
        const theme = baseValidTheme();
        theme.sections.push({ id: "evil_section", visible: true, order: 99 });
        const result = validateProfileTheme(theme);
        expect(result.sections.find((s) => s.id === "evil_section")).toBeUndefined();
        // all returned sections are from the allowed list
        result.sections.forEach((s) => expect(ALLOWED_SECTION_IDS).toContain(s.id));
    });

    it("truncates stickers beyond the max", () => {
        const theme = baseValidTheme();
        theme.stickers = Array.from({ length: MAX_STICKERS + 10 }, () => ({
            id: "star-01",
            x: 10,
            y: 10,
            rotation: 0,
            scale: 1,
        }));
        const result = validateProfileTheme(theme);
        expect(result.stickers).toHaveLength(MAX_STICKERS);
    });

    it("strips unknown sticker ids", () => {
        const theme = baseValidTheme();
        theme.stickers = [{ id: "not-a-real-sticker", x: 1, y: 1, rotation: 0, scale: 1 }];
        const result = validateProfileTheme(theme);
        expect(result.stickers).toHaveLength(0);
    });

    it("falls back to default font for an unknown font", () => {
        const theme = baseValidTheme();
        theme.typography.font = "comic-sans-evil";
        const result = validateProfileTheme(theme);
        expect(result.typography.font).toBe(DEFAULT_PROFILE_THEME.typography.font);
    });

    it("falls back to defaults for unknown card enum values", () => {
        const theme = baseValidTheme();
        theme.cards.style = "hologram";
        theme.cards.radius = "spiky";
        const result = validateProfileTheme(theme);
        expect(result.cards.style).toBe(DEFAULT_PROFILE_THEME.cards.style);
        expect(result.cards.radius).toBe(DEFAULT_PROFILE_THEME.cards.radius);
    });

    it("clamps sticker position and scale into safe ranges", () => {
        const theme = baseValidTheme();
        theme.stickers = [{ id: "heart-01", x: 9999, y: -50, rotation: 9999, scale: 100 }];
        const result = validateProfileTheme(theme);
        expect(result.stickers[0].x).toBe(100);
        expect(result.stickers[0].y).toBe(0);
        expect(result.stickers[0].rotation).toBe(180);
        expect(result.stickers[0].scale).toBe(3);
    });

    it("strips unknown top-level keys", () => {
        const theme = { ...baseValidTheme(), __proto__evil: true, rawHtml: "<script>" };
        const result = validateProfileTheme(theme);
        expect(result.rawHtml).toBeUndefined();
        expect(Object.keys(result).sort()).toEqual(
            ["cards", "colors", "presetId", "sections", "stickers", "typography", "version"].sort()
        );
    });

    it("rejects non-object payloads", () => {
        expect(() => validateProfileTheme(null)).toThrow();
        expect(() => validateProfileTheme("hello")).toThrow();
        expect(() => validateProfileTheme([1, 2, 3])).toThrow();
    });

    it("rejects an oversized payload", () => {
        const theme = baseValidTheme();
        theme.presetId = "custom";
        // huge string blows past the size cap before per-field validation
        theme.colors.text = "#" + "f".repeat(20000);
        expect(() => validateProfileTheme(theme)).toThrow(/too large/i);
    });

    it("fills in all known sections when given a partial list", () => {
        const theme = baseValidTheme();
        theme.sections = [{ id: "hero", visible: true, order: 0 }];
        const result = validateProfileTheme(theme);
        ALLOWED_SECTION_IDS.forEach((id) => {
            expect(result.sections.find((s) => s.id === id)).toBeDefined();
        });
    });
});
