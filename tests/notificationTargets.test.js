import { describe, expect, it } from "vitest";
import {
    NOTIFICATION_TARGET_TYPES,
    ALLOWED_TARGET_TYPES,
    isAllowedTargetType,
    sanitizeTargetMetadata,
    buildUserProfileTarget,
    buildOwnProfileTarget,
    buildGuestbookTarget,
    buildJournalTarget,
    buildOpinionTarget,
    buildUnknownTarget,
} from "../utils/notificationTargets.js";

describe("notification target builders", () => {
    it("builds a user_profile target pointing at the actor", () => {
        expect(buildUserProfileTarget("user-1")).toEqual({
            target_type: "user_profile",
            target_id: null,
            target_user_id: "user-1",
            target_metadata: {},
        });
    });

    it("builds an own_profile target", () => {
        expect(buildOwnProfileTarget("user-1").target_type).toBe("own_profile");
    });

    it("builds a guestbook target with entry id, owner, and actor metadata", () => {
        expect(
            buildGuestbookTarget({ profileUserId: "owner-1", entryId: "entry-9", actorUserId: "actor-2" })
        ).toEqual({
            target_type: "profile_guestbook",
            target_id: "entry-9",
            target_user_id: "owner-1",
            target_metadata: { actorUserId: "actor-2" },
        });
    });

    it("builds journal and opinion content targets", () => {
        expect(buildJournalTarget("j-1")).toMatchObject({ target_type: "journal", target_id: "j-1" });
        expect(buildOpinionTarget("o-1")).toMatchObject({ target_type: "opinion", target_id: "o-1" });
    });

    it("builds an unknown fallback target", () => {
        expect(buildUnknownTarget()).toEqual({
            target_type: "unknown",
            target_id: null,
            target_user_id: null,
            target_metadata: {},
        });
    });

    it("normalizes missing ids to null", () => {
        expect(buildJournalTarget(undefined).target_id).toBeNull();
        expect(buildUserProfileTarget(null).target_user_id).toBeNull();
    });

    it("sanitizes metadata to flat scalar values", () => {
        expect(
            sanitizeTargetMetadata({ a: "x", b: 2, c: true, d: null, e: undefined, f: { nested: 1 }, g: [1, 2] })
        ).toEqual({ a: "x", b: 2, c: true });
        expect(sanitizeTargetMetadata(null)).toEqual({});
        expect(sanitizeTargetMetadata([1, 2])).toEqual({});
    });

    it("exposes a frozen, complete allowed-type list", () => {
        expect(ALLOWED_TARGET_TYPES).toContain(NOTIFICATION_TARGET_TYPES.PROFILE_GUESTBOOK);
        expect(isAllowedTargetType("user_profile")).toBe(true);
        expect(isAllowedTargetType("totally_made_up")).toBe(false);
    });
});
