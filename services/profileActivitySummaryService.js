import supabase from "./supabase.js";

/**
 * Lightweight, owner-only activity summary (Phase 3).
 *
 * Returns rolling 7-day counts for the caller's own profile room. Uses cheap
 * `head: true` count queries (no rows transferred). Each count is independently
 * resilient — a missing table/column yields 0 rather than failing the request.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const weekAgoIso = () => new Date(Date.now() - WEEK_MS).toISOString();

const safeCount = async (buildQuery) => {
    try {
        const { count, error } = await buildQuery();
        if (error || typeof count !== "number") return 0;
        return count;
    } catch {
        return 0;
    }
};

export const getProfileActivitySummaryService = async (userId) => {
    const sinceIso = weekAgoIso();

    const [visitsThisWeek, guestbookEntriesThisWeek, remixesThisWeek] = await Promise.all([
        safeCount(() =>
            supabase
                .from("profile_visits")
                .select("id", { count: "exact", head: true })
                .eq("profile_user_id", userId)
                .gte("created_at", sinceIso)
        ),
        safeCount(() =>
            supabase
                .from("profile_guestbook_entries")
                .select("id", { count: "exact", head: true })
                .eq("profile_user_id", userId)
                .is("deleted_at", null)
                .gte("created_at", sinceIso)
        ),
        safeCount(() =>
            supabase
                .from("profile_theme_remixes")
                .select("id", { count: "exact", head: true })
                .eq("source_user_id", userId)
                .gte("created_at", sinceIso)
        ),
    ]);

    return { visitsThisWeek, guestbookEntriesThisWeek, remixesThisWeek };
};
