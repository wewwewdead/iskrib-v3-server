import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock("../services/supabase.js", () => ({
    default: mockSupabase,
}));

// Chainable mock whose awaited/limit result comes from `result`.
const makeChain = (result = { data: null, error: null }) => {
    const chain = {};
    ["select", "eq", "is", "order", "ilike", "update"].forEach((method) => {
        chain[method] = vi.fn().mockReturnValue(chain);
    });
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(result);
    chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
};

// Simulate a `users` table containing the given taken usernames (case-insensitive).
// Every `.select(...).ilike('username', candidate).limit(1)` resolves to a hit or miss.
const usersTableWithTaken = (taken) => {
    const takenLower = new Set(taken.map((u) => u.toLowerCase()));
    mockFrom.mockImplementation((table) => {
        if (table !== "users") throw new Error(`Unexpected table access: ${table}`);
        const chain = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.ilike = vi.fn((_col, value) => {
            const hit = takenLower.has(String(value).toLowerCase());
            chain.limit = vi.fn().mockResolvedValue({ data: hit ? [{ id: "x" }] : [], error: null });
            return chain;
        });
        return chain;
    });
};

describe("generateUniqueUsername", () => {
    let generateUniqueUsername;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ generateUniqueUsername } = await import("../utils/usernameGenerator.js"));
    });

    it("returns the preferred handle when it is free", async () => {
        usersTableWithTaken([]);
        const result = await generateUniqueUsername({ preferred: "john-doe", name: "John Doe" });
        expect(result).toBe("john-doe");
    });

    it("suffixes on collision instead of returning the taken handle", async () => {
        usersTableWithTaken(["john"]);
        const result = await generateUniqueUsername({ preferred: "john", name: "John" });
        expect(result).not.toBe("john");
        expect(result.startsWith("john-")).toBe(true);
    });

    it("derives a valid handle from the name when none is requested", async () => {
        usersTableWithTaken([]);
        const result = await generateUniqueUsername({ name: "Mary Jane!!" });
        expect(result).toBe("mary-jane");
    });

    it("never returns null/empty even with an unusable name and no preferred handle", async () => {
        usersTableWithTaken([]);
        const result = await generateUniqueUsername({ name: "!!" });
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThanOrEqual(3);
        expect(result.startsWith("user-")).toBe(true);
    });

    it("never hands out a reserved handle (falls back to a safe user- handle)", async () => {
        usersTableWithTaken([]);
        const result = await generateUniqueUsername({ preferred: "admin", name: "Admin" });
        expect(result).not.toBe("admin");
        expect(result.startsWith("user-")).toBe(true);
    });
});
