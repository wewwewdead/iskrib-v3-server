import { describe, expect, it } from "vitest";
import {
    validateProfileTheme,
    isValidColor,
    DEFAULT_PROFILE_THEME,
    MAX_STICKERS,
    ALLOWED_SECTION_IDS,
    ALLOWED_LAYOUT_BLOCK_TYPES,
    DEFAULT_LAYOUT_BLOCK_TYPES,
    MAX_LAYOUT_BLOCKS,
    MAX_LAYOUT_TITLE_LENGTH,
    ALLOWED_BLOCK_CONTENT_BY_TYPE,
    DEFAULT_BLOCK_CONTENT,
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
        expect(result.version).toBe(2);
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

    it("accepts the expanded sticker set (writing/celestial/etc. ids)", () => {
        const theme = baseValidTheme();
        theme.stickers = [
            { id: "pen-01", x: 10, y: 10, rotation: 0, scale: 1 },
            { id: "crown-01", x: 20, y: 20, rotation: 0, scale: 1 },
            { id: "comet-01", x: 30, y: 30, rotation: 0, scale: 1 },
        ];
        const result = validateProfileTheme(theme);
        expect(result.stickers.map((s) => s.id)).toEqual(["pen-01", "crown-01", "comet-01"]);
    });

    it("keeps a valid sticker color and drops invalid ones", () => {
        const theme = baseValidTheme();
        theme.stickers = [
            { id: "star-01", x: 10, y: 10, rotation: 0, scale: 1, color: "#ff0000" },
            { id: "heart-01", x: 20, y: 20, rotation: 0, scale: 1, color: "javascript:alert(1)" },
            { id: "moon-01", x: 30, y: 30, rotation: 0, scale: 1 },
        ];
        const result = validateProfileTheme(theme);
        const byId = Object.fromEntries(result.stickers.map((s) => [s.id, s]));
        expect(byId["star-01"].color).toBe("#ff0000");
        expect(byId["heart-01"].color).toBeUndefined();
        expect(byId["moon-01"].color).toBeUndefined();
    });

    it("forces the hero to stack mode and drops legacy free-canvas x/y/w + height", () => {
        const stack = validateProfileTheme(baseValidTheme());
        expect(stack.hero.mode).toBe("stack");
        expect(stack.hero.order).toEqual(["avatar", "name", "stats", "bio"]);
        expect(stack.hero.layout.avatar).toBeDefined();

        const legacy = validateProfileTheme({
            ...baseValidTheme(),
            hero: { mode: "free", height: 9999, layout: { avatar: { x: -10, y: 999, w: 1 } } },
        });
        expect(legacy.hero.mode).toBe("stack");
        expect(legacy.hero.height).toBeUndefined();
        expect(legacy.hero.layout.avatar).toEqual({ align: "left", style: "none" });
    });

    it("normalizes the hero element order (dedupe, drop unknown, append missing)", () => {
        const result = validateProfileTheme({
            ...baseValidTheme(),
            hero: { order: ["bio", "bio", "ghost", "stats"] },
        });
        expect(result.hero.order).toEqual(["bio", "stats", "avatar", "name"]);
    });

    it("whitelists per-hero-element align/style (isolated)", () => {
        const result = validateProfileTheme({
            ...baseValidTheme(),
            hero: {
                mode: "free",
                layout: {
                    name: { x: 30, y: 16, w: 60, align: "center", style: "glass" },
                    bio: { x: 6, y: 60, w: 80, align: "evil", style: "neon" },
                },
            },
        });
        expect(result.hero.layout.name.align).toBe("center");
        expect(result.hero.layout.name.style).toBe("glass");
        expect(result.hero.layout.bio.align).toBe("left"); // bad → default
        expect(result.hero.layout.bio.style).toBe("none");
        expect(result.hero.layout.avatar.align).toBe("left"); // untouched element default
    });

    it("keeps a valid per-element text color and drops invalid ones", () => {
        const result = validateProfileTheme({
            ...baseValidTheme(),
            hero: {
                mode: "free",
                layout: {
                    name: { x: 30, y: 16, w: 60, color: "#ff0000" },
                    bio: { x: 6, y: 60, w: 80, color: "url(evil)" },
                },
            },
        });
        expect(result.hero.layout.name.color).toBe("#ff0000");
        expect(result.hero.layout.bio.color).toBeUndefined();
    });

    it("whitelists per-element font/size (isolated)", () => {
        const result = validateProfileTheme({
            ...baseValidTheme(),
            hero: {
                mode: "free",
                layout: {
                    name: { x: 30, y: 16, w: 60, font: "lora", size: "spacious" },
                    bio: { x: 6, y: 60, w: 80, font: "evil", size: "huge" },
                },
            },
        });
        expect(result.hero.layout.name.font).toBe("lora");
        expect(result.hero.layout.name.size).toBe("spacious");
        expect(result.hero.layout.bio.font).toBeUndefined();
        expect(result.hero.layout.bio.size).toBeUndefined();
    });

    it("strips unknown top-level keys", () => {
        const theme = { ...baseValidTheme(), __proto__evil: true, rawHtml: "<script>" };
        const result = validateProfileTheme(theme);
        expect(result.rawHtml).toBeUndefined();
        expect(Object.keys(result).sort()).toEqual(
            ["background", "cards", "colors", "hero", "layout", "presetId", "sections", "stickers", "typography", "version"].sort()
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

describe("validateProfileTheme — background", () => {
    it("defaults to a 'none' background when omitted", () => {
        const result = validateProfileTheme(baseValidTheme());
        expect(result.background).toEqual(DEFAULT_PROFILE_THEME.background);
    });

    it("accepts a valid gradient background", () => {
        const theme = {
            ...baseValidTheme(),
            background: { type: "gradient", angle: 90, from: "#112233", to: "rgba(0,0,0,0.5)", opacity: 0.4 },
        };
        const result = validateProfileTheme(theme);
        expect(result.background).toEqual({
            type: "gradient",
            angle: 90,
            from: "#112233",
            to: "rgba(0,0,0,0.5)",
            opacity: 0.4,
        });
    });

    it("clamps angle/opacity and falls back on bad colors (never throws)", () => {
        const theme = {
            ...baseValidTheme(),
            background: { type: "gradient", angle: 999, from: "url(evil)", to: 12, opacity: 5 },
        };
        const result = validateProfileTheme(theme);
        expect(result.background.type).toBe("gradient");
        expect(result.background.angle).toBe(360);
        expect(result.background.opacity).toBe(1);
        expect(result.background.from).toBe(DEFAULT_PROFILE_THEME.background.from);
        expect(result.background.to).toBe(DEFAULT_PROFILE_THEME.background.to);
    });

    it("coerces an unknown background type to 'none'", () => {
        const theme = { ...baseValidTheme(), background: { type: "image" } };
        expect(validateProfileTheme(theme).background.type).toBe("none");
    });
});

describe("validateProfileTheme — layout (V3A)", () => {
    const layoutTheme = (layout) => ({ ...baseValidTheme(), layout });

    it("derives a default layout from sections when layout is missing (legacy v1)", () => {
        const result = validateProfileTheme(baseValidTheme()); // no layout key
        expect(result.layout).toBeDefined();
        expect(result.layout.mode).toBe("stack");
        // every default content block is present...
        DEFAULT_LAYOUT_BLOCK_TYPES.forEach((type) => {
            expect(result.layout.blocks.find((b) => b.type === type)).toBeDefined();
        });
        // ...and order is a clean 0..n-1 sequence
        result.layout.blocks.forEach((b, i) => expect(b.order).toBe(i));
    });

    it("seeds derived block visibility from the legacy sections list", () => {
        const theme = baseValidTheme();
        // hide media via sections; no explicit layout
        theme.sections = [{ id: "media", visible: false, order: 5 }];
        const result = validateProfileTheme(theme);
        const media = result.layout.blocks.find((b) => b.type === "media");
        expect(media.visible).toBe(false);
    });

    it("accepts an explicit v2 layout and whitelists its fields", () => {
        const result = validateProfileTheme(
            layoutTheme({
                mode: "stack",
                blocks: [
                    { id: "writings", type: "writings", visible: true, order: 0, width: "half", style: "paper", variant: "list", title: "My Words" },
                    { id: "guestbook", type: "guestbook", visible: false, order: 1, width: "full", style: "glass", variant: "wall", title: "Wall" },
                ],
            })
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(writings.width).toBe("half");
        expect(writings.style).toBe("paper");
        expect(writings.variant).toBe("list");
        expect(writings.title).toBe("My Words");
        const guestbook = result.layout.blocks.find((b) => b.type === "guestbook");
        expect(guestbook.visible).toBe(false);
        expect(guestbook.variant).toBe("wall");
    });

    it("strips unknown block types", () => {
        const result = validateProfileTheme(
            layoutTheme({ blocks: [{ id: "evil", type: "evil_block", order: 0 }] })
        );
        expect(result.layout.blocks.find((b) => b.type === "evil_block")).toBeUndefined();
        result.layout.blocks.forEach((b) => expect(ALLOWED_LAYOUT_BLOCK_TYPES).toContain(b.type));
    });

    it("falls back to safe defaults for unknown width/style/variant", () => {
        const result = validateProfileTheme(
            layoutTheme({ blocks: [{ type: "media", width: "ginormous", style: "hologram", variant: "explode", order: 0 }] })
        );
        const media = result.layout.blocks.find((b) => b.type === "media");
        expect(media.width).toBe("full"); // default media width
        expect(media.style).toBe("inherit");
        expect(media.variant).toBe("grid"); // first allowed media variant
    });

    it("keeps a sanitized per-block card override (style/radius/border/shadow)", () => {
        const result = validateProfileTheme(
            layoutTheme({
                blocks: [
                    {
                        type: "writings",
                        order: 0,
                        card: { style: "paper", radius: "sharp", border: "bold", shadow: "strong" },
                    },
                ],
            })
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(writings.card).toEqual({
            style: "paper",
            radius: "sharp",
            border: "bold",
            shadow: "strong",
        });
    });

    it("whitelists per-block card fields and drops the override when absent", () => {
        const result = validateProfileTheme(
            layoutTheme({
                blocks: [
                    { type: "writings", order: 0, card: { style: "evil", radius: "huge", border: "x", shadow: "y" } },
                    { type: "media", order: 1 }, // no card → none attached
                ],
            })
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        // bad values fall back to the global defaults, override still present
        expect(writings.card.style).toBe(DEFAULT_PROFILE_THEME.cards.style);
        expect(writings.card.radius).toBe(DEFAULT_PROFILE_THEME.cards.radius);
        const media = result.layout.blocks.find((b) => b.type === "media");
        expect(media.card).toBeUndefined();
    });

    it("ignores a non-object card value", () => {
        const result = validateProfileTheme(
            layoutTheme({ blocks: [{ type: "writings", order: 0, card: "glass" }] })
        );
        expect(result.layout.blocks.find((b) => b.type === "writings").card).toBeUndefined();
    });

    it("dedupes blocks by type", () => {
        const result = validateProfileTheme(
            layoutTheme({
                blocks: [
                    { type: "writings", order: 0, title: "First" },
                    { type: "writings", order: 1, title: "Second" },
                ],
            })
        );
        const writings = result.layout.blocks.filter((b) => b.type === "writings");
        expect(writings).toHaveLength(1);
        expect(writings[0].title).toBe("First");
    });

    it("clamps and re-indexes block order", () => {
        const result = validateProfileTheme(
            layoutTheme({
                blocks: [
                    { type: "writings", order: 9999 },
                    { type: "guestbook", order: -50 },
                ],
            })
        );
        // guestbook (-50 → clamped to 0) should sort before writings
        expect(result.layout.blocks[0].type).toBe("guestbook");
        result.layout.blocks.forEach((b, i) => expect(b.order).toBe(i));
    });

    it("treats titles as plain text: strips HTML and clamps length", () => {
        const long = "x".repeat(80);
        const result = validateProfileTheme(
            layoutTheme({
                blocks: [
                    { type: "writings", order: 0, title: "<script>alert(1)</script>Hello" },
                    { type: "media", order: 1, title: long },
                ],
            })
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        // tags are stripped; only inert plain text remains (no markup survives)
        expect(writings.title).toBe("alert(1)Hello");
        expect(writings.title).not.toMatch(/[<>]/);
        const media = result.layout.blocks.find((b) => b.type === "media");
        expect(media.title.length).toBe(MAX_LAYOUT_TITLE_LENGTH);
    });

    it("falls back to the default title when the title is empty after sanitizing", () => {
        const result = validateProfileTheme(
            layoutTheme({ blocks: [{ type: "writings", order: 0, title: "<b></b>" }] })
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(writings.title).toBe("Writings");
    });

    it("never exceeds the max block count", () => {
        const blocks = ALLOWED_LAYOUT_BLOCK_TYPES.map((type, i) => ({ type, order: i }));
        const result = validateProfileTheme(layoutTheme({ blocks }));
        expect(result.layout.blocks.length).toBeLessThanOrEqual(MAX_LAYOUT_BLOCKS);
    });

    it("gives content blocks default content controls when none are provided", () => {
        const result = validateProfileTheme(baseValidTheme()); // legacy, no layout
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(writings.content).toEqual(DEFAULT_BLOCK_CONTENT.writings);
        const media = result.layout.blocks.find((b) => b.type === "media");
        expect(media.content).toEqual(DEFAULT_BLOCK_CONTENT.media);
    });

    it("rebuilds the layout from scratch (no unknown keys survive on blocks)", () => {
        const result = validateProfileTheme(
            layoutTheme({
                mode: "free-canvas",
                rawCss: "body{}",
                blocks: [{ type: "writings", order: 0, className: "evil", style: "inherit", onclick: "x" }],
            })
        );
        expect(result.layout.mode).toBe("stack"); // unknown mode rejected
        expect(result.layout.rawCss).toBeUndefined();
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(Object.keys(writings).sort()).toEqual(
            ["content", "id", "order", "style", "title", "type", "variant", "visible", "width"].sort()
        );
        expect(writings.className).toBeUndefined();
        expect(writings.onclick).toBeUndefined();
    });
});

describe("validateProfileTheme — content controls (V3C)", () => {
    const layoutWith = (blocks) => ({ ...baseValidTheme(), layout: { mode: "stack", blocks } });

    it("accepts valid content controls and keeps them", () => {
        const result = validateProfileTheme(
            layoutWith([
                {
                    type: "writings",
                    order: 0,
                    content: { count: 1, source: "pinned_first", density: "compact", imageShape: "square", showMeta: false, showExcerpt: false },
                },
            ])
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(writings.content).toEqual({
            count: 1,
            source: "pinned_first",
            density: "compact",
            imageShape: "square",
            showMeta: false,
            showExcerpt: false,
        });
    });

    it("strips unknown content keys (rebuilt from scratch)", () => {
        const result = validateProfileTheme(
            layoutWith([
                { type: "media", order: 0, content: { count: 4, evil: "x", query: "DROP TABLE", filter: "*" } },
            ])
        );
        const media = result.layout.blocks.find((b) => b.type === "media");
        expect(media.content.evil).toBeUndefined();
        expect(media.content.query).toBeUndefined();
        expect(media.content.filter).toBeUndefined();
        expect(Object.keys(media.content).sort()).toEqual(
            Object.keys(DEFAULT_BLOCK_CONTENT.media).sort()
        );
    });

    it("falls back to defaults for invalid count/source/density/imageShape", () => {
        const result = validateProfileTheme(
            layoutWith([
                { type: "writings", order: 0, content: { count: 99, source: "evil", density: "ultra", imageShape: "triangle" } },
            ])
        );
        const writings = result.layout.blocks.find((b) => b.type === "writings");
        expect(writings.content.count).toBe(DEFAULT_BLOCK_CONTENT.writings.count);
        expect(writings.content.source).toBe("latest");
        expect(writings.content.density).toBe("comfortable");
        expect(writings.content.imageShape).toBe("rounded");
    });

    it("enforces the per-block source whitelist", () => {
        // writings cannot use opinions' "most_discussed" — it falls back to latest
        const r1 = validateProfileTheme(
            layoutWith([{ type: "writings", order: 0, content: { source: "most_discussed" } }])
        );
        expect(r1.layout.blocks.find((b) => b.type === "writings").content.source).toBe("latest");

        // opinions accepts most_discussed
        const r2 = validateProfileTheme(
            layoutWith([{ type: "opinions", order: 0, content: { source: "most_discussed" } }])
        );
        expect(r2.layout.blocks.find((b) => b.type === "opinions").content.source).toBe("most_discussed");

        // stories accepts popular
        const r3 = validateProfileTheme(
            layoutWith([{ type: "stories", order: 0, content: { source: "popular" } }])
        );
        expect(r3.layout.blocks.find((b) => b.type === "stories").content.source).toBe("popular");
    });

    it("clamps count to the allowed set per block type", () => {
        const result = validateProfileTheme(
            layoutWith([
                { type: "media", order: 0, content: { count: 6 } },
                { type: "opinions", order: 1, content: { count: 2 } },
                { type: "stories", order: 2, content: { count: 3 } },
                { type: "guestbook", order: 3, content: { count: 5 } },
            ])
        );
        const get = (t) => result.layout.blocks.find((b) => b.type === t).content.count;
        expect(get("media")).toBe(6);
        expect(get("opinions")).toBe(2);
        expect(get("stories")).toBe(3);
        expect(get("guestbook")).toBe(5);
        // a count not in the allowed set falls back to the default
        const bad = validateProfileTheme(layoutWith([{ type: "media", order: 0, content: { count: 5 } }]));
        expect(bad.layout.blocks.find((b) => b.type === "media").content.count).toBe(DEFAULT_BLOCK_CONTENT.media.count);
    });

    it("coerces a string count to its number equivalent", () => {
        const result = validateProfileTheme(
            layoutWith([{ type: "writings", order: 0, content: { count: "2" } }])
        );
        expect(result.layout.blocks.find((b) => b.type === "writings").content.count).toBe(2);
    });

    it("does NOT attach content to non-content blocks (bio/stats/joined_date)", () => {
        const result = validateProfileTheme(
            layoutWith([
                { type: "bio", order: 0, content: { count: 3 } },
                { type: "stats", order: 1 },
            ])
        );
        const bio = result.layout.blocks.find((b) => b.type === "bio");
        const stats = result.layout.blocks.find((b) => b.type === "stats");
        expect(bio.content).toBeUndefined();
        expect(stats.content).toBeUndefined();
        expect(ALLOWED_BLOCK_CONTENT_BY_TYPE.bio).toBeUndefined();
    });

    it("accepts a full 12-block layout with content under the size cap", () => {
        const blocks = ALLOWED_LAYOUT_BLOCK_TYPES.map((type, i) => ({
            type,
            order: i,
            content: DEFAULT_BLOCK_CONTENT[type] ? { ...DEFAULT_BLOCK_CONTENT[type] } : undefined,
        }));
        const result = validateProfileTheme(layoutWith(blocks));
        expect(result.layout.blocks.length).toBeLessThanOrEqual(MAX_LAYOUT_BLOCKS);
        // content blocks all carry a content config
        result.layout.blocks
            .filter((b) => ALLOWED_BLOCK_CONTENT_BY_TYPE[b.type])
            .forEach((b) => expect(b.content).toBeDefined());
    });
});
