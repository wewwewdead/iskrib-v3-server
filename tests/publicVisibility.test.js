import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('../services/supabase.js', () => ({
    default: mockSupabase,
}));

vi.mock('../utils/GenerateEmbeddings.js', () => ({
    default: vi.fn(),
}));

vi.mock('../utils/mediaVariants.js', () => ({
    createMediaResponsePayload: vi.fn(() => null),
    isPrimaryListableFileName: vi.fn(() => true),
}));

const createQueryChain = (result = { data: null, error: null, count: null }) => {
    const chain = {};
    const methods = ['select', 'eq', 'or', 'order', 'limit', 'lt', 'in', 'ilike', 'not', 'range'];

    methods.forEach((method) => {
        chain[method] = vi.fn().mockReturnValue(chain);
    });

    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.single = vi.fn().mockResolvedValue(result);
    chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
    chain.catch = (onRejected) => Promise.resolve(result).catch(onRejected);
    chain.finally = (onFinally) => Promise.resolve(result).finally(onFinally);

    return chain;
};

const queueTableMocks = (definitions) => {
    const queues = new Map(
        Object.entries(definitions).map(([table, value]) => [
            table,
            Array.isArray(value) ? [...value] : [value],
        ])
    );

    mockFrom.mockImplementation((table) => {
        const queue = queues.get(table);
        if (!queue || queue.length === 0) {
            throw new Error(`Unexpected table access: ${table}`);
        }
        return queue.shift();
    });
};

describe('public journal visibility', () => {
    let getJournalByIdService;
    let getPromptResponsesService;
    let getUserDataService;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();

        ({ getJournalByIdService } = await import('../services/getService.js'));
        ({ getPromptResponsesService } = await import('../services/promptService.js'));
        ({ getUserDataService } = await import('../services/getUserDataService.js'));
    });

    it('allows the owner to read their own draft by id', async () => {
        const journalChain = createQueryChain({
            data: {
                id: 'journal-1',
                user_id: 'user-1',
                title: 'Draft title',
                content: '{"root":{}}',
                post_type: 'text',
                created_at: '2026-03-31T00:00:00.000Z',
                privacy: 'public',
                status: 'draft',
                views: 0,
                is_repost: false,
                repost_source_journal_id: null,
                repost_caption: null,
                prompt_id: null,
                users: {
                    id: 'user-1',
                    name: 'Owner',
                    image_url: null,
                    badge: null,
                },
            },
            error: null,
        });
        const likesChain = createQueryChain({ count: 0, error: null });
        const bookmarksChain = createQueryChain({ count: 0, error: null });
        const reactionsChain = createQueryChain({ data: null, error: null });

        queueTableMocks({
            journals: journalChain,
            likes: likesChain,
            bookmarks: bookmarksChain,
            reactions: reactionsChain,
        });

        const result = await getJournalByIdService('journal-1', 'user-1');

        expect(result).toMatchObject({
            id: 'journal-1',
            title: 'Draft title',
            privacy: 'public',
        });
        expect(mockFrom).toHaveBeenCalledWith('journals');
        expect(mockFrom).toHaveBeenCalledWith('likes');
        expect(mockFrom).toHaveBeenCalledWith('bookmarks');
        expect(mockFrom).toHaveBeenCalledWith('reactions');
    });

    it('hides a public draft from a different logged-in user', async () => {
        const journalChain = createQueryChain({
            data: {
                id: 'journal-1',
                user_id: 'owner-1',
                title: 'Draft title',
                content: '{"root":{}}',
                post_type: 'text',
                created_at: '2026-03-31T00:00:00.000Z',
                privacy: 'public',
                status: 'draft',
                views: 0,
                is_repost: false,
                repost_source_journal_id: null,
                repost_caption: null,
                prompt_id: null,
                users: {
                    id: 'owner-1',
                    name: 'Owner',
                    image_url: null,
                    badge: null,
                },
            },
            error: null,
        });

        queueTableMocks({
            journals: journalChain,
        });

        const result = await getJournalByIdService('journal-1', 'viewer-1');

        expect(result).toBeNull();
        expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('hides a public draft from anonymous viewers', async () => {
        const journalChain = createQueryChain({
            data: {
                id: 'journal-1',
                user_id: 'owner-1',
                title: 'Draft title',
                content: '{"root":{}}',
                post_type: 'text',
                created_at: '2026-03-31T00:00:00.000Z',
                privacy: 'public',
                status: 'draft',
                views: 0,
                is_repost: false,
                repost_source_journal_id: null,
                repost_caption: null,
                prompt_id: null,
                users: {
                    id: 'owner-1',
                    name: 'Owner',
                    image_url: null,
                    badge: null,
                },
            },
            error: null,
        });

        queueTableMocks({
            journals: journalChain,
        });

        const result = await getJournalByIdService('journal-1', null);

        expect(result).toBeNull();
        expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('still returns a public published journal', async () => {
        const journalChain = createQueryChain({
            data: {
                id: 'journal-2',
                user_id: 'owner-1',
                title: 'Published post',
                content: '{"root":{}}',
                post_type: 'text',
                created_at: '2026-03-31T00:00:00.000Z',
                privacy: 'public',
                status: 'published',
                views: 10,
                is_repost: false,
                repost_source_journal_id: null,
                repost_caption: null,
                prompt_id: null,
                users: {
                    id: 'owner-1',
                    name: 'Owner',
                    image_url: null,
                    badge: null,
                },
            },
            error: null,
        });

        queueTableMocks({
            journals: journalChain,
        });

        const result = await getJournalByIdService('journal-2', null);

        expect(result).toMatchObject({
            id: 'journal-2',
            title: 'Published post',
            views: 10,
        });
    });

    it('filters prompt responses to published journals only', async () => {
        const listChain = createQueryChain({
            data: [{
                id: 'journal-1',
                title: 'Response',
                created_at: '2026-03-31T00:00:00.000Z',
                user_id: 'user-1',
                users: { id: 'user-1', name: 'Writer', image_url: null, badge: null },
            }],
            error: null,
            count: 1,
        });
        const countChain = createQueryChain({ count: 1, error: null });

        queueTableMocks({
            journals: [listChain, countChain],
        });

        const result = await getPromptResponsesService(42, 5);

        expect(listChain.eq).toHaveBeenCalledWith('status', 'published');
        expect(countChain.eq).toHaveBeenCalledWith('status', 'published');
        expect(result).toMatchObject({
            count: 1,
            uniqueCount: 1,
            hasMore: false,
        });
    });

    it('counts only published public journals on the profile header', async () => {
        const usersChain = createQueryChain({
            data: [{
                id: 'user-1',
                name: 'Writer',
                bio: '',
                image_url: null,
                badge: null,
                username: 'writer',
                background: null,
                profile_font_color: null,
                dominant_colors: null,
                secondary_colors: null,
                writing_interests: [],
                writing_goal: null,
                onboarding_completed: true,
                onboarding_completed_at: null,
                created_at: '2026-03-31T00:00:00.000Z',
            }],
            error: null,
        });
        const followerChain = createQueryChain({ count: 2, error: null });
        const followingChain = createQueryChain({ count: 3, error: null });
        const postsChain = createQueryChain({ count: 4, error: null });

        queueTableMocks({
            users: usersChain,
            follows: [followerChain, followingChain],
            journals: postsChain,
        });

        const result = await getUserDataService('user-1');

        expect(postsChain.eq).toHaveBeenCalledWith('status', 'published');
        expect(result).toMatchObject({
            followerCount: 2,
            followingCount: 3,
            postsCount: 4,
        });
    });
});
