import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";
import { validateProfileTheme } from "../utils/profileThemeValidation.js";

/**
 * Validate, sanitize and persist a user's profile theme.
 * Returns the normalized theme that was stored.
 */
export const updateProfileThemeService = async (userId, rawTheme) => {
    if (!userId) {
        throw new AppError(400, "userId is undefined");
    }

    // Throws AppError(400) on invalid input; otherwise returns a clean theme.
    const normalizedTheme = validateProfileTheme(rawTheme);

    const { error } = await supabase
        .from("users")
        .update({
            profile_theme: normalizedTheme,
            profile_theme_updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

    if (error) {
        console.error("supabase error updating profile theme:", error.message);
        throw new AppError(500, "failed to update profile theme");
    }

    return normalizedTheme;
};
