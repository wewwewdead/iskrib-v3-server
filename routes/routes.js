import express from "express";
import multer from "multer";
import { writeLimiter, authLimiter, uploadLimiter, searchLimiter } from "../middleware/rateLimiter.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { verifyTurnstileController } from "../controller/turnstileController.js";
import { getUserDataController } from "../controller/getUserDataController.js";
import { checkUserController } from "../controller/checkUserController.js";
import { addReplyOpinionController, completeOnboardingController, updateInterestsController, updateJournalController, updateRepostCaptionController, updateUserDataController, uploadJournalContentController, uploadJournalImageController, uploadProfileBgController, uploadUserDataController, saveDraftController, publishDraftController } from "../controller/uploadController.js";
import { updateFont } from "../controller/updateFontColorController.js";
import { deleteJournalContent, deleteJournalImageController, deleteProfileMediaImageController } from "../controller/deleteController.js";
import { getBookmarksController, getCommentsController, getDraftsController, getFollowingFeedController, getForYouFeedController, getJournalByIdController, getJournalContentController, getJournalsController, getMonthlyHottestJournalsController, getPinnedJournalsController, getProfileMediaController, getReplyOpinionsController, getUserJournalsController, getUserPinnedIdsController, getViewOpinionController, getVisitedPinnedJournalsController, getVisitedProfileMediaController, getVisitedUserJournalsController, searchFollowingUsersController, searchJournalsController, searchUsersController } from "../controller/getController.js";
import { addBookmarkController, addCommentController, addFollowController, addOpinionReplyController, likeController, repostController, togglePinController, reorderPinController } from "../controller/interactController.js";
import { createStoryController, getStoriesController, getStoryByIdController, updateStoryController, deleteStoryController, getMyStoriesController, getUserStoriesController } from "../controller/storyController.js";
import { createChapterController, getChapterController, updateChapterController, deleteChapterController, reorderChaptersController } from "../controller/chapterController.js";
import { toggleVoteController, toggleLibraryController, getMyLibraryController, getCommentsController as getStoryCommentsController, getCommentCountsController, addCommentController as addStoryCommentController, saveProgressController, getProgressController } from "../controller/storyInteractController.js";
import { getRelatedPostsController, getUserEchoesController } from "../controller/discoveryController.js";
import { getInterestSectionsController } from "../controller/exploreController.js";
import { getTodaysPromptController, getPromptResponsesController } from "../controller/promptController.js";
import { toggleReactionController, getPostReactionsController } from "../controller/reactionController.js";
import { getWeeklyRecapController } from "../controller/recapController.js";
import { getWriterAnalyticsController } from "../controller/analyticsController.js";
import { getNotificationsController, getUnreadNotificationsController, getCountNotificationsController, readNotificationController, deleteNotificationController } from "../controller/notificationController.js";
import { addOpinionController, getOpinionsController, getMyOpinionsController, getUserOpinionsController } from "../controller/opinionController.js";
import { getFollowsDataController } from "../controller/followController.js";
import { addViewsController, updatePrivacyController, submitReplyController, getPostRepliesController, getUserByUsernameController, checkUsernameController, updateUsernameController, getStreakController } from "../controller/inlineController.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {fileSize: 10 * 1024 * 1024},
}).single('image');

router.post('/verify-turnstile', authLimiter, verifyTurnstileController);

router.get('/getUserData', getUserDataController);

router.get('/check-user', checkUserController);

router.post('/upload-user-data', authLimiter, requireAuth, upload, uploadUserDataController);

router.post('/update-user-data', requireAuth, upload, updateUserDataController);

router.post('/updateFontColor', requireAuth, upload, updateFont);

router.post('/uploadBackground', uploadLimiter, requireAuth, upload, uploadProfileBgController);

router.post('/save-journal-image', uploadLimiter, requireAuth, upload, uploadJournalImageController);

router.post('/delete-journal-images', requireAuth, upload, deleteJournalImageController);
router.delete('/media/image', requireAuth, deleteProfileMediaImageController);

router.post('/save-journal', uploadLimiter, requireAuth, upload, uploadJournalContentController);

router.post('/update-journal', requireAuth, upload, updateJournalController);

router.post('/update-repost-caption', requireAuth, updateRepostCaptionController);

// ── Journal Drafts ──
router.post('/journal/draft', writeLimiter, requireAuth, saveDraftController);
router.post('/journal/publish', writeLimiter, requireAuth, publishDraftController);
router.get('/journal/drafts', requireAuth, getDraftsController);

router.post('/complete-onboarding', requireAuth, completeOnboardingController);

router.post('/update-interests', requireAuth, updateInterestsController);

router.get('/journals/following', requireAuth, getFollowingFeedController);
router.get('/journals/for-you', requireAuth, getForYouFeedController);
router.get('/journals', getJournalsController);
router.get('/journals/hottest-monthly', getMonthlyHottestJournalsController);
router.get('/journals/search', searchLimiter, searchJournalsController);
router.get('/users/search', searchLimiter, searchUsersController);
router.get('/users/following/search', searchLimiter, requireAuth, searchFollowingUsersController);
router.get('/journal/:journalId/related', getRelatedPostsController);
router.get('/journal/:journalId/user-echoes', requireAuth, getUserEchoesController);
router.get('/journal/:journalId/content', requireAuth, getJournalContentController);
router.get('/journal/:journalId', optionalAuth, getJournalByIdController);
router.get('/explore/interests', requireAuth, getInterestSectionsController);

router.get('/userJournals', requireAuth, getUserJournalsController);
router.get('/profileMedia', requireAuth, getProfileMediaController);
router.get('/visitedProfileMedia', requireAuth, getVisitedProfileMediaController);

router.get('/visitedUserJournals', getVisitedUserJournalsController);

router.post('/togglePin', writeLimiter, requireAuth, togglePinController);
router.post('/reorderPin', writeLimiter, requireAuth, reorderPinController);
router.get('/pinnedJournals', requireAuth, getPinnedJournalsController);
router.get('/visitedPinnedJournals', getVisitedPinnedJournalsController);
router.get('/userPinnedIds', requireAuth, getUserPinnedIdsController);

router.delete('/deleteJournal/:journalId', requireAuth, deleteJournalContent);

router.post('/like', writeLimiter, requireAuth, likeController);

router.post('/repost', writeLimiter, requireAuth, repostController);

router.post('/addComment', writeLimiter, requireAuth, upload, addCommentController);

router.get('/getComments', getCommentsController);

router.post('/addBookmark', writeLimiter, requireAuth, upload, addBookmarkController);

router.get('/getBookmarks', requireAuth, getBookmarksController)

router.post('/addFollows', writeLimiter, requireAuth, upload, addFollowController);

router.get('/getFollowsData', optionalAuth, getFollowsDataController);

router.get('/getCountNotifications', requireAuth, getCountNotificationsController);

router.get('/getNotifications', requireAuth, getNotificationsController);

router.post('/readNotification', requireAuth, readNotificationController);

router.get('/getUnreadNotification', requireAuth, getUnreadNotificationsController);

router.delete('/deleteNotification/:notifId', requireAuth, deleteNotificationController);

router.post('/addViews', requireAuth, upload, addViewsController);

router.post('/updatePrivacy', requireAuth, upload, updatePrivacyController);

router.post('/addOpinion', writeLimiter, requireAuth, upload, addOpinionController);

router.get('/getOpinions', getOpinionsController);

router.get('/getMyOpinions', requireAuth, getMyOpinionsController);

router.get('/getUserOpinions', getUserOpinionsController);

router.post('/submitReply/:parent_id/:user_id/:post_id/:receiver_id', requireAuth, upload, submitReplyController);

router.get('/getPostReplies/:parent_id', getPostRepliesController);

router.get('/viewOpinion/:postId/:userId', getViewOpinionController);

router.post('/addOpinionReply/:parent_id/:user_id/:receiver_id', requireAuth, upload, addOpinionReplyController);

router.get('/getOpinionReply/:parentId', getReplyOpinionsController);

// ── Username endpoints ──
router.get('/user/:username', getUserByUsernameController);

router.get('/check-username/:username', checkUsernameController);

router.post('/update-username', requireAuth, updateUsernameController);

// ── Story routes ──
router.post('/stories', requireAuth, upload, createStoryController);
router.get('/stories', optionalAuth, getStoriesController);
router.get('/stories/my', requireAuth, getMyStoriesController);
router.get('/stories/library', requireAuth, getMyLibraryController);
router.get('/stories/user/:userId', optionalAuth, getUserStoriesController);
router.get('/stories/:storyId', optionalAuth, getStoryByIdController);
router.patch('/stories/:storyId', requireAuth, upload, updateStoryController);
router.delete('/stories/:storyId', requireAuth, deleteStoryController);

// ── Chapter routes ──
router.post('/stories/:storyId/chapters', requireAuth, createChapterController);
router.get('/stories/:storyId/chapters/:chapterId', optionalAuth, getChapterController);
router.patch('/stories/:storyId/chapters/:chapterId', requireAuth, updateChapterController);
router.delete('/stories/:storyId/chapters/:chapterId', requireAuth, deleteChapterController);
router.post('/stories/:storyId/chapters/reorder', requireAuth, reorderChaptersController);

// ── Story interaction routes ──
router.post('/stories/:storyId/vote', requireAuth, toggleVoteController);
router.post('/stories/:storyId/library', requireAuth, toggleLibraryController);
router.get('/chapters/:chapterId/comments', optionalAuth, getStoryCommentsController);
router.get('/chapters/:chapterId/comment-counts', optionalAuth, getCommentCountsController);
router.post('/chapters/:chapterId/comments', requireAuth, addStoryCommentController);
router.post('/stories/:storyId/progress', requireAuth, saveProgressController);
router.get('/stories/:storyId/progress', requireAuth, getProgressController);

// ─── Reactions ───
router.post('/reaction', writeLimiter, requireAuth, toggleReactionController);
router.get('/reactions/:journalId', getPostReactionsController);

// ─── Daily Prompts ───
router.get('/prompt/today', getTodaysPromptController);
router.get('/prompt/:promptId/responses', getPromptResponsesController);

// ─── Weekly Recap ───
router.get('/recap/weekly', requireAuth, getWeeklyRecapController);

// ─── Writer Analytics ───
router.get('/analytics', requireAuth, getWriterAnalyticsController);

// ─── Streaks ───
router.get('/streak/:userId', getStreakController);

export default router;
