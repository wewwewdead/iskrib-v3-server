import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock("../services/supabase.js", () => ({
    default: mockSupabase,
}));

vi.mock("../utils/mediaVariants.js", () => ({
    createMediaResponsePayload: vi.fn(() => null),
}));

// A chainable query/insert mock. `result` is what awaiting (or single/maybeSingle) resolves to.
const makeChain = (result = { data: null, error: null }) => {
    const chain = {};
    ["select", "eq", "is", "order", "limit", "ilike", "update"].forEach((method) => {
        chain[method] = vi.fn().mockReturnValue(chain);
    });
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
};

const queueTableMocks = (definitions) => {
    const queues = new Map(
        Object.entries(definitions).map(([table, value]) => [table, Array.isArray(value) ? [...value] : [value]])
    );
    mockFrom.mockImplementation((table) => {
        const queue = queues.get(table);
        if (!queue || queue.length === 0) {
            throw new Error(`Unexpected table access: ${table}`);
        }
        return queue.shift();
    });
};

const ownerRow = (id, username = "bob") => ({
    data: { id, username, name: "Bob", image_url: null, badge: null },
    error: null,
});

const insertedEntry = (ownerId, authorId) => ({
    data: {
        id: "entry-1",
        profile_user_id: ownerId,
        author_user_id: authorId,
        message: "love your profile!",
        created_at: "2026-06-20T00:00:00.000Z",
        author: { id: authorId, username: "alice", name: "Alice", image_url: null, badge: null },
    },
    error: null,
});

describe("createGuestbookEntryService notifications", () => {
    let createGuestbookEntryService;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ createGuestbookEntryService } = await import("../services/profileGuestbookService.js"));
    });

    it("creates the entry and notifies the profile owner", async () => {
        const ownerId = "owner-1";
        const authorId = "author-2";

        const usersChain = makeChain(ownerRow(ownerId));
        const entryChain = makeChain(insertedEntry(ownerId, authorId));
        const notifChain = makeChain({ error: null });

        queueTableMocks({
            users: usersChain,
            profile_guestbook_entries: entryChain,
            notifications: notifChain,
        });

        const result = await createGuestbookEntryService("bob", authorId, "love your profile!");

        // entry was created
        expect(entryChain.insert).toHaveBeenCalledWith(
            expect.objectContaining({ profile_user_id: ownerId, author_user_id: authorId, message: "love your profile!" })
        );
        expect(result).toMatchObject({ id: "entry-1", author_user_id: authorId });

        // exactly one notification, with the full target-aware shape
        expect(notifChain.insert).toHaveBeenCalledTimes(1);
        expect(notifChain.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                sender_id: authorId, // notification sender is the guestbook author
                receiver_id: ownerId, // recipient is the profile owner
                type: "guestbook", // exact string the client expects
                read: false,
                target_type: "profile_guestbook",
                target_id: "entry-1", // exact created guestbook entry id
                target_user_id: ownerId, // owner's guestbook
                target_metadata: { actorUserId: authorId },
            })
        );
    });

    it("does NOT notify when the owner signs their own guestbook", async () => {
        const ownerId = "owner-1";

        const usersChain = makeChain(ownerRow(ownerId));
        const entryChain = makeChain(insertedEntry(ownerId, ownerId));
        const notifChain = makeChain({ error: null });

        queueTableMocks({
            users: usersChain,
            profile_guestbook_entries: entryChain,
            notifications: notifChain,
        });

        await createGuestbookEntryService("bob", ownerId, "note to self");

        expect(entryChain.insert).toHaveBeenCalledTimes(1);
        expect(notifChain.insert).not.toHaveBeenCalled();
    });

    it("still returns the created entry even if the notification insert fails", async () => {
        const ownerId = "owner-1";
        const authorId = "author-2";

        const usersChain = makeChain(ownerRow(ownerId));
        const entryChain = makeChain(insertedEntry(ownerId, authorId));
        // Simulate a rejected notification insert (e.g. a constraint violation).
        const notifChain = makeChain({ error: { code: "23514", message: "violates check constraint" } });

        queueTableMocks({
            users: usersChain,
            profile_guestbook_entries: entryChain,
            notifications: notifChain,
        });

        const result = await createGuestbookEntryService("bob", authorId, "love your profile!");

        expect(notifChain.insert).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ id: "entry-1" }); // signing does not 500
    });

    it("falls back to a target-less insert when the target columns are missing", async () => {
        const ownerId = "owner-1";
        const authorId = "author-2";

        const usersChain = makeChain(ownerRow(ownerId));
        const entryChain = makeChain(insertedEntry(ownerId, authorId));
        // Pre-migration: the target columns don't exist yet.
        const notifChain = makeChain({
            error: { code: "PGRST204", message: "Could not find the 'target_type' column in the schema cache" },
        });

        queueTableMocks({
            users: usersChain,
            profile_guestbook_entries: entryChain,
            // createNotification calls from('notifications') once per insert attempt.
            notifications: [notifChain, notifChain],
        });

        const result = await createGuestbookEntryService("bob", authorId, "love your profile!");

        // First insert carries target fields; the retry strips them.
        expect(notifChain.insert).toHaveBeenCalledTimes(2);
        expect(notifChain.insert.mock.calls[0][0]).toHaveProperty("target_type", "profile_guestbook");
        expect(notifChain.insert.mock.calls[1][0]).not.toHaveProperty("target_type");
        expect(notifChain.insert.mock.calls[1][0]).toMatchObject({ type: "guestbook", sender_id: authorId });
        expect(result).toMatchObject({ id: "entry-1" });
    });
});
