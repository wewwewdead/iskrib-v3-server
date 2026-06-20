import supabase from "./supabase.js";
import { AppError } from "../utils/AppError.js";

/**
 * Permanent account deletion.
 *
 * Security model:
 *  - The caller MUST pass the authenticated `req.userId`. No user id is ever
 *    read from the request body, so a user can only ever delete themselves.
 *  - Confirmation phrase must match exactly.
 *
 * Order of operations (see deleteAccountService):
 *   1. validate userId + confirmation
 *   2. load the user row (404 if already gone)
 *   3. delete owned/participant DB rows  -> FATAL on error (account stays active)
 *   4. delete the users row              -> FATAL on error
 *   5. delete storage folders            -> BEST EFFORT (logged, never blocks)
 *   6. delete the Supabase Auth user     -> FATAL on error (logged for repair)
 *
 * DB cleanup runs before the destructive auth deletion: if any DB delete fails
 * we throw and the Supabase Auth user is left intact, so the account is still
 * usable and the (idempotent) deletion can be retried.
 */

export const CONFIRMATION_PHRASE = "DELETE";

// Storage buckets that hold per-user uploads, all under `user_id_<userId>/`.
export const STORAGE_BUCKETS = ["avatars", "background", "journal-images", "story-covers"];

// Page size for paginated storage listing.
const STORAGE_LIST_PAGE_SIZE = 100;
// Hard cap on storage list/remove iterations per bucket (safety against loops).
const STORAGE_MAX_ITERATIONS = 1000;

/**
 * The exact storage folder owned by a user. Files only ever live directly under
 * `user_id_<userId>/`, never a broader path.
 */
export const getStoragePrefix = (userId) => `user_id_${userId}`;

/**
 * Ordered plan of DB rows to remove. Each entry deletes by every column where
 * the user can appear. Interaction/relationship rows are removed before owned
 * content so that cascades from the owned content (other users' rows) resolve
 * cleanly. All deletes are idempotent (delete-by-equality), so a partial prior
 * run can be safely retried.
 *
 * Column names verified against the live services / SQL migrations:
 *  - stories uses `author_id` (NOT user_id); chapters cascade via story_id.
 *  - journal_views uses `viewer_id` (NOT user_id).
 */
export const buildDeletionPlan = () => [
    // ── User interaction rows (user is the actor) ──
    { table: "likes", columns: ["user_id"] },
    { table: "bookmarks", columns: ["user_id"] },
    { table: "reactions", columns: ["user_id"] },
    { table: "journal_views", columns: ["viewer_id"] },
    { table: "pinned_posts", columns: ["user_id"] },
    { table: "comments", columns: ["user_id"] },
    { table: "story_votes", columns: ["user_id"] },
    { table: "story_library", columns: ["user_id"] },
    { table: "reading_progress", columns: ["user_id"] },
    { table: "story_comments", columns: ["user_id"] },
    { table: "writing_streaks", columns: ["user_id"] },

    // ── Notifications (sent or received) ──
    { table: "notifications", columns: ["sender_id", "receiver_id"] },
    { table: "notification_opinions", columns: ["sender_id", "receiver_id"] },

    // ── Profile-social rows (either side of the relationship) ──
    { table: "profile_guestbook_entries", columns: ["profile_user_id", "author_user_id"] },
    { table: "profile_visits", columns: ["profile_user_id", "visitor_user_id"] },
    { table: "profile_theme_remixes", columns: ["source_user_id", "remixer_user_id"] },

    // ── Follow graph (following or followed) ──
    { table: "follows", columns: ["follower_id", "following_id"] },

    // ── Owned content last (cascades clean up dependent rows from others) ──
    { table: "opinions", columns: ["user_id"] },
    { table: "stories", columns: ["author_id"] },
    { table: "journals", columns: ["user_id"] },
];

/**
 * Delete every DB row owned by / referencing the user, in a safe order.
 * Throws AppError(500) on the first hard DB error so the caller aborts BEFORE
 * the auth user is deleted (account remains active and recoverable).
 */
export const deleteUserDatabaseRows = async (userId) => {
    const plan = buildDeletionPlan();

    for (const { table, columns } of plan) {
        for (const column of columns) {
            const { error } = await supabase.from(table).delete().eq(column, userId);
            if (error) {
                console.error(
                    `[accountDeletion] DB cleanup failed table=${table} column=${column} user=${userId}:`,
                    error.message
                );
                throw new AppError(500, "failed to delete account data");
            }
        }
    }
};

/**
 * Best-effort removal of every file under exactly `user_id_<userId>/` in one
 * bucket. Paginates, guards each path against the exact prefix, and never
 * throws — a missing folder or a stray failed object must not block deletion.
 * Returns a small summary for logging.
 */
export const deleteStorageFolder = async (bucket, prefix) => {
    const normalizedPrefix = String(prefix).replace(/\/+$/, "");
    const guardPrefix = `${normalizedPrefix}/`;
    let removed = 0;

    for (let iteration = 0; iteration < STORAGE_MAX_ITERATIONS; iteration++) {
        // Always list from offset 0: we delete what we list, so the window
        // naturally advances and we avoid skipping shifted entries.
        const { data, error } = await supabase.storage
            .from(bucket)
            .list(normalizedPrefix, { limit: STORAGE_LIST_PAGE_SIZE, offset: 0 });

        if (error) {
            console.error(`[accountDeletion] storage list failed bucket=${bucket} prefix=${normalizedPrefix}:`, error.message);
            return { bucket, removed, ok: false };
        }

        if (!Array.isArray(data) || data.length === 0) {
            return { bucket, removed, ok: true };
        }

        const filePaths = data
            .filter((entry) => entry && typeof entry.name === "string" && entry.name)
            .map((entry) => `${normalizedPrefix}/${entry.name}`)
            .filter((path) => path.startsWith(guardPrefix));

        if (filePaths.length === 0) {
            // Only non-file entries (e.g. nested folders) remain; nothing to remove here.
            return { bucket, removed, ok: true };
        }

        const { error: removeError } = await supabase.storage.from(bucket).remove(filePaths);
        if (removeError) {
            console.error(`[accountDeletion] storage remove failed bucket=${bucket}:`, removeError.message);
            // Best effort: stop iterating this bucket to avoid an infinite loop.
            return { bucket, removed, ok: false };
        }

        removed += filePaths.length;

        if (data.length < STORAGE_LIST_PAGE_SIZE) {
            return { bucket, removed, ok: true };
        }
    }

    console.warn(`[accountDeletion] storage cleanup hit iteration cap bucket=${bucket} prefix=${normalizedPrefix}`);
    return { bucket, removed, ok: false };
};

/**
 * Best-effort cleanup of all of a user's storage folders across every bucket.
 * Never throws.
 */
export const deleteUserStorage = async (userId) => {
    const prefix = getStoragePrefix(userId);
    const results = [];
    for (const bucket of STORAGE_BUCKETS) {
        try {
            results.push(await deleteStorageFolder(bucket, prefix));
        } catch (err) {
            console.error(`[accountDeletion] storage cleanup threw bucket=${bucket} user=${userId}:`, err?.message || err);
            results.push({ bucket, removed: 0, ok: false });
        }
    }
    return results;
};

// ── Optional audit trail (best effort; silently no-ops if table absent) ──

const recordAuditStart = async (userId, username) => {
    try {
        const { data, error } = await supabase
            .from("account_deletion_audit")
            .insert({ user_id: userId, username: username || null, status: "started" })
            .select("id")
            .maybeSingle();
        if (error) return null;
        return data?.id || null;
    } catch {
        return null;
    }
};

const updateAudit = async (auditId, fields) => {
    if (!auditId) return;
    try {
        await supabase.from("account_deletion_audit").update(fields).eq("id", auditId);
    } catch {
        // auditing must never affect the deletion outcome
    }
};

/**
 * Permanently delete the account identified by `userId`.
 * @param {string} userId        Authenticated user id (req.userId) — never client-supplied.
 * @param {string} confirmation  Must equal "DELETE".
 * @returns {Promise<{deleted: true}>}
 */
export const deleteAccountService = async (userId, confirmation) => {
    if (!userId || typeof userId !== "string") {
        throw new AppError(400, "userId is required");
    }
    if (confirmation !== CONFIRMATION_PHRASE) {
        throw new AppError(400, `confirmation must be "${CONFIRMATION_PHRASE}"`);
    }

    // Load the user (cleanup metadata + existence check).
    const { data: user, error: loadError } = await supabase
        .from("users")
        .select("id, username, image_url, background")
        .eq("id", userId)
        .maybeSingle();

    if (loadError) {
        console.error(`[accountDeletion] failed to load user ${userId}:`, loadError.message);
        throw new AppError(500, "failed to load account");
    }
    if (!user) {
        throw new AppError(404, "account not found");
    }

    const auditId = await recordAuditStart(userId, user.username);

    try {
        // 1. DB rows (fatal on error → auth user untouched, account stays active).
        await deleteUserDatabaseRows(userId);

        // 2. The users row itself (fatal on error).
        const { error: userDeleteError } = await supabase.from("users").delete().eq("id", userId);
        if (userDeleteError) {
            console.error(`[accountDeletion] failed to delete users row ${userId}:`, userDeleteError.message);
            throw new AppError(500, "failed to delete account record");
        }
    } catch (err) {
        await updateAudit(auditId, { status: "failed", error_message: err?.message || "db cleanup failed" });
        throw err;
    }

    // 3. Storage cleanup (best effort — runs after the DB is committed so a
    //    later failure can never leave an active account with missing media).
    const storageResults = await deleteUserStorage(userId);
    const storageOk = storageResults.every((r) => r.ok);
    if (!storageOk) {
        console.warn(`[accountDeletion] storage cleanup incomplete for ${userId} (${user.username}):`, storageResults);
    }

    // 4. Delete the Supabase Auth user (fatal — DB data is already gone).
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
        console.error(
            `[accountDeletion] CRITICAL: DB data deleted but auth user ${userId} (${user.username}) ` +
            `could not be deleted — manual repair required:`,
            authError.message
        );
        await updateAudit(auditId, { status: "auth_delete_failed", error_message: authError.message });
        throw new AppError(500, "failed to fully delete account");
    }

    await updateAudit(auditId, { status: "completed", completed_at: new Date().toISOString() });

    return { deleted: true };
};
