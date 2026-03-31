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

export const isExpectedAuthFailure = (error) => {
    if (!error) {
        return false;
    }

    const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
    const code = typeof error.code === "string" ? error.code.toLowerCase() : "";

    return (
        error.name === "AuthSessionMissingError" ||
        code === "session_not_found" ||
        code === "session_expired" ||
        code === "bad_jwt" ||
        error.status === 401 ||
        error.status === 403 ||
        message.includes("auth session missing") ||
        message.includes("session not found") ||
        message.includes("jwt")
    );
};

export const resolveAuthUser = async (token) => {
    if (!token) {
        return { user: null, error: null, isExpectedFailure: false };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
        const error = authError || new Error("missing user id");
        return {
            user: null,
            error,
            isExpectedFailure: isExpectedAuthFailure(error),
        };
    }

    return { user: authData.user, error: null, isExpectedFailure: false };
};

export const requireAuth = async (req, res, next) => {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) {
        return res.status(401).json({ error: 'not authorized' });
    }

    const { user, error, isExpectedFailure } = await resolveAuthUser(token);
    if (error || !user?.id) {
        if (error && !isExpectedFailure) {
            console.error('auth middleware error:', error.message || 'missing user id');
        }
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
