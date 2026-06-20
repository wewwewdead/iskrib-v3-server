import crypto from "node:crypto";
import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";
import { getUserByUsernameLite } from "./userLookupService.js";

// Count at most one visit per viewer/profile per 12 hours.
const VISIT_WINDOW_MS = 12 * 60 * 60 * 1000;
const HASH_SALT = process.env.VISIT_HASH_SALT || "iskrib-visit-salt";

/**
 * One-way, privacy-safe fingerprint for anonymous visitors. We never store the
 * raw IP/user-agent — only a salted hash used to throttle repeat visits.
 */
export const computeVisitorHash = (profileUserId, ip, userAgent) =>
    crypto
        .createHash("sha256")
        .update(`${profileUserId}|${ip || ""}|${userAgent || ""}|${HASH_SALT}`)
        .digest("hex");

export const recordProfileVisitService = async (username, { visitorUserId, ip, userAgent }) => {
    const profileUser = await getUserByUsernameLite(username);

    // Don't record a user visiting their own profile.
    if (visitorUserId && visitorUserId === profileUser.id) {
        return { counted: false, reason: "self" };
    }

    const visitorHash = visitorUserId ? null : computeVisitorHash(profileUser.id, ip, userAgent);
    const sinceIso = new Date(Date.now() - VISIT_WINDOW_MS).toISOString();

    // Throttle: skip if this viewer already visited within the window.
    let dedupeQuery = supabase
        .from("profile_visits")
        .select("id")
        .eq("profile_user_id", profileUser.id)
        .gte("created_at", sinceIso)
        .limit(1);

    dedupeQuery = visitorUserId
        ? dedupeQuery.eq("visitor_user_id", visitorUserId)
        : dedupeQuery.eq("visitor_hash", visitorHash);

    const { data: existing, error: dedupeError } = await dedupeQuery;
    if (dedupeError) {
        console.error("supabase error checking visit dedupe:", dedupeError.message);
        throw new AppError(500, "error recording visit");
    }

    if (existing && existing.length > 0) {
        return { counted: false, reason: "throttled" };
    }

    const { error: insertError } = await supabase.from("profile_visits").insert({
        profile_user_id: profileUser.id,
        visitor_user_id: visitorUserId || null,
        visitor_hash: visitorHash,
    });

    if (insertError) {
        console.error("supabase error inserting visit:", insertError.message);
        throw new AppError(500, "error recording visit");
    }

    // Intentionally no owner notification here — visits are high-volume and
    // notifying per-visit would be noisy. (See deferred notes.)
    return { counted: true };
};
