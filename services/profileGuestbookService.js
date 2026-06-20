import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";
import { validateGuestbookMessage } from "../utils/guestbookValidation.js";
import { getUserByUsernameLite } from "./userLookupService.js";
import { createMediaResponsePayload } from "../utils/mediaVariants.js";
import { createNotification } from "./notificationService.js";
import { buildGuestbookTarget } from "../utils/notificationTargets.js";

const GUESTBOOK_DEFAULT_LIMIT = 20;
const GUESTBOOK_MAX_LIMIT = 50;

const GUESTBOOK_SELECT = `
    id,
    profile_user_id,
    author_user_id,
    message,
    created_at,
    author:users!author_user_id(id, username, name, image_url, badge)
`;

const decorateEntry = (entry) => {
    if (!entry) return entry;
    const avatarMedia = createMediaResponsePayload("avatars", entry.author?.image_url, "card");
    return {
        ...entry,
        author: entry.author
            ? {
                  ...entry.author,
                  image_url: avatarMedia?.preferred_url || entry.author.image_url || null,
                  avatar_media: avatarMedia,
              }
            : entry.author,
    };
};

const clampLimit = (raw) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return GUESTBOOK_DEFAULT_LIMIT;
    return Math.min(GUESTBOOK_MAX_LIMIT, Math.max(1, parsed));
};

/**
 * Public read: recent non-deleted guestbook entries for a profile.
 */
export const getProfileGuestbookService = async (username, { limit, before } = {}) => {
    const profileUser = await getUserByUsernameLite(username);
    const fetchLimit = clampLimit(limit);

    let query = supabase
        .from("profile_guestbook_entries")
        .select(GUESTBOOK_SELECT)
        .eq("profile_user_id", profileUser.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(fetchLimit + 1);

    if (before) {
        query = query.lt("created_at", before);
    }

    const { data, error } = await query;
    if (error) {
        console.error("supabase error fetching guestbook:", error.message);
        throw new AppError(500, "error fetching guestbook");
    }

    const hasMore = (data || []).length > fetchLimit;
    const entries = (hasMore ? data.slice(0, fetchLimit) : data || []).map(decorateEntry);

    return { entries, hasMore, profileUserId: profileUser.id };
};

/**
 * Create a guestbook entry on a profile. Notifies the owner (unless self).
 */
export const createGuestbookEntryService = async (username, authorId, rawMessage) => {
    if (!authorId) {
        throw new AppError(401, "not authorized");
    }

    const message = validateGuestbookMessage(rawMessage);
    const profileUser = await getUserByUsernameLite(username);

    const { data: inserted, error } = await supabase
        .from("profile_guestbook_entries")
        .insert({
            profile_user_id: profileUser.id,
            author_user_id: authorId,
            message,
        })
        .select(GUESTBOOK_SELECT)
        .single();

    if (error) {
        console.error("supabase error creating guestbook entry:", error.message);
        throw new AppError(500, "error creating guestbook entry");
    }

    // Notify the profile owner. Target = the owner's guestbook, with the exact
    // created entry id so the client can deep-link and highlight that note.
    if (profileUser.id !== authorId) {
        const { error: notifError } = await createNotification({
            senderId: authorId,
            receiverId: profileUser.id,
            type: "guestbook",
            target: buildGuestbookTarget({
                profileUserId: profileUser.id,
                entryId: inserted.id,
                actorUserId: authorId,
            }),
        });
        if (notifError) {
            // Non-fatal: the entry was created successfully, but surface enough
            // detail to diagnose a rejected insert (e.g. a missing CHECK type).
            console.error(
                "non-fatal: guestbook notification insert failed:",
                notifError.code || "",
                notifError.message,
                notifError.details || ""
            );
        }
    }

    return decorateEntry(inserted);
};

/**
 * Soft-delete a guestbook entry. Allowed for the profile owner or the author.
 */
export const deleteGuestbookEntryService = async (entryId, userId) => {
    if (!entryId) {
        throw new AppError(400, "entryId is required");
    }
    if (!userId) {
        throw new AppError(401, "not authorized");
    }

    const { data: entry, error: fetchError } = await supabase
        .from("profile_guestbook_entries")
        .select("id, profile_user_id, author_user_id, deleted_at")
        .eq("id", entryId)
        .maybeSingle();

    if (fetchError) {
        console.error("supabase error fetching guestbook entry:", fetchError.message);
        throw new AppError(500, "error fetching guestbook entry");
    }

    if (!entry || entry.deleted_at) {
        throw new AppError(404, "guestbook entry not found");
    }

    const canDelete = userId === entry.profile_user_id || userId === entry.author_user_id;
    if (!canDelete) {
        throw new AppError(403, "not allowed to delete this entry");
    }

    const { error: deleteError } = await supabase
        .from("profile_guestbook_entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", entryId);

    if (deleteError) {
        console.error("supabase error deleting guestbook entry:", deleteError.message);
        throw new AppError(500, "error deleting guestbook entry");
    }

    return { message: "success" };
};
