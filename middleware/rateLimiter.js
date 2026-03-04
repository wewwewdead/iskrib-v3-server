import rateLimit from 'express-rate-limit';

// General API rate limit — generous but prevents abuse
export const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests, please try again later' },
});

// Stricter limit for write operations (comments, likes, follows, opinions, saves)
export const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many write requests, please slow down' },
});

// Auth endpoints (login, signup, password reset)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many auth attempts, please try again later' },
});

// Upload endpoints (images, journals)
export const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many uploads, please try again later' },
});

// Search endpoints
export const searchLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many search requests, please slow down' },
});
