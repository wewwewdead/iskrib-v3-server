/**
 * Notification target model.
 *
 * A notification's "target" is the thing it is about — the destination a click
 * should open. Each builder returns an object whose keys map directly to the
 * `notifications` target columns, so it can be spread into an insert payload.
 */

export const NOTIFICATION_TARGET_TYPES = Object.freeze({
    USER_PROFILE: "user_profile",
    OWN_PROFILE: "own_profile",
    PROFILE_GUESTBOOK: "profile_guestbook",
    JOURNAL: "journal",
    OPINION: "opinion",
    COMMENT_THREAD: "comment_thread",
    CONSTELLATION: "constellation",
    UNKNOWN: "unknown",
});

export const ALLOWED_TARGET_TYPES = Object.freeze(Object.values(NOTIFICATION_TARGET_TYPES));

export const isAllowedTargetType = (type) => ALLOWED_TARGET_TYPES.includes(type);

/**
 * Keep target_metadata small and safe: a flat object of scalar values only.
 */
export const sanitizeTargetMetadata = (metadata) => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return {};
    }
    const out = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (value === undefined || value === null) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            out[key] = value;
        }
    }
    return out;
};

const target = (type, { targetId = null, targetUserId = null, metadata = {} } = {}) => ({
    target_type: isAllowedTargetType(type) ? type : NOTIFICATION_TARGET_TYPES.UNKNOWN,
    target_id: targetId || null,
    target_user_id: targetUserId || null,
    target_metadata: sanitizeTargetMetadata(metadata),
});

// ── Builders ─────────────────────────────────────────────────────────────────

export const buildUserProfileTarget = (userId, metadata = {}) =>
    target(NOTIFICATION_TARGET_TYPES.USER_PROFILE, { targetUserId: userId, metadata });

export const buildOwnProfileTarget = (userId, metadata = {}) =>
    target(NOTIFICATION_TARGET_TYPES.OWN_PROFILE, { targetUserId: userId, metadata });

export const buildGuestbookTarget = ({ profileUserId, entryId, actorUserId } = {}) =>
    target(NOTIFICATION_TARGET_TYPES.PROFILE_GUESTBOOK, {
        targetId: entryId,
        targetUserId: profileUserId,
        metadata: { actorUserId },
    });

export const buildJournalTarget = (journalId, metadata = {}) =>
    target(NOTIFICATION_TARGET_TYPES.JOURNAL, { targetId: journalId, metadata });

export const buildOpinionTarget = (opinionId, metadata = {}) =>
    target(NOTIFICATION_TARGET_TYPES.OPINION, { targetId: opinionId, metadata });

export const buildCommentThreadTarget = (journalId, metadata = {}) =>
    target(NOTIFICATION_TARGET_TYPES.COMMENT_THREAD, { targetId: journalId, metadata });

export const buildUnknownTarget = () => target(NOTIFICATION_TARGET_TYPES.UNKNOWN);
