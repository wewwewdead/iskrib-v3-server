import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock("../services/supabase.js", () => ({
    default: mockSupabase,
}));

// A chainable, awaitable query mock. Every chain method returns the chain;
// awaiting it (or .single/.maybeSingle) resolves to `result`.
const makeChain = (result = { data: [], error: null }) => {
    const chain = {};
    ["select", "eq", "is", "not", "order", "limit", "in", "gte", "lte", "ilike"].forEach((method) => {
        chain[method] = vi.fn().mockReturnValue(chain);
    });
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
};

// FIFO queue of chains per table. The service awaits the `users` table queries
// in a deterministic order: recentlyCustomized, newWriters, fetchUsersByIds.
const queueTableMocks = (definitions) => {
    const queues = new Map(
        Object.entries(definitions).map(([table, value]) => [table, Array.isArray(value) ? [...value] : [value]])
    );
    mockFrom.mockImplementation((table) => {
        const queue = queues.get(table);
        if (!queue || queue.length === 0) {
            // Default empty result keeps unrelated tables from throwing.
            return makeChain({ data: [], error: null });
        }
        return queue.shift();
    });
};

const userRow = (overrides = {}) => ({
    id: "u1",
    username: "alice",
    name: "Alice",
    image_url: "https://img/alice.png",
    bio: "writer of small rooms",
    background: null,
    profile_font_color: "#fff",
    profile_theme: { version: 1, presetId: "noir" },
    profile_theme_updated_at: "2026-06-19T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
});

describe("getProfileDiscoverService", () => {
    let getProfileDiscoverService;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ getProfileDiscoverService } = await import("../services/profileDiscoverService.js"));
    });

    it("returns all five sections as arrays even with no data", async () => {
        queueTableMocks({
            profile_visits: makeChain({ data: [], error: null }),
            profile_theme_remixes: makeChain({ data: [], error: null }),
            profile_guestbook_entries: makeChain({ data: [], error: null }),
            // recentlyCustomized, newWriters, fetchUsersByIds (not called when no ids)
            users: [
                makeChain({ data: [], error: null }),
                makeChain({ data: [], error: null }),
            ],
        });

        const result = await getProfileDiscoverService();

        expect(result).toEqual({
            recentlyCustomized: [],
            mostVisited: [],
            mostRemixed: [],
            activeGuestbooks: [],
            newWriters: [],
        });
    });

    it("builds safe public cards and maps image_url -> avatar", async () => {
        const alice = userRow();
        queueTableMocks({
            profile_visits: makeChain({ data: [], error: null }),
            profile_theme_remixes: makeChain({ data: [], error: null }),
            profile_guestbook_entries: makeChain({ data: [], error: null }),
            users: [
                makeChain({ data: [alice], error: null }), // recentlyCustomized
                makeChain({ data: [], error: null }), // newWriters
            ],
        });

        const result = await getProfileDiscoverService();

        expect(result.recentlyCustomized).toHaveLength(1);
        const card = result.recentlyCustomized[0];
        expect(card).toEqual({
            id: "u1",
            username: "alice",
            name: "Alice",
            avatar: "https://img/alice.png",
            bio: "writer of small rooms",
            badge: null,
            background: null,
            profile_font_color: "#fff",
            profile_theme: { version: 1, presetId: "noir" },
            profile_theme_updated_at: "2026-06-19T00:00:00.000Z",
            guestbook_count: 0,
            visit_count: 0,
            remix_count: 0,
        });
        // No private fields leak through.
        expect(card).not.toHaveProperty("email");
        expect(card).not.toHaveProperty("interests_embedding");
    });

    it("aggregates visit counts and ranks most visited by count desc", async () => {
        const visitRows = [
            { profile_user_id: "u1" },
            { profile_user_id: "u1" },
            { profile_user_id: "u2" },
        ];
        const u1 = userRow({ id: "u1", username: "alice" });
        const u2 = userRow({ id: "u2", username: "bob", name: "Bob" });

        queueTableMocks({
            profile_visits: makeChain({ data: visitRows, error: null }),
            profile_theme_remixes: makeChain({ data: [], error: null }),
            profile_guestbook_entries: makeChain({ data: [], error: null }),
            users: [
                makeChain({ data: [], error: null }), // recentlyCustomized
                makeChain({ data: [], error: null }), // newWriters
                makeChain({ data: [u1, u2], error: null }), // fetchUsersByIds
            ],
        });

        const result = await getProfileDiscoverService();

        expect(result.mostVisited.map((c) => c.id)).toEqual(["u1", "u2"]);
        expect(result.mostVisited[0].visit_count).toBe(2);
        expect(result.mostVisited[1].visit_count).toBe(1);
    });

    it("excludes users without a username from aggregate sections", async () => {
        const remixRows = [{ source_user_id: "u9" }];
        const noName = userRow({ id: "u9", username: null });

        queueTableMocks({
            profile_visits: makeChain({ data: [], error: null }),
            profile_theme_remixes: makeChain({ data: remixRows, error: null }),
            profile_guestbook_entries: makeChain({ data: [], error: null }),
            users: [
                makeChain({ data: [], error: null }),
                makeChain({ data: [], error: null }),
                makeChain({ data: [noName], error: null }),
            ],
        });

        const result = await getProfileDiscoverService();
        expect(result.mostRemixed).toEqual([]);
    });

    it("does not throw when a table query errors (section degrades to empty)", async () => {
        queueTableMocks({
            profile_visits: makeChain({ data: null, error: { message: "boom" } }),
            profile_theme_remixes: makeChain({ data: null, error: { message: "boom" } }),
            profile_guestbook_entries: makeChain({ data: null, error: { message: "boom" } }),
            users: [
                makeChain({ data: null, error: { message: "boom" } }),
                makeChain({ data: null, error: { message: "boom" } }),
            ],
        });

        const result = await getProfileDiscoverService();
        expect(result).toEqual({
            recentlyCustomized: [],
            mostVisited: [],
            mostRemixed: [],
            activeGuestbooks: [],
            newWriters: [],
        });
    });
});

describe("getProfileActivitySummaryService", () => {
    let getProfileActivitySummaryService;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ getProfileActivitySummaryService } = await import("../services/profileActivitySummaryService.js"));
    });

    it("returns rolling 7-day counts for the owner", async () => {
        queueTableMocks({
            profile_visits: makeChain({ count: 12, error: null }),
            profile_guestbook_entries: makeChain({ count: 3, error: null }),
            profile_theme_remixes: makeChain({ count: 2, error: null }),
        });

        const result = await getProfileActivitySummaryService("owner-1");
        expect(result).toEqual({
            visitsThisWeek: 12,
            guestbookEntriesThisWeek: 3,
            remixesThisWeek: 2,
        });
    });

    it("falls back to 0 on count errors", async () => {
        queueTableMocks({
            profile_visits: makeChain({ count: null, error: { message: "no table" } }),
            profile_guestbook_entries: makeChain({ count: null, error: { message: "no table" } }),
            profile_theme_remixes: makeChain({ count: null, error: { message: "no table" } }),
        });

        const result = await getProfileActivitySummaryService("owner-1");
        expect(result).toEqual({
            visitsThisWeek: 0,
            guestbookEntriesThisWeek: 0,
            remixesThisWeek: 0,
        });
    });
});
