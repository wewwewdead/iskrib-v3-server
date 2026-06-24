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

export const ALLOWED_FONTS = [
    "outfit",
    "lexend",
    "spaceGrotesk",
    "lora",
    "spectral",
    "garamond",
    "playfair",
    "dmSerif",
    "fraunces",
    "comfortaa",
    "caveat",
    "patrick",
];

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

// ── Container design controls (Profile Builder V5 — Container Design Studio) ──
// Each layout block carries a fully-whitelisted `design` object that controls its
// container chrome: surface, tone tint, corner radius, shadow, border, padding,
// header treatment, title alignment and accent. NO raw CSS, NO custom class names,
// NO arbitrary colors — every value is a hardcoded enum mapped to a fixed CSS
// class / data-attribute on the client. The object is rebuilt from scratch on save.
export const ALLOWED_DESIGN_SURFACES = ["paper", "glass", "solid", "minimal", "framed"];
export const ALLOWED_DESIGN_TONES = ["default", "warm", "cool", "ink", "rose", "forest", "ocean"];
export const ALLOWED_DESIGN_RADII = ["soft", "round", "sharp"];
export const ALLOWED_DESIGN_SHADOWS = ["none", "soft", "lifted"];
export const ALLOWED_DESIGN_BORDERS = ["none", "hairline", "accent"];
export const ALLOWED_DESIGN_PADDINGS = ["compact", "comfortable", "spacious"];
export const ALLOWED_DESIGN_HEADERS = ["plain", "label", "banner", "tab"];
export const ALLOWED_DESIGN_TITLE_ALIGNS = ["left", "center"];
export const ALLOWED_DESIGN_ACCENTS = ["theme", "amber", "blue", "green", "rose"];

// Safe defaults — these reproduce the pre-V5 default container look (glass card,
// round corners, soft shadow, hairline border, comfortable padding, simple label
// header, left-aligned title, theme accent). Old blocks get these defaults.
export const DEFAULT_BLOCK_DESIGN = {
    surface: "glass",
    tone: "default",
    radius: "round",
    shadow: "soft",
    border: "hairline",
    padding: "comfortable",
    header: "label",
    titleAlign: "left",
    accent: "theme",
};

// ── V5.1 Design Studio — deeper per-container controls (all OPTIONAL on save) ──
// Mirrors client/.../builder/profileThemeConstants.js. Every value is a
// whitelisted enum, a validated color, or a clamped number — never raw CSS.
export const ALLOWED_FILL_TYPES = ["surface", "solid", "gradient", "pattern"];
export const ALLOWED_PATTERNS = ["dots", "grid", "lines", "diagonal", "crosshatch", "paper"];
export const ALLOWED_PATTERN_SCALES = ["s", "m", "l"];
export const ALLOWED_BORDER_STYLES = ["solid", "dashed", "dotted", "double"];
export const ALLOWED_TITLE_SIZES = ["sm", "md", "lg", "xl"];
export const ALLOWED_TITLE_WEIGHTS = ["normal", "medium", "bold", "black"];
export const ALLOWED_TITLE_SPACINGS = ["tight", "normal", "wide"];
export const ALLOWED_TITLE_CASES = ["none", "upper"];
export const ALLOWED_HOVER_FX = ["none", "lift", "glow"];

// Numeric ranges {min,max} for clamping the optional numeric design fields.
export const DESIGN_RANGES = {
    gradAngle: { min: 0, max: 360 },
    fillOpacity: { min: 0.1, max: 1 },
    blur: { min: 0, max: 30 },
    patternOpacity: { min: 0.05, max: 1 },
    radiusPx: { min: 0, max: 40 },
    borderWidth: { min: 0, max: 8 },
    paddingPx: { min: 4, max: 48 },
    shadowStrength: { min: 0, max: 1 },
    tilt: { min: -6, max: 6 },
    opacity: { min: 0.3, max: 1 },
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
            design: { ...DEFAULT_BLOCK_DESIGN },
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
            // V5.2 — a hero element can carry the same container `design` object so
            // it's edited with the container tools. Only stored when present; surface
            // defaults to "minimal" (no card) for hero via the "minimal" style hint.
            ...(el.design && typeof el.design === "object" && !Array.isArray(el.design)
                ? { design: sanitizeHeroElementDesign(el.design) }
                : {}),
        };
    }
    return { mode: "stack", order, layout };
};

// Stickers were deprecated as a customization surface in Profile Builder V5.
// Validation stays TOLERANT of old payloads (no throw), but no sticker data is
// ever persisted again: any incoming `stickers` is dropped to an empty array, so
// old themes don't crash, new saves add none, and theme remix copies none.
// (MAX_STICKERS / ALLOWED_STICKER_IDS are kept exported above for back-compat.)
const sanitizeStickers = () => [];

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

// Map a legacy per-block card / style onto the V5 design surface/radius/shadow/
// border, so old (pre-V5) themes keep their look when they gain a design object.
const LEGACY_SHADOW_TO_DESIGN = { none: "none", soft: "soft", strong: "lifted" };
const LEGACY_BORDER_TO_DESIGN = { none: "none", soft: "hairline", bold: "accent" };

const deriveDesignFromLegacy = (block) => {
    const card = block && typeof block.card === "object" ? block.card : null;
    const style = block && block.style;
    let surface = DEFAULT_BLOCK_DESIGN.surface;
    if (card && ALLOWED_DESIGN_SURFACES.includes(card.style)) surface = card.style;
    else if (typeof style === "string" && style !== "inherit" && ALLOWED_DESIGN_SURFACES.includes(style)) {
        surface = style;
    }
    return {
        surface,
        radius: card && ALLOWED_DESIGN_RADII.includes(card.radius) ? card.radius : DEFAULT_BLOCK_DESIGN.radius,
        shadow: (card && LEGACY_SHADOW_TO_DESIGN[card.shadow]) || DEFAULT_BLOCK_DESIGN.shadow,
        border: (card && LEGACY_BORDER_TO_DESIGN[card.border]) || DEFAULT_BLOCK_DESIGN.border,
    };
};

/**
 * Sanitize a block's `design` object (Profile Builder V5). The output is rebuilt
 * from scratch: every field is a whitelisted enum, unknown keys are dropped, and
 * NO raw CSS / class name / arbitrary color can pass through. When `design` is
 * absent (legacy themes), surface/radius/shadow/border are derived from the old
 * `style`/`card` so the container keeps its look; the rest get safe defaults.
 * Always returns a complete design object (never throws).
 */
// Optional-field helpers: return undefined (→ key omitted) unless the value is
// valid, so a default design stays minimal and the payload only grows for blocks
// the user actually customized.
const enumOpt = (raw, allowed) => (typeof raw === "string" && allowed.includes(raw) ? raw : undefined);
const colorOpt = (raw) => (isValidColor(raw) ? raw.trim() : undefined);
const numOpt = (raw, range) => {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(range.max, Math.max(range.min, n));
};

// Build the optional V5.1 Design Studio overrides (fill / frame / title / effects).
// Each key is included ONLY when its value is valid; everything is whitelisted,
// validated (colors) or clamped (numbers) — no raw CSS can survive.
const sanitizeDesignExtras = (src) => {
    if (!src) return {};
    const out = {};
    const setNum = (k) => {
        const v = numOpt(src[k], DESIGN_RANGES[k]);
        if (v !== undefined) out[k] = v;
    };
    const setEnum = (k, allowed) => {
        const v = enumOpt(src[k], allowed);
        if (v !== undefined) out[k] = v;
    };
    const setColor = (k) => {
        const v = colorOpt(src[k]);
        if (v !== undefined) out[k] = v;
    };

    // Fill: type defaults to "surface" (omitted); gradient/pattern carry their parts.
    const fillType = enumOpt(src.fillType, ALLOWED_FILL_TYPES);
    if (fillType && fillType !== "surface") out.fillType = fillType;
    setColor("gradFrom");
    setColor("gradTo");
    setNum("gradAngle");
    setEnum("pattern", ALLOWED_PATTERNS);
    setColor("patternColor");
    setEnum("patternScale", ALLOWED_PATTERN_SCALES);
    setNum("patternOpacity");
    setNum("fillOpacity");
    setNum("blur");

    // Frame: numeric overrides + border style/color + colored glow.
    setNum("radiusPx");
    setNum("borderWidth");
    setEnum("borderStyle", ALLOWED_BORDER_STYLES);
    setColor("borderColor");
    setNum("shadowStrength");
    setColor("glow");
    setNum("paddingPx");

    // Title typography.
    setEnum("titleSize", ALLOWED_TITLE_SIZES);
    setEnum("titleWeight", ALLOWED_TITLE_WEIGHTS);
    setEnum("titleSpacing", ALLOWED_TITLE_SPACINGS);
    setEnum("titleCase", ALLOWED_TITLE_CASES);

    // Effects.
    setNum("tilt");
    setEnum("hover", ALLOWED_HOVER_FX);
    setNum("opacity");

    return out;
};

const sanitizeBlockDesign = (raw, block) => {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    const legacy = deriveDesignFromLegacy(block);
    return {
        surface: pickEnum(src && src.surface, ALLOWED_DESIGN_SURFACES, legacy.surface),
        tone: pickEnum(src && src.tone, ALLOWED_DESIGN_TONES, DEFAULT_BLOCK_DESIGN.tone),
        radius: pickEnum(src && src.radius, ALLOWED_DESIGN_RADII, legacy.radius),
        shadow: pickEnum(src && src.shadow, ALLOWED_DESIGN_SHADOWS, legacy.shadow),
        border: pickEnum(src && src.border, ALLOWED_DESIGN_BORDERS, legacy.border),
        padding: pickEnum(src && src.padding, ALLOWED_DESIGN_PADDINGS, DEFAULT_BLOCK_DESIGN.padding),
        header: pickEnum(src && src.header, ALLOWED_DESIGN_HEADERS, DEFAULT_BLOCK_DESIGN.header),
        titleAlign: pickEnum(src && src.titleAlign, ALLOWED_DESIGN_TITLE_ALIGNS, DEFAULT_BLOCK_DESIGN.titleAlign),
        accent: pickEnum(src && src.accent, ALLOWED_DESIGN_ACCENTS, DEFAULT_BLOCK_DESIGN.accent),
        // Optional per-container overrides (only stored when set): a custom text
        // color, background fill and font. Colors are validated hex/rgba (never raw
        // CSS); font is a whitelisted family key. Absent = inherit the page.
        ...(src && isValidColor(src.textColor) ? { textColor: src.textColor.trim() } : {}),
        ...(src && isValidColor(src.bgColor) ? { bgColor: src.bgColor.trim() } : {}),
        ...(src && typeof src.font === "string" && ALLOWED_FONTS.includes(src.font) ? { font: src.font } : {}),
        // V5.1 Design Studio overrides (fill / frame / title / effects).
        ...sanitizeDesignExtras(src),
    };
};

// Attach a sanitized `design` object to every block (always present in V5).
const withBlockDesign = (block, rawDesign) => ({ ...block, design: sanitizeBlockDesign(rawDesign, block) });

// Hero elements default to NO card chrome (minimal surface, no shadow/border) — a
// bare avatar/name/bio stays clean. Same shape + tools as a container design.
const HERO_DEFAULT_DESIGN = {
    surface: "minimal",
    tone: "default",
    radius: "soft",
    shadow: "none",
    border: "none",
    padding: "comfortable",
    header: "label",
    titleAlign: "left",
    accent: "theme",
};

const sanitizeHeroElementDesign = (raw) => {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    return {
        surface: pickEnum(src && src.surface, ALLOWED_DESIGN_SURFACES, HERO_DEFAULT_DESIGN.surface),
        tone: pickEnum(src && src.tone, ALLOWED_DESIGN_TONES, HERO_DEFAULT_DESIGN.tone),
        radius: pickEnum(src && src.radius, ALLOWED_DESIGN_RADII, HERO_DEFAULT_DESIGN.radius),
        shadow: pickEnum(src && src.shadow, ALLOWED_DESIGN_SHADOWS, HERO_DEFAULT_DESIGN.shadow),
        border: pickEnum(src && src.border, ALLOWED_DESIGN_BORDERS, HERO_DEFAULT_DESIGN.border),
        padding: pickEnum(src && src.padding, ALLOWED_DESIGN_PADDINGS, HERO_DEFAULT_DESIGN.padding),
        header: pickEnum(src && src.header, ALLOWED_DESIGN_HEADERS, HERO_DEFAULT_DESIGN.header),
        titleAlign: pickEnum(src && src.titleAlign, ALLOWED_DESIGN_TITLE_ALIGNS, HERO_DEFAULT_DESIGN.titleAlign),
        accent: pickEnum(src && src.accent, ALLOWED_DESIGN_ACCENTS, HERO_DEFAULT_DESIGN.accent),
        ...(src && isValidColor(src.textColor) ? { textColor: src.textColor.trim() } : {}),
        ...(src && isValidColor(src.bgColor) ? { bgColor: src.bgColor.trim() } : {}),
        ...(src && typeof src.font === "string" && ALLOWED_FONTS.includes(src.font) ? { font: src.font } : {}),
        ...sanitizeDesignExtras(src),
    };
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
    withBlockDesign(
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
        ),
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
                withBlockDesign(
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
                    ),
                    block.design
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
