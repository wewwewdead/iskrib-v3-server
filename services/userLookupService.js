import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";

/**
 * Lightweight username -> user resolution used by guestbook / visit / remix
 * endpoints. Returns the minimal public fields needed by those flows.
 * Throws AppError(400/404) when the username is missing or unknown.
 */
export const getUserByUsernameLite = async (username, extraColumns = "") => {
    if (!username || typeof username !== "string") {
        throw new AppError(400, "username is required");
    }

    const normalized = username.trim().toLowerCase();
    const select = `id, username, name, image_url, badge${extraColumns ? `, ${extraColumns}` : ""}`;

    const { data, error } = await supabase
        .from("users")
        .select(select)
        .ilike("username", normalized)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("supabase error resolving username:", error.message);
        throw new AppError(500, "error resolving user");
    }

    if (!data) {
        throw new AppError(404, "user not found");
    }

    return data;
};

/**
 * Resolve a user id to its public-safe identity fields. Used to canonicalize
 * legacy `/visitProfile?userId=` links to `/u/:username`.
 */
export const getUserByIdLite = async (userId) => {
    if (!userId || typeof userId !== "string") {
        throw new AppError(400, "userId is required");
    }

    const { data, error } = await supabase
        .from("users")
        .select("id, username, name")
        .eq("id", userId)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("supabase error resolving userId:", error.message);
        throw new AppError(500, "error resolving user");
    }

    if (!data) {
        throw new AppError(404, "user not found");
    }

    return data;
};
