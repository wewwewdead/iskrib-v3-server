import supabase from "../services/supabase.js";

export const extractBearerToken = (authHeader = "") => {
    const trimmed = typeof authHeader === "string" ? authHeader.trim() : "";
    if (!trimmed) return "";

    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
        return bearerMatch[1].trim();
    }

    return "";
};

export const resolveAuthUser = async (token) => {
    if (!token) {
        return { user: null, error: null };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
        return { user: null, error: authError || new Error("missing user id") };
    }

    return { user: authData.user, error: null };
};

export const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) {
        return res.status(401).json({ error: 'not authorized' });
    }

    const { user, error } = await resolveAuthUser(token);
    if (error || !user?.id) {
        console.error('auth middleware error:', error?.message || 'missing user id');
        return res.status(401).json({ error: 'not authorized' });
    }

    req.userId = user.id;
    req.authUser = user;
    return next();
};

export const optionalAuth = async (req, _res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) {
        return next();
    }

    const { user } = await resolveAuthUser(token);
    if (user?.id) {
        req.userId = user.id;
        req.authUser = user;
    }

    return next();
};
