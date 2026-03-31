import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockSupabase = {
    auth: {
        getUser: mockGetUser,
    },
};

vi.mock('../services/supabase.js', () => ({
    default: mockSupabase,
}));

describe('auth middleware', () => {
    let extractBearerToken;
    let isExpectedAuthFailure;
    let requireAuth;
    let optionalAuth;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();

        ({
            extractBearerToken,
            isExpectedAuthFailure,
            requireAuth,
            optionalAuth,
        } = await import('../middleware/auth.js'));
    });

    it('extractBearerToken() returns the bearer token value', () => {
        expect(extractBearerToken('Bearer abc123')).toBe('abc123');
        expect(extractBearerToken('bearer xyz789')).toBe('xyz789');
        expect(extractBearerToken('')).toBe('');
    });

    it('classifies Auth session missing as an expected auth failure', () => {
        expect(
            isExpectedAuthFailure({
                name: 'AuthSessionMissingError',
                message: 'Auth session missing!',
                status: 400,
            }),
        ).toBe(true);
    });

    it('requireAuth() returns 401 without logging when the token session is missing', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: null },
            error: {
                name: 'AuthSessionMissingError',
                message: 'Auth session missing!',
                status: 400,
                code: 'session_not_found',
            },
        });

        const req = { headers: { authorization: 'Bearer stale-token' } };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'not authorized' });
        expect(next).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('requireAuth() still logs unexpected auth failures', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: null },
            error: new Error('supabase transport blew up'),
        });

        const req = { headers: { authorization: 'Bearer bad-token' } };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
            'auth middleware error:',
            'supabase transport blew up',
        );
    });

    it('optionalAuth() ignores missing-session tokens and continues anonymously', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: null },
            error: {
                name: 'AuthSessionMissingError',
                message: 'Auth session missing!',
                status: 400,
                code: 'session_not_found',
            },
        });

        const req = { headers: { authorization: 'Bearer stale-token' } };
        const next = vi.fn();

        await optionalAuth(req, {}, next);

        expect(req.userId).toBeUndefined();
        expect(req.authUser).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });
});
