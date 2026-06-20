import supabase from "./supabase.js";

/**
 * Profile Discovery (Phase 3)
 *
 * Surfaces interesting profile "rooms" using only existing data:
 *   - users.profile_theme / users.profile_theme_updated_at
 *   - profile_visits
 *   - profile_theme_remixes
 *   - profile_guestbook_entries
 *   - users.created_at
 *
 * Design goals:
 *   - Only ever expose safe public profile fields.
 *   - Keep queries simple and bounded (no heavy joins, no recommendation engine).
 *   - Aggregate counts in JS from a bounded recent window — approximate but cheap.
 *   - Hide empty sections gracefully (each section just comes back as []).
 */

// Only safe, public profile columns. Never select private fields here.
// `badge` is a public distinction (already shown in the feed, Explore, etc.).
const SAFE_PROFILE_SELECT = `
    id, username, name, image_url, bio, badge,
    background, profile_font_color,
    profile_theme, profile_theme_updated_at, created_at
`;

const SECTION_LIMIT = 10;
// Upper bound on rows scanned when aggregating counts. Recent-first, so the
// "this week"/"most" rankings reflect current activity without scanning forever.
const AGGREGATE_SCAN_LIMIT = 5000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const weekAgoIso = () => new Date(Date.now() - WEEK_MS).toISOString();

// Map a raw user row + aggregated counts into the public card payload.
const toCard = (user, counts) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.image_url || null,
    bio: user.bio || null,
    badge: user.badge || null,
    background: user.background || null,
    profile_font_color: user.profile_font_color || null,
    profile_theme: user.profile_theme || null,
    profile_theme_updated_at: user.profile_theme_updated_at || null,
    guestbook_count: counts?.guestbook || 0,
    visit_count: counts?.visit || 0,
    remix_count: counts?.remix || 0,
});

// Aggregate a set of rows into a Map<userId, count>, bounded + recent-first.
const aggregateCounts = async (table, idColumn, { sinceIso, deletedAtNull } = {}) => {
    try {
        let query = supabase
            .from(table)
            .select(idColumn)
            .order("created_at", { ascending: false })
            .limit(AGGREGATE_SCAN_LIMIT);

        if (sinceIso) query = query.gte("created_at", sinceIso);
        if (deletedAtNull) query = query.is("deleted_at", null);

        const { data, error } = await query;
        if (error || !Array.isArray(data)) return new Map();

        const counts = new Map();
        for (const row of data) {
            const id = row?.[idColumn];
            if (!id) continue;
            counts.set(id, (counts.get(id) || 0) + 1);
        }
        return counts;
    } catch {
        return new Map();
    }
};

// Top N user ids from a count Map, ordered by count desc.
const topIds = (countsMap, limit = SECTION_LIMIT) =>
    Array.from(countsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => id);

// Fetch user rows by id (single bounded query), returned as a Map<id, row>.
const fetchUsersByIds = async (ids) => {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return new Map();
    try {
        const { data, error } = await supabase
            .from("users")
            .select(SAFE_PROFILE_SELECT)
            .in("id", unique);
        if (error || !Array.isArray(data)) return new Map();
        return new Map(data.map((u) => [u.id, u]));
    } catch {
        return new Map();
    }
};

// Recently Customized — users with a theme, newest customization first.
const fetchRecentlyCustomized = async () => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select(SAFE_PROFILE_SELECT)
            .not("profile_theme", "is", null)
            .not("username", "is", null)
            .order("profile_theme_updated_at", { ascending: false, nullsFirst: false })
            .limit(SECTION_LIMIT);
        if (error || !Array.isArray(data)) return [];
        return data;
    } catch {
        return [];
    }
};

// New Writers — newest accounts with a public username, mildly preferring
// profiles that already have an avatar/bio/theme so the section looks alive.
const fetchNewWriters = async () => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select(SAFE_PROFILE_SELECT)
            .not("username", "is", null)
            .order("created_at", { ascending: false, nullsFirst: false })
            .limit(SECTION_LIMIT * 2);
        if (error || !Array.isArray(data)) return [];

        const richness = (u) =>
            (u.image_url ? 1 : 0) + (u.bio ? 1 : 0) + (u.profile_theme ? 1 : 0);

        // Stable-ish: keep recency but float richer profiles up a little.
        return [...data]
            .map((u, index) => ({ u, index }))
            .sort((a, b) => richness(b.u) - richness(a.u) || a.index - b.index)
            .slice(0, SECTION_LIMIT)
            .map(({ u }) => u);
    } catch {
        return [];
    }
};

export const getProfileDiscoverService = async () => {
    const sinceIso = weekAgoIso();

    // 1) Aggregate counts concurrently (each on its own table).
    const [visitCounts, remixCounts, guestbookCounts] = await Promise.all([
        aggregateCounts("profile_visits", "profile_user_id", { sinceIso }),
        aggregateCounts("profile_theme_remixes", "source_user_id"),
        aggregateCounts("profile_guestbook_entries", "profile_user_id", { deletedAtNull: true }),
    ]);

    // Counts attached to every card by id, regardless of which section it's in.
    const countsFor = (id) => ({
        visit: visitCounts.get(id) || 0,
        remix: remixCounts.get(id) || 0,
        guestbook: guestbookCounts.get(id) || 0,
    });

    // 2) Theme-based sections fetch full rows directly (sequential keeps the
    // users table query order deterministic).
    const recentlyCustomizedRows = await fetchRecentlyCustomized();
    const newWritersRows = await fetchNewWriters();

    // 3) Aggregate sections only have ids — fetch their user rows in one query.
    const visitIds = topIds(visitCounts);
    const remixIds = topIds(remixCounts);
    const guestbookIds = topIds(guestbookCounts);
    const userMap = await fetchUsersByIds([...visitIds, ...remixIds, ...guestbookIds]);

    // Build an ordered, deduped card list for an aggregate section.
    const buildAggregateSection = (orderedIds) => {
        const seen = new Set();
        const cards = [];
        for (const id of orderedIds) {
            if (seen.has(id)) continue;
            const user = userMap.get(id);
            if (!user || !user.username) continue; // need username for /u/:username links
            seen.add(id);
            cards.push(toCard(user, countsFor(id)));
        }
        return cards;
    };

    // Build cards from already-fetched user rows (theme-based sections).
    const buildRowSection = (rows) => {
        const seen = new Set();
        const cards = [];
        for (const user of rows) {
            if (!user?.username || seen.has(user.id)) continue;
            seen.add(user.id);
            cards.push(toCard(user, countsFor(user.id)));
        }
        return cards;
    };

    return {
        recentlyCustomized: buildRowSection(recentlyCustomizedRows),
        mostVisited: buildAggregateSection(visitIds),
        mostRemixed: buildAggregateSection(remixIds),
        activeGuestbooks: buildAggregateSection(guestbookIds),
        newWriters: buildRowSection(newWritersRows),
    };
};
