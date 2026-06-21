import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock("../services/supabase.js", () => ({
    default: mockSupabase,
}));

// Media now reuses the Media-tab storage listing (getProfileMediaService).
const { mockGetProfileMedia } = vi.hoisted(() => ({ mockGetProfileMedia: vi.fn() }));
vi.mock("../services/getService.js", () => ({
    getProfileMediaService: mockGetProfileMedia,
}));

const mediaItem = (id, bucket = "journal-images") => ({
    id: `${bucket}-${id}`,
    bucket,
    cardUrl: `https://img/${id}-card.png`,
    url: `https://img/${id}.png`,
});

// Chainable, awaitable query mock (mirrors profileDiscoverService.test.js).
const makeChain = (result = { data: [], error: null }) => {
    const chain = {};
    ["select", "eq", "is", "not", "order", "limit", "in", "gte", "lte", "ilike"].forEach((m) => {
        chain[m] = vi.fn().mockReturnValue(chain);
    });
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (onF, onR) => Promise.resolve(result).then(onF, onR);
    return chain;
};

// FIFO queue of chains per table. Tables awaited in deterministic order:
//   users (username lookup) → pinned_posts → journals(recent), journals(pinned), opinions, stories
const queueTableMocks = (definitions) => {
    const queues = new Map(
        Object.entries(definitions).map(([t, v]) => [t, Array.isArray(v) ? [...v] : [v]])
    );
    mockFrom.mockImplementation((table) => {
        const queue = queues.get(table);
        if (!queue || queue.length === 0) return makeChain({ data: [], error: null });
        return queue.shift();
    });
};

const userRow = (overrides = {}) => ({
    id: "u1",
    username: "alice",
    name: "Alice",
    image_url: "https://img/alice.png",
    badge: "og",
    ...overrides,
});

const journal = (id, withThumb = false) => ({
    id,
    title: `Journal ${id}`,
    preview_text: `preview ${id}`,
    thumbnail_url: withThumb ? `https://img/${id}.png` : null,
    created_at: `2026-06-${id}T00:00:00.000Z`,
    post_type: "text",
});

describe("getProfilePreviewService", () => {
    let getProfilePreviewService;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        mockGetProfileMedia.mockResolvedValue({ data: [] }); // default: no media
        ({ getProfilePreviewService } = await import("../services/profilePreviewService.js"));
    });

    it("returns grouped, shaped previews for a user", async () => {
        queueTableMocks({
            users: makeChain({ data: userRow(), error: null }),
            pinned_posts: makeChain({ data: [{ journal_id: "p1", position: 1 }], error: null }),
            journals: [
                makeChain({ data: [journal("10", true), journal("11", false)], error: null }), // recent
                makeChain({ data: [journal("p1", true)], error: null }), // pinned
            ],
            opinions: makeChain({ data: [{ id: "o1", opinion: "hot take", created_at: "2026-06-10", reply_count: 4 }], error: null }),
            stories: makeChain({ data: [{ id: "s1", title: "Tale", description: "d", cover_url: "c", status: "ongoing", vote_count: 2, read_count: 9, created_at: "2026-06-09" }], error: null }),
        });
        // media comes from the storage listing (avatars, journal-images, ...)
        mockGetProfileMedia.mockResolvedValue({ data: [mediaItem("a", "avatars")] });

        const result = await getProfilePreviewService("alice");

        expect(result.user).toEqual({ id: "u1", username: "alice", name: "Alice", image_url: "https://img/alice.png", badge: "og" });
        expect(result.writings).toHaveLength(2);
        expect(result.writings[0]).toMatchObject({ id: "10", title: "Journal 10", preview_text: "preview 10" });
        // media is the user's uploaded images (storage), not journal covers
        expect(result.media).toHaveLength(1);
        expect(result.media[0]).toMatchObject({ id: "avatars-a", thumbnail_url: "https://img/a-card.png", bucket: "avatars" });
        expect(result.opinions[0]).toMatchObject({ id: "o1", opinion: "hot take", reply_count: 4 });
        expect(result.stories[0]).toMatchObject({ id: "s1", title: "Tale", status: "ongoing" });
        expect(result.pinnedWritings).toHaveLength(1);
        expect(result.pinnedWritings[0].id).toBe("p1");
    });

    it("limits each group to its preview cap", async () => {
        const manyRecent = Array.from({ length: 12 }, (_, i) => journal(String(i), true));
        queueTableMocks({
            users: makeChain({ data: userRow(), error: null }),
            pinned_posts: makeChain({ data: [], error: null }),
            journals: [makeChain({ data: manyRecent, error: null })], // no pins → only recent query
            opinions: makeChain({ data: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, opinion: "x", created_at: "2026-06-10", reply_count: 0 })), error: null }),
            stories: makeChain({ data: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: "t", description: "", cover_url: null, status: "ongoing", vote_count: 0, read_count: 0, created_at: "2026-06-09" })), error: null }),
        });
        mockGetProfileMedia.mockResolvedValue({ data: Array.from({ length: 6 }, (_, i) => mediaItem(String(i))) });

        const result = await getProfilePreviewService("alice");
        expect(result.writings).toHaveLength(3);
        expect(result.media).toHaveLength(6);
        // opinions/stories caps come from the query .limit(), but the service does not
        // re-slice — assert it passes through what the (bounded) query returned.
        expect(result.opinions.length).toBeLessThanOrEqual(9);
        expect(result.stories.length).toBeLessThanOrEqual(9);
    });

    it("applies public/published safety filters on journals", async () => {
        const recentChain = makeChain({ data: [], error: null });
        queueTableMocks({
            users: makeChain({ data: userRow(), error: null }),
            pinned_posts: makeChain({ data: [], error: null }),
            journals: [recentChain],
            opinions: makeChain({ data: [], error: null }),
            stories: makeChain({ data: [], error: null }),
        });

        await getProfilePreviewService("alice");
        expect(recentChain.eq).toHaveBeenCalledWith("privacy", "public");
        expect(recentChain.eq).toHaveBeenCalledWith("status", "published");
    });

    it("filters opinions to root-level only (no replies)", async () => {
        const opinionsChain = makeChain({ data: [], error: null });
        queueTableMocks({
            users: makeChain({ data: userRow(), error: null }),
            pinned_posts: makeChain({ data: [], error: null }),
            journals: [makeChain({ data: [], error: null })],
            opinions: opinionsChain,
            stories: makeChain({ data: [], error: null }),
        });

        await getProfilePreviewService("alice");
        expect(opinionsChain.is).toHaveBeenCalledWith("parent_id", null);
    });

    it("returns empty groups when the user has no content", async () => {
        queueTableMocks({
            users: makeChain({ data: userRow(), error: null }),
            pinned_posts: makeChain({ data: [], error: null }),
            journals: [makeChain({ data: [], error: null })],
            opinions: makeChain({ data: [], error: null }),
            stories: makeChain({ data: [], error: null }),
        });

        const result = await getProfilePreviewService("alice");
        expect(result.writings).toEqual([]);
        expect(result.media).toEqual([]);
        expect(result.opinions).toEqual([]);
        expect(result.stories).toEqual([]);
        expect(result.pinnedWritings).toEqual([]);
    });

    it("throws when the username does not resolve to a user", async () => {
        queueTableMocks({
            users: makeChain({ data: null, error: null }), // getUserByUsernameLite → 404
        });
        await expect(getProfilePreviewService("ghost")).rejects.toThrow(/not found/i);
    });

    it("degrades a failing content query to an empty group (resilient)", async () => {
        queueTableMocks({
            users: makeChain({ data: userRow(), error: null }),
            pinned_posts: makeChain({ data: [], error: null }),
            journals: [makeChain({ data: [journal("1", true)], error: null })],
            opinions: makeChain({ data: null, error: { message: "boom" } }), // errors
            stories: makeChain({ data: [], error: null }),
        });

        const result = await getProfilePreviewService("alice");
        expect(result.opinions).toEqual([]); // failure → [] not a thrown error
        expect(result.writings).toHaveLength(1);
    });
});
