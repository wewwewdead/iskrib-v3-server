import { asyncHandler } from "../utils/controllerHandler.js";
import { deleteAccountService } from "../services/accountDeletionService.js";

/**
 * DELETE /api/account
 * Protected by requireAuth + writeLimiter.
 * The user id comes ONLY from req.userId (the authenticated session) — never
 * from the request body — so a caller can only ever delete their own account.
 */
export const deleteAccountController = asyncHandler(async (req, res) => {
    const { confirmation } = req.body || {};

    // email is used for logging context only, never for authorization.
    const email = req.authUser?.email;
    console.log(`[accountDeletion] delete requested user=${req.userId}${email ? ` email=${email}` : ""}`);

    const result = await deleteAccountService(req.userId, confirmation);
    return res.status(200).json(result);
});
