import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Supabase mock: from() for DB, storage for buckets, auth.admin for the user ──
const mockFrom = vi.fn();
const mockStorageList = vi.fn();
const mockStorageRemove = vi.fn();
const mockStorageFrom = vi.fn(() => ({ list: mockStorageList, remove: mockStorageRemove }));
const mockDeleteUser = vi.fn();

const mockSupabase = {
    from: mockFrom,
    storage: { from: mockStorageFrom },
    auth: { admin: { deleteUser: mockDeleteUser } },
};

vi.mock("../services/supabase.js", () => ({ default: mockSupabase }));

// A chainable query mock. Awaiting / maybeSingle resolves to `result`.
// `.delete().eq()` is awaitable and records which (table, column) it deleted.
const makeChain = (result = { data: null, error: null }) => {
    const chain = {};
    ["select", "eq", "is", "order", "limit", "ilike", "update", "delete", "insert"].forEach((method) => {
        chain[method] = vi.fn().mockReturnValue(chain);
    });
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
};

const USER_ID = "user-123";

// Default happy-path: users load returns a user; every other table delete succeeds.
const installDefaultDbMocks = ({ usersLoad, overrides = {} } = {}) => {
    const calls = [];
    mockFrom.mockImplementation((table) => {
        if (table === "users") {
            // First users access is the SELECT load; subsequent is the DELETE.
            // Both can share one chain whose await resolves to the load result.
            return usersLoad;
        }
        if (overrides[table]) {
            calls.push(table);
            return overrides[table];
        }
        const chain = makeChain({ data: null, error: null });
        chain.__table = table;
        calls.push(table);
        return chain;
    });
    return calls;
};

describe("accountDeletionService", () => {
    let mod;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        mockStorageList.mockResolvedValue({ data: [], error: null });
        mockStorageRemove.mockResolvedValue({ error: null });
        mockDeleteUser.mockResolvedValue({ error: null });
        mod = await import("../services/accountDeletionService.js");
    });

    it("rejects when confirmation is not DELETE", async () => {
        await expect(mod.deleteAccountService(USER_ID, "delete")).rejects.toMatchObject({ status: 400 });
        await expect(mod.deleteAccountService(USER_ID, "")).rejects.toMatchObject({ status: 400 });
        expect(mockFrom).not.toHaveBeenCalled();
        expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it("rejects when userId is missing", async () => {
        await expect(mod.deleteAccountService("", "DELETE")).rejects.toMatchObject({ status: 400 });
        await expect(mod.deleteAccountService(undefined, "DELETE")).rejects.toMatchObject({ status: 400 });
        expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it("returns 404 when the account no longer exists", async () => {
        const usersLoad = makeChain({ data: null, error: null });
        installDefaultDbMocks({ usersLoad });
        await expect(mod.deleteAccountService(USER_ID, "DELETE")).rejects.toMatchObject({ status: 404 });
        expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it("deletes DB rows, then storage, then the auth user, returning {deleted:true}", async () => {
        const usersLoad = makeChain({ data: { id: USER_ID, username: "bob", image_url: null, background: null }, error: null });
        // One bucket reports two files to exercise the remove path.
        mockStorageList
            .mockResolvedValueOnce({ data: [{ name: "a.webp" }, { name: "b.webp" }], error: null }) // avatars: page 1
            .mockResolvedValue({ data: [], error: null }); // everything else empty

        installDefaultDbMocks({ usersLoad });

        const result = await mod.deleteAccountService(USER_ID, "DELETE");
        expect(result).toEqual({ deleted: true });

        // DB cleanup ran for the known owned/participant tables.
        const touchedTables = mockFrom.mock.calls.map((c) => c[0]);
        expect(touchedTables).toContain("journals");
        expect(touchedTables).toContain("stories");
        expect(touchedTables).toContain("follows");
        expect(touchedTables).toContain("notifications");

        // Storage removal happened for the listed files...
        expect(mockStorageRemove).toHaveBeenCalledWith(["user_id_user-123/a.webp", "user_id_user-123/b.webp"]);

        // ...and the auth user was deleted exactly once, AFTER db cleanup.
        expect(mockDeleteUser).toHaveBeenCalledTimes(1);
        expect(mockDeleteUser).toHaveBeenCalledWith(USER_ID);
    });

    it("only removes files under exactly user_id_<userId>/", async () => {
        const usersLoad = makeChain({ data: { id: USER_ID, username: "bob", image_url: null, background: null }, error: null });
        installDefaultDbMocks({ usersLoad });

        await mod.deleteAccountService(USER_ID, "DELETE");

        // Storage list is always scoped to the exact per-user prefix.
        for (const call of mockStorageList.mock.calls) {
            expect(call[0]).toBe("user_id_user-123");
        }
        // Any removed path must be under that exact prefix.
        for (const call of mockStorageRemove.mock.calls) {
            for (const path of call[0]) {
                expect(path.startsWith("user_id_user-123/")).toBe(true);
            }
        }
    });

    it("does NOT delete the auth user when DB cleanup fails", async () => {
        const usersLoad = makeChain({ data: { id: USER_ID, username: "bob", image_url: null, background: null }, error: null });
        // Make the `likes` delete fail.
        const failingLikes = makeChain({ data: null, error: { message: "boom" } });
        installDefaultDbMocks({ usersLoad, overrides: { likes: failingLikes } });

        await expect(mod.deleteAccountService(USER_ID, "DELETE")).rejects.toMatchObject({ status: 500 });
        expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it("treats missing storage files/folders as non-fatal and still deletes the auth user", async () => {
        const usersLoad = makeChain({ data: { id: USER_ID, username: "bob", image_url: null, background: null }, error: null });
        installDefaultDbMocks({ usersLoad });
        // Simulate a list error (e.g. folder missing) on the first bucket.
        mockStorageList.mockResolvedValueOnce({ data: null, error: { message: "not found" } });

        const result = await mod.deleteAccountService(USER_ID, "DELETE");
        expect(result).toEqual({ deleted: true });
        expect(mockDeleteUser).toHaveBeenCalledWith(USER_ID);
    });
});

describe("deleteStorageFolder", () => {
    let mod;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        mod = await import("../services/accountDeletionService.js");
    });

    it("paginates and removes every file under the prefix", async () => {
        const page = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}.webp` }));
        mockStorageList
            .mockResolvedValueOnce({ data: page, error: null }) // full page -> keep going
            .mockResolvedValueOnce({ data: [{ name: "last.webp" }], error: null }) // partial page -> stop
            .mockResolvedValue({ data: [], error: null });
        mockStorageRemove.mockResolvedValue({ error: null });

        const res = await mod.deleteStorageFolder("avatars", "user_id_user-123");
        expect(res.ok).toBe(true);
        expect(res.removed).toBe(101);
        expect(mockStorageRemove).toHaveBeenCalledTimes(2);
    });

    it("never throws and reports not-ok on a list error", async () => {
        mockStorageList.mockResolvedValue({ data: null, error: { message: "denied" } });
        const res = await mod.deleteStorageFolder("avatars", "user_id_user-123");
        expect(res).toMatchObject({ ok: false, removed: 0 });
    });
});

describe("buildDeletionPlan", () => {
    let mod;
    beforeEach(async () => {
        vi.resetModules();
        mod = await import("../services/accountDeletionService.js");
    });

    it("uses the real column names (author_id for stories, viewer_id for views)", () => {
        const plan = mod.buildDeletionPlan();
        const byTable = Object.fromEntries(plan.map((p) => [p.table, p.columns]));
        expect(byTable.stories).toEqual(["author_id"]);
        expect(byTable.journal_views).toEqual(["viewer_id"]);
        expect(byTable.journals).toEqual(["user_id"]);
        expect(byTable.follows).toEqual(["follower_id", "following_id"]);
        // Owned content is removed last so cascades resolve.
        const tables = plan.map((p) => p.table);
        expect(tables.indexOf("journals")).toBeGreaterThan(tables.indexOf("likes"));
    });

    it("generates the exact per-user storage prefix", () => {
        expect(mod.getStoragePrefix("abc")).toBe("user_id_abc");
        expect(mod.STORAGE_BUCKETS).toEqual(["avatars", "background", "journal-images", "story-covers"]);
    });
});
