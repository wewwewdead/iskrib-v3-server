import { describe, expect, it } from "vitest";
import {
    validateGuestbookMessage,
    isBlockedMessage,
    GUESTBOOK_MAX_LENGTH,
} from "../utils/guestbookValidation.js";

describe("validateGuestbookMessage", () => {
    it("trims and returns a valid message", () => {
        expect(validateGuestbookMessage("  hello there  ")).toBe("hello there");
    });

    it("accepts a message exactly at the max length", () => {
        const msg = "a".repeat(GUESTBOOK_MAX_LENGTH);
        expect(validateGuestbookMessage(msg)).toBe(msg);
    });

    it("rejects an empty message", () => {
        expect(() => validateGuestbookMessage("")).toThrow(/empty/i);
    });

    it("rejects a whitespace-only message", () => {
        expect(() => validateGuestbookMessage("   \n\t ")).toThrow(/empty/i);
    });

    it("rejects a message over the max length", () => {
        expect(() => validateGuestbookMessage("a".repeat(GUESTBOOK_MAX_LENGTH + 1))).toThrow(/280/);
    });

    it("rejects non-string input", () => {
        expect(() => validateGuestbookMessage(null)).toThrow();
        expect(() => validateGuestbookMessage(42)).toThrow();
        expect(() => validateGuestbookMessage({ message: "hi" })).toThrow();
    });

    it("does not strip plain text content (rendered as text on the client)", () => {
        // The raw text is preserved; the client renders it as a text node, never HTML.
        const msg = validateGuestbookMessage("<b>not bold</b> & co");
        expect(msg).toBe("<b>not bold</b> & co");
    });

    it("blocks messages flagged by the placeholder moderation list", () => {
        expect(isBlockedMessage("kys loser")).toBe(true);
        expect(() => validateGuestbookMessage("kys loser")).toThrow(/guidelines/i);
    });

    it("allows ordinary messages through moderation", () => {
        expect(isBlockedMessage("love your profile!")).toBe(false);
    });
});
