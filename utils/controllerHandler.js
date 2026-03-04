/**
 * Wraps an async route/controller handler with error handling.
 * The wrapped function receives (req, res) and should return or throw.
 * On error, reads error.status and error.error || error.message.
 */
export const asyncHandler = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next);
    } catch (error) {
        const status = error?.status || 500;
        const message = error?.error || error?.message || 'internal server error';
        console.error(`[${req.method} ${req.originalUrl}]`, error);
        return res.status(status).json({ error: message });
    }
};
