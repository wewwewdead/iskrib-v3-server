import supabase from "./supabase.js";
import { getUserByUsernameLite } from "./userLookupService.js";
import { getProfileMediaService } from "./getService.js";

/**
 * Profile Builder V3B — Real Content Blocks.
 *
 * Returns lightweight, PUBLIC-ONLY previews for a profile's layout home so the
 * designed room feels lived-in. This is a teaser surface — the full tabs/routes
 * stay the real destinations.
 *
 * Safety + performance:
 *   - Only public/published content is returned (drafts/private never appear),
 *     using the exact same filters the visited-profile read paths use.
 *   - Every query is hard-bounded by a small limit (no unbounded feeds, no N+1).
 *   - Writings + media are derived from ONE recent-journals query.
 *   - Each content group is wrapped so one failing query degrades to [] rather
 *     than failing the whole endpoint.
 */

// Lean select — no heavy `content` jsonb, no interaction-count joins. The full
// content is fetched on demand by the content viewer when a card is clicked.
const JOURNAL_PREVIEW_SELECT = "id, title, preview_text, thumbnail_url, created_at, post_type";

const PREVIEW_LIMITS = {
    journalsWindow: 12, // recent journals scanned to fill writings + media
    writings: 3,
    media: 6,
    opinions: 3,
    stories: 4,
    pinned: 3,
};

const shapeWriting = (j) => ({
    id: j.id,
    title: j.title || "",
    preview_text: j.preview_text || "",
    thumbnail_url: j.thumbnail_url || null,
    created_at: j.created_at,
    post_type: j.post_type || null,
});

// Media = the user's actual uploaded images (journal-images / avatars /
// background), the SAME source as the Media tab — not just journal covers.
const shapeMediaItem = (m) => ({
    id: m.id,
    title: "",
    thumbnail_url: m.cardUrl || m.thumbnailUrl || m.url,
    bucket: m.bucket || null,
});

const shapeOpinion = (o) => ({
    id: o.id,
    opinion: o.opinion || "",
    created_at: o.created_at,
    reply_count: o.reply_count || 0,
});

const shapeStory = (s) => ({
    id: s.id,
    title: s.title || "",
    description: s.description || "",
    cover_url: s.cover_url || null,
    status: s.status || null,
    vote_count: s.vote_count || 0,
    read_count: s.read_count || 0,
    created_at: s.created_at,
});

// ── Bounded, public-safe fetchers (each resilient → [] on error) ─────────────

const fetchPinnedIds = async (userId) => {
    try {
        const { data, error } = await supabase
            .from("pinned_posts")
            .select("journal_id, position")
            .eq("user_id", userId)
            .order("position", { ascending: true })
            .limit(PREVIEW_LIMITS.pinned);
        if (error) throw error;
        return (data || []).map((p) => ({ id: p.journal_id, position: p.position }));
    } catch (err) {
        console.error("non-fatal: profile-preview pinned ids error:", err?.message || err);
        return [];
    }
};

const fetchRecentJournals = async (userId, excludeIds) => {
    try {
        let query = supabase
            .from("journals")
            .select(JOURNAL_PREVIEW_SELECT)
            .eq("user_id", userId)
            .eq("privacy", "public")
            .eq("status", "published")
            .order("created_at", { ascending: false })
            .limit(PREVIEW_LIMITS.journalsWindow);
        if (excludeIds.length > 0) {
            query = query.not("id", "in", `(${excludeIds.join(",")})`);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("non-fatal: profile-preview journals error:", err?.message || err);
        return [];
    }
};

const fetchPinnedJournals = async (pins) => {
    if (pins.length === 0) return [];
    try {
        const ids = pins.map((p) => p.id);
        const { data, error } = await supabase
            .from("journals")
            .select(JOURNAL_PREVIEW_SELECT)
            .in("id", ids)
            .eq("privacy", "public")
            .eq("status", "published");
        if (error) throw error;
        // Restore the author's chosen pin order.
        const positionById = new Map(pins.map((p) => [p.id, p.position]));
        return (data || []).sort(
            (a, b) => (positionById.get(a.id) ?? 0) - (positionById.get(b.id) ?? 0)
        );
    } catch (err) {
        console.error("non-fatal: profile-preview pinned journals error:", err?.message || err);
        return [];
    }
};

// Media = real uploaded images from storage (reuses the Media-tab listing), so
// the preview matches the full Media gallery (avatars, post images, background).
const fetchMediaForPreview = async (userId) => {
    try {
        const result = await getProfileMediaService(userId, PREVIEW_LIMITS.media);
        return Array.isArray(result?.data) ? result.data : [];
    } catch (err) {
        console.error("non-fatal: profile-preview media error:", err?.message || err);
        return [];
    }
};

const fetchOpinions = async (userId) => {
    try {
        const { data, error } = await supabase
            .from("opinions")
            .select("id, opinion, created_at, reply_count")
            .eq("user_id", userId)
            .is("parent_id", null)
            .order("id", { ascending: false })
            .limit(PREVIEW_LIMITS.opinions);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("non-fatal: profile-preview opinions error:", err?.message || err);
        return [];
    }
};

const fetchStories = async (userId) => {
    try {
        const { data, error } = await supabase
            .from("stories")
            .select("id, title, description, cover_url, status, vote_count, read_count, created_at")
            .eq("author_id", userId)
            .eq("privacy", "public")
            .order("created_at", { ascending: false })
            .limit(PREVIEW_LIMITS.stories);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("non-fatal: profile-preview stories error:", err?.message || err);
        return [];
    }
};

/**
 * Build the grouped public preview for a profile (by username).
 * Throws AppError(404) when the username does not resolve to a user.
 */
export const getProfilePreviewService = async (username) => {
    // Resolve username → user (throws AppError 400/404/500). image_url/badge are
    // included so clicked cards can hand the author identity to the content viewer.
    const user = await getUserByUsernameLite(username);

    const pins = await fetchPinnedIds(user.id);
    const pinnedIds = pins.map((p) => p.id);

    const [recentJournals, mediaItems, pinnedJournals, opinions, stories] = await Promise.all([
        fetchRecentJournals(user.id, pinnedIds),
        fetchMediaForPreview(user.id),
        fetchPinnedJournals(pins),
        fetchOpinions(user.id),
        fetchStories(user.id),
    ]);

    const writings = recentJournals.slice(0, PREVIEW_LIMITS.writings).map(shapeWriting);
    const media = mediaItems.slice(0, PREVIEW_LIMITS.media).map(shapeMediaItem);
    const pinnedWritings = pinnedJournals.slice(0, PREVIEW_LIMITS.pinned).map(shapeWriting);

    return {
        user: {
            id: user.id,
            username: user.username,
            name: user.name,
            image_url: user.image_url || null,
            badge: user.badge || null,
        },
        writings,
        media,
        opinions: opinions.map(shapeOpinion),
        stories: stories.map(shapeStory),
        pinnedWritings,
    };
};
