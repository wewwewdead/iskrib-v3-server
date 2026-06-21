import { AppError } from "./AppError.js";

/**
 * Profile Builder V1 — server-side theme validation & sanitization.
 *
 * Security model:
 *  - The stored theme NEVER contains raw HTML or arbitrary CSS strings.
 *  - Colors are only accepted as strict hex or rgb()/rgba() values.
 *  - Every other value must match a hardcoded whitelist (font, card style,
 *    radius, section id, sticker id, ...). Unknown enum values fall back to a
 *    safe default; unknown sections/stickers are stripped.
 *  - The output object is rebuilt from scratch, so unknown keys cannot survive.
 */

// V2 introduces the `layout` block (Profile Builder V3 — Layout Composer).
// Older (v1) themes are still accepted: they simply have no `layout` and one is
// derived from their `sections`. The stored output is always re-stamped to v2.
export const PROFILE_THEME_VERSION = 2;

// Max serialized size of an incoming theme payload (defense against abuse).
// A full layout (up to 12 blocks) adds ~1.5 KB, comfortably under this guard.
export const MAX_THEME_PAYLOAD_BYTES = 12 * 1024; // 12 KB

export const MAX_STICKERS = 20;

// Allowed preset ids. "custom" is always allowed.
export const ALLOWED_PRESET_IDS = [
    "custom",
    "midnight",
    "parchment",
    "sakura",
    "forest",
    "noir",
    "sunset",
    "ocean",
    "lavender",
];

export const ALLOWED_FONTS = ["outfit", "lora", "playfair", "comfortaa", "lexend", "patrick"];

export const ALLOWED_SCALES = ["compact", "normal", "spacious"];

export const ALLOWED_CARD_STYLES = ["glass", "solid", "paper", "minimal"];
export const ALLOWED_CARD_RADII = ["sharp", "soft", "round"];
export const ALLOWED_CARD_BORDERS = ["none", "soft", "bold"];
export const ALLOWED_CARD_SHADOWS = ["none", "soft", "strong"];

// Page background. `none` = no theme background (legacy `background` column / app
// shell shows through). `gradient` = a two-stop linear gradient with a tunable
// angle and opacity (lower opacity lets the underlying page show through for
// better text contrast). No raw CSS — only validated colors + clamped numbers.
export const ALLOWED_BACKGROUND_TYPES = ["none", "gradient"];

// Hero layout. A fixed vertical stack whose elements can be drag-REORDERED
// (free-canvas positioning was removed). `order` = top-to-bottom element order.
export const ALLOWED_HERO_MODES = ["stack"];
export const HERO_ELEMENT_KEYS = ["avatar", "name", "stats", "bio"];
export const DEFAULT_HERO_ORDER = ["avatar", "name", "stats", "bio"];
export const HERO_ELEMENT_ALIGNS = ["left", "center", "right"];
export const HERO_ELEMENT_STYLES = ["none", "glass", "paper", "minimal", "framed"];
export const HERO_ELEMENT_WIDTHS = ["full", "wide", "narrow"];
export const HERO_ELEMENT_BORDERS = ["none", "hairline", "solid", "thick", "dashed"];
export const HERO_ELEMENT_RADII = ["sharp", "soft", "round"];
export const HERO_ELEMENT_DIVIDERS = ["none", "line", "dashed", "dotted"];

// Canonical section ids. `hero` is required and always visible.
export const ALLOWED_SECTION_IDS = [
    "hero",
    "stats",
    "bio",
    "joined_date",
    "pinned_writings",
    "writings",
    "media",
    "opinions",
    "stories",
    "guestbook",
];

export const REQUIRED_SECTION_IDS = ["hero"];

// Hardcoded sticker registry (ids only — the client owns the rendering).
// MUST stay in sync with STICKER_REGISTRY in
// client/.../builder/stickerRegistry.jsx — unknown ids are stripped on save.
export const ALLOWED_STICKER_IDS = [
    // Writing & journaling
    "pen-01",
    "quill-01",
    "ink-01",
    "book-01",
    "bookmark-01",
    "page-01",
    "quote-01",
    "music-01",
    // Celestial
    "sparkle-01",
    "star-01",
    "moon-01",
    "sun-01",
    "comet-01",
    "planet-01",
    "rainbow-01",
    "snow-01",
    "bolt-01",
    "cloud-01",
    // Nature
    "flower-01",
    "leaf-01",
    "sprout-01",
    "mushroom-01",
    "fire-01",
    // Expressive & social
    "heart-01",
    "smiley-01",
    "chat-01",
    "eye-01",
    "peace-01",
    // Decorative & misc
    "coffee-01",
    "crown-01",
    "gem-01",
    "idea-01",
    "compass-01",
    "globe-01",
    "anchor-01",
    "camera-01",
    "key-01",
];

// ── Layout (Profile Builder V3A — Layout Composer) ───────────────────────────
// The layout controls the ORDER, WIDTH, container STYLE and VARIANT of the
// content blocks below the hero. It carries no raw CSS or class names — every
// value is a whitelisted enum and the title is plain-text only.
export const ALLOWED_LAYOUT_MODES = ["stack"]; // V3A is stack-only (no free canvas yet)

export const ALLOWED_LAYOUT_BLOCK_TYPES = [
    "guestbook",
    "writings",
    "media",
    "opinions",
    "stories",
    "pinned_writings",
    "bio",
    "stats",
    "joined_date",
];

export const ALLOWED_LAYOUT_WIDTHS = ["full", "half", "compact"];

export const ALLOWED_LAYOUT_STYLES = ["inherit", "glass", "paper", "minimal", "framed"];

export const ALLOWED_LAYOUT_VARIANTS_BY_TYPE = {
    guestbook: ["compact", "wall"],
    writings: ["editorial", "list", "compact"],
    media: ["grid", "collage", "strip"],
    opinions: ["cards", "compact", "debate"],
    stories: ["shelf", "covers", "compact"],
    pinned_writings: ["featured", "compact"],
    bio: ["card", "plain"],
    stats: ["row", "chips"],
    joined_date: ["plain", "stamp"],
};

export const MAX_LAYOUT_BLOCKS = 12;
export const MAX_LAYOUT_TITLE_LENGTH = 32;

// ── Container content controls (Profile Builder V3C) ─────────────────────────
// Each content block carries a small, fully-whitelisted `content` config that
// controls PRESENTATION only (how many items, what to prioritize, how dense, how
// visual). It never carries raw query/filter strings — every value is clamped to
// a hardcoded set and the output is rebuilt from scratch. Block types not listed
// here get no `content` config at all (e.g. bio/stats/joined_date).
export const ALLOWED_BLOCK_CONTENT_BY_TYPE = {
    writings: {
        count: [1, 2, 3],
        source: ["latest", "pinned_first"],
        density: ["comfortable", "compact"],
        imageShape: ["rounded", "square", "soft"],
        booleans: ["showMeta", "showExcerpt"],
    },
    pinned_writings: {
        count: [1, 2, 3],
        density: ["comfortable", "compact"],
        imageShape: ["rounded", "square", "soft"],
        booleans: ["showMeta", "showExcerpt"],
    },
    media: {
        count: [4, 6],
        source: ["latest"],
        density: ["comfortable", "compact"],
        imageShape: ["rounded", "square", "soft"],
        booleans: ["showMeta"],
    },
    opinions: {
        count: [2, 3],
        source: ["latest", "most_discussed"],
        density: ["comfortable", "compact"],
        booleans: ["showMeta", "showExcerpt"],
    },
    stories: {
        count: [3, 4],
        source: ["latest", "popular"],
        density: ["comfortable", "compact"],
        imageShape: ["rounded", "square", "soft"],
        booleans: ["showMeta", "showExcerpt"],
    },
    guestbook: {
        count: [3, 5],
        source: ["latest"],
        density: ["compact", "comfortable"],
        booleans: ["showMeta"],
    },
};

export const DEFAULT_BLOCK_CONTENT = {
    writings: { count: 3, source: "latest", density: "comfortable", imageShape: "rounded", showMeta: true, showExcerpt: true },
    pinned_writings: { count: 3, density: "comfortable", imageShape: "rounded", showMeta: true, showExcerpt: true },
    media: { count: 6, source: "latest", density: "comfortable", imageShape: "rounded", showMeta: false },
    opinions: { count: 3, source: "latest", density: "comfortable", showMeta: true, showExcerpt: true },
    stories: { count: 4, source: "latest", density: "comfortable", imageShape: "rounded", showMeta: true, showExcerpt: true },
    guestbook: { count: 3, source: "latest", density: "compact", showMeta: true },
};

// The content blocks that make up a default layout, in their default order.
// Guestbook stays near the top (matching pre-V3A behavior). bio/stats/joined_date
// are NOT included by default — they live in the hero — but remain valid block
// types so a user can surface them as standalone blocks later.
export const DEFAULT_LAYOUT_BLOCK_TYPES = [
    "guestbook",
    "writings",
    "media",
    "opinions",
    "stories",
    "pinned_writings",
];

export const DEFAULT_LAYOUT_TITLE_BY_TYPE = {
    guestbook: "Guestbook",
    writings: "Writings",
    media: "Media",
    opinions: "Opinions",
    stories: "Stories",
    pinned_writings: "Pinned",
    bio: "About",
    stats: "Stats",
    joined_date: "Joined",
};

export const DEFAULT_LAYOUT_WIDTH_BY_TYPE = {
    guestbook: "full",
    writings: "full",
    media: "full",
    opinions: "full",
    stories: "full",
    pinned_writings: "full",
    bio: "full",
    stats: "full",
    joined_date: "compact",
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR_RE =
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;

export const isValidColor = (value) => {
    if (typeof value !== "string") return false;
    const v = value.trim();
    if (v.length === 0 || v.length > 32) return false;
    return HEX_COLOR_RE.test(v) || RGB_COLOR_RE.test(v);
};

export const DEFAULT_PROFILE_THEME = {
    version: PROFILE_THEME_VERSION,
    presetId: "custom",
    colors: {
        text: "#ffffff",
        accent: "#D4A853",
        cardBackground: "rgba(255,255,255,0.55)",
        cardBorder: "rgba(255,255,255,0.22)",
    },
    typography: {
        font: "outfit",
        scale: "normal",
    },
    cards: {
        style: "glass",
        radius: "round",
        border: "soft",
        shadow: "soft",
    },
    background: {
        type: "none",
        angle: 135,
        from: "#7c3aed",
        to: "#2563eb",
        opacity: 1,
    },
    sections: ALLOWED_SECTION_IDS.map((id, index) => ({ id, visible: true, order: index })),
    stickers: [],
    layout: {
        mode: "stack",
        blocks: DEFAULT_LAYOUT_BLOCK_TYPES.map((type, index) => ({
            id: type,
            type,
            visible: true,
            order: index,
            width: DEFAULT_LAYOUT_WIDTH_BY_TYPE[type] || "full",
            style: "inherit",
            variant: ALLOWED_LAYOUT_VARIANTS_BY_TYPE[type][0],
            title: DEFAULT_LAYOUT_TITLE_BY_TYPE[type],
            ...(DEFAULT_BLOCK_CONTENT[type] ? { content: { ...DEFAULT_BLOCK_CONTENT[type] } } : {}),
        })),
    },
    hero: {
        mode: "stack",
        order: DEFAULT_HERO_ORDER,
        layout: { avatar: {}, name: {}, stats: {}, bio: {} },
    },
};

const clampNumber = (value, min, max, fallback) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
};

const pickEnum = (value, allowed, fallback) =>
    typeof value === "string" && allowed.includes(value) ? value : fallback;

/**
 * Sanitize a single block's `content` config (Profile Builder V3C). Returns
 * undefined for block types that have no content controls, so the key is simply
 * omitted. The object is rebuilt from scratch: only whitelisted keys survive,
 * count is clamped to the allowed set, enums fall back to the per-type default,
 * and booleans coerce to the default unless they are an explicit boolean. No
 * arbitrary strings (query/filter) can pass through.
 */
const sanitizeBlockContent = (type, raw) => {
    const spec = ALLOWED_BLOCK_CONTENT_BY_TYPE[type];
    if (!spec) return undefined; // this block type carries no content controls
    const def = DEFAULT_BLOCK_CONTENT[type];
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};

    if (spec.count) {
        const n = typeof src.count === "number" ? src.count : Number(src.count);
        out.count = spec.count.includes(n) ? n : def.count;
    }
    if (spec.source) out.source = pickEnum(src.source, spec.source, def.source);
    if (spec.density) out.density = pickEnum(src.density, spec.density, def.density);
    if (spec.imageShape) out.imageShape = pickEnum(src.imageShape, spec.imageShape, def.imageShape);
    (spec.booleans || []).forEach((key) => {
        out[key] = typeof src[key] === "boolean" ? src[key] : def[key];
    });

    return out;
};

const sanitizeColors = (raw) => {
    const base = DEFAULT_PROFILE_THEME.colors;
    const out = { ...base };
    if (!raw || typeof raw !== "object") return out;

    for (const key of Object.keys(base)) {
        if (raw[key] === undefined) continue;
        if (!isValidColor(raw[key])) {
            throw new AppError(400, `invalid color value for "${key}"`);
        }
        out[key] = raw[key].trim();
    }
    return out;
};

// Sanitize the page background. Rebuilt from scratch and never throws: type is a
// whitelisted enum, angle/opacity are clamped numbers, and the two gradient stops
// fall back to safe defaults when they aren't valid hex/rgba colors.
const sanitizeBackground = (raw) => {
    const def = DEFAULT_PROFILE_THEME.background;
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        type: pickEnum(obj.type, ALLOWED_BACKGROUND_TYPES, def.type),
        angle: clampNumber(obj.angle, 0, 360, def.angle),
        from: isValidColor(obj.from) ? obj.from.trim() : def.from,
        to: isValidColor(obj.to) ? obj.to.trim() : def.to,
        opacity: clampNumber(obj.opacity, 0, 1, def.opacity),
    };
};

const sanitizeSections = (raw) => {
    const defaults = DEFAULT_PROFILE_THEME.sections;
    if (!Array.isArray(raw)) return defaults.map((s) => ({ ...s }));

    const byId = new Map();
    raw.forEach((section, index) => {
        if (!section || typeof section !== "object") return;
        const id = section.id;
        if (!ALLOWED_SECTION_IDS.includes(id)) return; // strip unknown section ids
        if (byId.has(id)) return; // dedupe
        byId.set(id, {
            id,
            visible: REQUIRED_SECTION_IDS.includes(id) ? true : section.visible !== false,
            order: clampNumber(section.order, 0, ALLOWED_SECTION_IDS.length * 4, index),
        });
    });

    // Ensure every known section exists exactly once (fill any that were omitted).
    ALLOWED_SECTION_IDS.forEach((id, index) => {
        if (!byId.has(id)) {
            byId.set(id, {
                id,
                visible: true,
                order: ALLOWED_SECTION_IDS.length + index,
            });
        }
    });

    return Array.from(byId.values()).sort((a, b) => a.order - b.order);
};

// Sanitize the hero config. Rebuilt from scratch. The hero is a fixed vertical
// stack: `order` is the deduped element order (missing keys appended), and each
// `layout[key]` carries only isolated styling (align / card style / color / font
// / size). Never throws.
const sanitizeHeroOrder = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const order = [];
    for (const k of arr) {
        if (HERO_ELEMENT_KEYS.includes(k) && !seen.has(k)) {
            order.push(k);
            seen.add(k);
        }
    }
    for (const k of DEFAULT_HERO_ORDER) if (!seen.has(k)) order.push(k);
    return order;
};

const sanitizeHero = (raw) => {
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const order = sanitizeHeroOrder(obj.order);
    const rawLayout = obj.layout && typeof obj.layout === "object" ? obj.layout : {};
    const layout = {};
    for (const key of HERO_ELEMENT_KEYS) {
        const el = rawLayout[key] && typeof rawLayout[key] === "object" ? rawLayout[key] : {};
        layout[key] = {
            align: pickEnum(el.align, HERO_ELEMENT_ALIGNS, "left"),
            style: pickEnum(el.style, HERO_ELEMENT_STYLES, "none"),
            ...(HERO_ELEMENT_WIDTHS.includes(el.width) ? { width: el.width } : {}),
            ...(HERO_ELEMENT_BORDERS.includes(el.border) ? { border: el.border } : {}),
            ...(HERO_ELEMENT_RADII.includes(el.radius) ? { radius: el.radius } : {}),
            ...(HERO_ELEMENT_DIVIDERS.includes(el.divider) ? { divider: el.divider } : {}),
            ...(isValidColor(el.color) ? { color: el.color.trim() } : {}),
            ...(isValidColor(el.bgColor) ? { bgColor: el.bgColor.trim() } : {}),
            ...(typeof el.font === "string" && ALLOWED_FONTS.includes(el.font) ? { font: el.font } : {}),
            ...(typeof el.size === "string" && ALLOWED_SCALES.includes(el.size) ? { size: el.size } : {}),
            ...(Number.isFinite(Number(el.scale)) && Number(el.scale) >= 0.5 && Number(el.scale) <= 2.5
                ? { scale: Number(el.scale) }
                : {}),
        };
    }
    return { mode: "stack", order, layout };
};

const sanitizeStickers = (raw) => {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const sticker of raw) {
        if (out.length >= MAX_STICKERS) break; // truncate beyond the cap
        if (!sticker || typeof sticker !== "object") continue;
        if (!ALLOWED_STICKER_IDS.includes(sticker.id)) continue; // strip unknown ids
        out.push({
            id: sticker.id,
            x: clampNumber(sticker.x, 0, 100, 50),
            y: clampNumber(sticker.y, 0, 100, 50),
            rotation: clampNumber(sticker.rotation, -180, 180, 0),
            scale: clampNumber(sticker.scale, 0.3, 3, 1),
            ...(isValidColor(sticker.color) ? { color: sticker.color.trim() } : {}),
        });
    }
    return out;
};

// Is a given section id visible in a (sanitized) sections list? Used to seed a
// freshly-derived layout block's visibility from the legacy `sections` config.
const sectionIsVisible = (sections, id) => {
    if (!Array.isArray(sections)) return true;
    const found = sections.find((s) => s && s.id === id);
    if (!found) return true;
    return found.visible !== false;
};

// Titles are plain text only: strip any HTML tags, collapse whitespace, clamp
// length, and fall back to the default when empty. No CSS, no markup survives.
const sanitizeBlockTitle = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    const plain = value
        .replace(/<[^>]*>/g, "")
        .replace(/[\u0000-\u001F\u007F]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!plain) return fallback;
    return plain.slice(0, MAX_LAYOUT_TITLE_LENGTH);
};

// Attach a sanitized `content` config to a block object, but only for block
// types that actually carry content controls (others stay content-less).
const withBlockContent = (block, rawContent) => {
    const content = sanitizeBlockContent(block.type, rawContent);
    return content ? { ...block, content } : block;
};

// Sanitize a per-block `card` override (style/radius/border/shadow). Returns
// undefined when there's no override object — the block then inherits the global
// card style. Every field is whitelisted; unknown values fall back to defaults.
const sanitizeBlockCard = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    return {
        style: pickEnum(raw.style, ALLOWED_CARD_STYLES, DEFAULT_PROFILE_THEME.cards.style),
        radius: pickEnum(raw.radius, ALLOWED_CARD_RADII, DEFAULT_PROFILE_THEME.cards.radius),
        border: pickEnum(raw.border, ALLOWED_CARD_BORDERS, DEFAULT_PROFILE_THEME.cards.border),
        shadow: pickEnum(raw.shadow, ALLOWED_CARD_SHADOWS, DEFAULT_PROFILE_THEME.cards.shadow),
    };
};

const buildDefaultLayoutBlock = (type, order, sections) =>
    withBlockContent(
        {
            id: type,
            type,
            visible: sectionIsVisible(sections, type),
            order,
            width: DEFAULT_LAYOUT_WIDTH_BY_TYPE[type] || "full",
            style: "inherit",
            variant: ALLOWED_LAYOUT_VARIANTS_BY_TYPE[type][0],
            title: DEFAULT_LAYOUT_TITLE_BY_TYPE[type],
        },
        undefined
    );

/**
 * Sanitize the `layout` block. If absent or malformed, derive a default layout
 * from the (already-sanitized) sections so legacy v1 themes keep rendering. The
 * output is rebuilt from scratch: unknown block types are stripped, blocks are
 * deduped by type, order is clamped + re-indexed, and width/style/variant are
 * whitelisted. Never throws — it always returns a safe layout.
 */
const sanitizeLayout = (raw, sections) => {
    const byType = new Map();

    if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray(raw.blocks)) {
        raw.blocks.forEach((block, index) => {
            if (!block || typeof block !== "object") return;
            const type = typeof block.type === "string" ? block.type : block.id;
            if (!ALLOWED_LAYOUT_BLOCK_TYPES.includes(type)) return; // strip unknown types
            if (byType.has(type)) return; // dedupe by type
            const variants = ALLOWED_LAYOUT_VARIANTS_BY_TYPE[type];
            const card = sanitizeBlockCard(block.card);
            byType.set(
                type,
                withBlockContent(
                    {
                        id: type,
                        type,
                        visible: block.visible !== false,
                        order: clampNumber(block.order, 0, MAX_LAYOUT_BLOCKS * 4, index),
                        width: pickEnum(block.width, ALLOWED_LAYOUT_WIDTHS, DEFAULT_LAYOUT_WIDTH_BY_TYPE[type] || "full"),
                        style: pickEnum(block.style, ALLOWED_LAYOUT_STYLES, "inherit"),
                        variant: pickEnum(block.variant, variants, variants[0]),
                        title: sanitizeBlockTitle(block.title, DEFAULT_LAYOUT_TITLE_BY_TYPE[type]),
                        ...(card ? { card } : {}),
                    },
                    block.content
                )
            );
        });
    }

    // Ensure every default content block exists exactly once (fills any omitted),
    // so old themes — and partial payloads — still render a complete layout.
    DEFAULT_LAYOUT_BLOCK_TYPES.forEach((type, index) => {
        if (!byType.has(type)) {
            byType.set(type, buildDefaultLayoutBlock(type, MAX_LAYOUT_BLOCKS + index, sections));
        }
    });

    let blocks = Array.from(byType.values()).sort((a, b) => a.order - b.order);
    if (blocks.length > MAX_LAYOUT_BLOCKS) blocks = blocks.slice(0, MAX_LAYOUT_BLOCKS);
    // Re-index order to a clean 0..n-1 sequence.
    blocks = blocks.map((block, index) => ({ ...block, order: index }));

    return {
        mode: pickEnum(raw && raw.mode, ALLOWED_LAYOUT_MODES, "stack"),
        blocks,
    };
};

/**
 * Validate & normalize a raw theme object. Returns a clean theme safe to store.
 * Throws AppError(400) for hard failures (oversized payload, malformed object,
 * invalid color). Everything else is sanitized to safe defaults.
 */
export const validateProfileTheme = (rawTheme) => {
    if (rawTheme === null || rawTheme === undefined) {
        throw new AppError(400, "profileTheme is required");
    }

    if (typeof rawTheme !== "object" || Array.isArray(rawTheme)) {
        throw new AppError(400, "profileTheme must be an object");
    }

    // Size guard on the serialized payload.
    let serializedLength;
    try {
        serializedLength = Buffer.byteLength(JSON.stringify(rawTheme), "utf8");
    } catch {
        throw new AppError(400, "profileTheme is not serializable");
    }
    if (serializedLength > MAX_THEME_PAYLOAD_BYTES) {
        throw new AppError(400, "profileTheme payload is too large");
    }

    const typography = rawTheme.typography && typeof rawTheme.typography === "object" ? rawTheme.typography : {};
    const cards = rawTheme.cards && typeof rawTheme.cards === "object" ? rawTheme.cards : {};

    const sections = sanitizeSections(rawTheme.sections);

    return {
        version: PROFILE_THEME_VERSION,
        presetId: pickEnum(rawTheme.presetId, ALLOWED_PRESET_IDS, "custom"),
        colors: sanitizeColors(rawTheme.colors),
        typography: {
            font: pickEnum(typography.font, ALLOWED_FONTS, DEFAULT_PROFILE_THEME.typography.font),
            scale: pickEnum(typography.scale, ALLOWED_SCALES, DEFAULT_PROFILE_THEME.typography.scale),
        },
        cards: {
            style: pickEnum(cards.style, ALLOWED_CARD_STYLES, DEFAULT_PROFILE_THEME.cards.style),
            radius: pickEnum(cards.radius, ALLOWED_CARD_RADII, DEFAULT_PROFILE_THEME.cards.radius),
            border: pickEnum(cards.border, ALLOWED_CARD_BORDERS, DEFAULT_PROFILE_THEME.cards.border),
            shadow: pickEnum(cards.shadow, ALLOWED_CARD_SHADOWS, DEFAULT_PROFILE_THEME.cards.shadow),
        },
        background: sanitizeBackground(rawTheme.background),
        sections,
        stickers: sanitizeStickers(rawTheme.stickers),
        // Layout is derived from `sections` when absent, so legacy v1 themes keep
        // their visibility choices while gaining a default ordered layout.
        layout: sanitizeLayout(rawTheme.layout, sections),
        hero: sanitizeHero(rawTheme.hero),
    };
};
