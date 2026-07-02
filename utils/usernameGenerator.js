import supabase from "../services/supabase.js";
import { USERNAME_REGEX, RESERVED_USERNAMES } from "./validation.js";

// Turn arbitrary text (a display name or a requested handle) into a URL-safe slug.
const slugify = (value) =>
    String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

const randomSuffix = () => Math.random().toString(36).slice(2, 6);

const isReserved = (candidate) => RESERVED_USERNAMES.has(candidate.toLowerCase());

// Case-insensitive existence check against the unique lower(username) index.
const isUsernameTaken = async (candidate) => {
    const { data, error } = await supabase
        .from('users')
        .select('id')
        .ilike('username', candidate)
        .limit(1);
    if (error) {
        throw { status: 500, error: 'supabase error while checking username availability' };
    }
    return Boolean(data && data.length > 0);
};

// Normalize a raw seed into a valid username base (3-50 chars, valid format, not reserved).
// Falls back to a random `user-xxxx` handle when the seed can't produce something usable.
const normalizeBase = (raw) => {
    let base = slugify(raw);
    if (!base || base.length < 3 || !USERNAME_REGEX.test(base) || isReserved(base)) {
        base = `user-${randomSuffix()}`;
    }
    return base.slice(0, 50);
};

/**
 * Guarantees a unique, valid username so a user record is never created without one.
 * Prefers an explicitly requested handle, then the display name, then a random handle.
 * On collision (or reserved name) it appends a short random suffix until free.
 *
 * @param {{ preferred?: string, name?: string }} options
 * @returns {Promise<string>} a username guaranteed unique at generation time
 */
export const generateUniqueUsername = async ({ preferred, name } = {}) => {
    const base = normalizeBase(preferred || name);

    let candidate = base;
    let attempts = 0;
    while ((isReserved(candidate) || await isUsernameTaken(candidate)) && attempts < 15) {
        candidate = `${base.slice(0, 44)}-${randomSuffix()}`;
        attempts++;
    }
    return candidate;
};
