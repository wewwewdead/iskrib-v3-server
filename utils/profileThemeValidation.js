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

export const PROFILE_THEME_VERSION = 1;

// Max serialized size of an incoming theme payload (defense against abuse).
export const MAX_THEME_PAYLOAD_BYTES = 8 * 1024; // 8 KB

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
export const ALLOWED_STICKER_IDS = [
    "sparkle-01",
    "star-01",
    "heart-01",
    "moon-01",
    "sun-01",
    "flower-01",
    "bolt-01",
    "cloud-01",
    "quote-01",
    "leaf-01",
    "music-01",
    "coffee-01",
];

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
    sections: ALLOWED_SECTION_IDS.map((id, index) => ({ id, visible: true, order: index })),
    stickers: [],
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
        });
    }
    return out;
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
        sections: sanitizeSections(rawTheme.sections),
        stickers: sanitizeStickers(rawTheme.stickers),
    };
};
