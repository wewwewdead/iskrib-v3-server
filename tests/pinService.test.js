import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing services
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('../services/supabase.js', () => ({
    default: mockSupabase,
}));

vi.mock('../utils/AppError.js', () => ({
    AppError: class AppError extends Error {
        constructor(status, message) {
            super(message);
            this.status = status;
            this.error = message;
        }
    },
}));

// Helper to build chainable query mock
const createQueryChain = (result = { data: null, error: null, count: null }) => {
    const chain = {};
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'maybeSingle', 'order', 'single'];
    methods.forEach(method => {
        chain[method] = vi.fn().mockReturnValue(chain);
    });
    // Terminal methods return the result
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.select = vi.fn((_cols, opts) => {
        if (opts?.count === 'exact' && opts?.head === true) {
            return { ...chain, then: (fn) => fn({ count: result.count, error: result.error }) };
        }
        return chain;
    });
    // Default resolution for non-maybeSingle chains
    chain.then = vi.fn((fn) => fn(result));
    // Make the chain thenable
    Object.defineProperty(chain, Symbol.for('then'), { value: chain.then });

    return chain;
};

describe('togglePinService', () => {
    let togglePinService;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../services/interactService.js');
        togglePinService = mod.togglePinService;
    });

    it('should throw 400 when journalId is missing', async () => {
        await expect(togglePinService(null, 'user-1')).rejects.toThrow('journalId is required');
    });

    it('should throw 400 when userId is missing', async () => {
        await expect(togglePinService('journal-1', null)).rejects.toThrow('userId is required');
    });

    it('should throw 404 when journal is not found', async () => {
        const chain = createQueryChain({ data: null, error: null });
        mockFrom.mockReturnValue(chain);

        await expect(togglePinService('journal-1', 'user-1')).rejects.toThrow('journal not found');
    });

    it('should throw 404 when journal belongs to different user', async () => {
        const chain = createQueryChain({
            data: { id: 'journal-1', user_id: 'other-user', status: 'published', privacy: 'public' },
            error: null,
        });
        mockFrom.mockReturnValue(chain);

        await expect(togglePinService('journal-1', 'user-1')).rejects.toThrow('journal not found');
    });

    it('should throw 400 when journal is a draft', async () => {
        const journalChain = createQueryChain({
            data: { id: 'journal-1', user_id: 'user-1', status: 'draft', privacy: 'public' },
            error: null,
        });
        mockFrom.mockReturnValue(journalChain);

        await expect(togglePinService('journal-1', 'user-1')).rejects.toThrow('only published posts can be pinned');
    });

    it('should throw 400 when journal is private', async () => {
        const journalChain = createQueryChain({
            data: { id: 'journal-1', user_id: 'user-1', status: 'published', privacy: 'private' },
            error: null,
        });
        mockFrom.mockReturnValue(journalChain);

        await expect(togglePinService('journal-1', 'user-1')).rejects.toThrow('only public posts can be pinned');
    });
});

describe('reorderPinService', () => {
    let reorderPinService;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../services/interactService.js');
        reorderPinService = mod.reorderPinService;
    });

    it('should throw 400 when direction is invalid', async () => {
        await expect(reorderPinService('user-1', 'journal-1', 'left')).rejects.toThrow('direction must be "up" or "down"');
    });

    it('should throw 400 when userId is missing', async () => {
        await expect(reorderPinService(null, 'journal-1', 'up')).rejects.toThrow('userId is required');
    });

    it('should throw 400 when journalId is missing', async () => {
        await expect(reorderPinService('user-1', null, 'up')).rejects.toThrow('journalId is required');
    });
});
