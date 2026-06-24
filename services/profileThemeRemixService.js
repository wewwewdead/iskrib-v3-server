import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";
import { validateProfileTheme } from "../utils/profileThemeValidation.js";
import { getUserByUsernameLite } from "./userLookupService.js";
import { createNotification } from "./notificationService.js";
import { buildUserProfileTarget } from "../utils/notificationTargets.js";

/**
 * "Use this theme" — copy a source user's profile_theme onto the current user.
 *
 * Only the theme config (colors / typography / cards / sections / layout) is
 * copied — never avatar, name, bio, writings, or the background image (those
 * live in other columns and are left untouched). Re-validating the source theme
 * also drops any deprecated stickers, so a remix never carries them over.
 */
export const remixProfileThemeService = async (sourceUsername, remixerId) => {
    if (!remixerId) {
        throw new AppError(401, "not authorized");
    }

    const sourceUser = await getUserByUsernameLite(sourceUsername, "profile_theme");

    if (sourceUser.id === remixerId) {
        throw new AppError(400, "you can't use your own theme");
    }

    if (!sourceUser.profile_theme) {
        throw new AppError(400, "this profile has no theme to use");
    }

    // Re-validate the source theme before persisting it to a new user.
    const sanitizedTheme = validateProfileTheme(sourceUser.profile_theme);

    const { error: updateError } = await supabase
        .from("users")
        .update({
            profile_theme: sanitizedTheme,
            profile_theme_updated_at: new Date().toISOString(),
        })
        .eq("id", remixerId);

    if (updateError) {
        console.error("supabase error applying remixed theme:", updateError.message);
        throw new AppError(500, "failed to apply theme");
    }

    // Record the remix event (non-fatal).
    const { error: remixError } = await supabase
        .from("profile_theme_remixes")
        .insert({ source_user_id: sourceUser.id, remixer_user_id: remixerId });
    if (remixError) {
        console.error("non-fatal: remix record error:", remixError.message);
    }

    // Notify the source user (non-fatal; source is never the remixer here).
    // Target = the remixer's (actor's) profile — B wants to see who used the theme.
    const { error: notifError } = await createNotification({
        senderId: remixerId,
        receiverId: sourceUser.id,
        type: "theme_remix",
        target: buildUserProfileTarget(remixerId),
    });
    if (notifError) {
        console.error("non-fatal: remix notification error:", notifError.message);
    }

    return { profileTheme: sanitizedTheme, sourceUserId: sourceUser.id };
};
