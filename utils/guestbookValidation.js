import { AppError } from "./AppError.js";

export const GUESTBOOK_MAX_LENGTH = 280;

// Minimal placeholder moderation list. Intentionally small — real moderation is
// out of scope for this pass. Extend or replace with a service later.
const BLOCKED_TERMS = ["kill yourself", "kys"];

/**
 * Placeholder profanity/abuse check. Returns true if the message should be
 * blocked. Kept deliberately simple.
 */
export const isBlockedMessage = (message) => {
    if (typeof message !== "string") return false;
    const lowered = message.toLowerCase();
    return BLOCKED_TERMS.some((term) => lowered.includes(term));
};

/**
 * Validate & normalize a guestbook message.
 * - must be a non-empty string after trimming
 * - max 280 characters
 * - returned as plain text (rendered as text on the client, never HTML)
 * Throws AppError(400) on invalid input.
 */
export const validateGuestbookMessage = (raw) => {
    if (typeof raw !== "string") {
        throw new AppError(400, "message must be a string");
    }

    const trimmed = raw.trim();

    if (trimmed.length === 0) {
        throw new AppError(400, "message cannot be empty");
    }

    if (trimmed.length > GUESTBOOK_MAX_LENGTH) {
        throw new AppError(400, `message must be at most ${GUESTBOOK_MAX_LENGTH} characters`);
    }

    if (isBlockedMessage(trimmed)) {
        throw new AppError(400, "message violates community guidelines");
    }

    return trimmed;
};
