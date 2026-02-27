import supabase from "./supabase.js";

const MILESTONES = [7, 14, 30, 50, 100];

/**
 * Get a user's current streak data.
 */
export const getStreakService = async (userId) => {
    if (!userId) return null;

    const { data, error } = await supabase
        .from('writing_streaks')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('error fetching streak:', error.message);
        return null;
    }

    if (!data) {
        return {
            current_streak: 0,
            longest_streak: 0,
            last_publish_date: null,
            freeze_available: false,
        };
    }

    // Check if streak is still active (not expired)
    const today = getUTCDateString();
    const gap = data.last_publish_date ? daysBetween(data.last_publish_date, today) : null;

    // If gap > 2 days (or > 3 with no freeze), streak has silently expired
    if (gap !== null && gap > 2) {
        return {
            current_streak: 0,
            longest_streak: data.longest_streak,
            last_publish_date: data.last_publish_date,
            freeze_available: data.freeze_available,
        };
    }

    return {
        current_streak: data.current_streak,
        longest_streak: data.longest_streak,
        last_publish_date: data.last_publish_date,
        freeze_available: data.freeze_available,
    };
};

/**
 * Record a publish event for streak tracking.
 * Called after a new journal/opinion/chapter is published.
 * Returns { streakData, milestone } where milestone is 7|14|30|50|100|null.
 */
export const recordPublishForStreak = async (userId) => {
    if (!userId) return { streakData: null, milestone: null };

    const today = getUTCDateString();

    // Fetch existing streak row
    const { data: existing, error: fetchErr } = await supabase
        .from('writing_streaks')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (fetchErr) {
        console.error('error fetching streak for record:', fetchErr.message);
        return { streakData: null, milestone: null };
    }

    // No existing row → first publish ever
    if (!existing) {
        const newRow = {
            user_id: userId,
            current_streak: 1,
            longest_streak: 1,
            last_publish_date: today,
            freeze_available: false,
            updated_at: new Date().toISOString(),
        };

        const { error: insertErr } = await supabase
            .from('writing_streaks')
            .insert(newRow);

        if (insertErr) {
            console.error('error inserting streak:', insertErr.message);
            return { streakData: null, milestone: null };
        }

        return { streakData: newRow, milestone: null };
    }

    // Already published today → no-op
    if (existing.last_publish_date === today) {
        return { streakData: existing, milestone: null };
    }

    const gap = daysBetween(existing.last_publish_date, today);

    let newStreak = existing.current_streak;
    let freezeAvailable = existing.freeze_available;
    let freezeUsedDate = existing.freeze_used_date;
    let freezeUsed = false;

    if (gap === 1) {
        // Consecutive day
        newStreak += 1;
    } else if (gap === 2 && freezeAvailable) {
        // Missed exactly 1 day, auto-use freeze
        newStreak += 1;
        freezeAvailable = false;
        freezeUsedDate = today;
        freezeUsed = true;
    } else {
        // Streak broken
        newStreak = 1;
    }

    const newLongest = Math.max(existing.longest_streak, newStreak);

    // Grant a new freeze every 7 days of streak (if not already available)
    if (!freezeAvailable && newStreak > 0 && newStreak % 7 === 0) {
        const lastGranted = existing.freeze_last_granted;
        if (!lastGranted || lastGranted !== today) {
            freezeAvailable = true;
        }
    }

    const updatePayload = {
        current_streak: newStreak,
        longest_streak: newLongest,
        last_publish_date: today,
        freeze_available: freezeAvailable,
        freeze_used_date: freezeUsedDate,
        freeze_last_granted: freezeAvailable ? today : existing.freeze_last_granted,
        updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supabase
        .from('writing_streaks')
        .update(updatePayload)
        .eq('user_id', userId);

    if (updateErr) {
        console.error('error updating streak:', updateErr.message);
        return { streakData: null, milestone: null };
    }

    // Check for milestone
    const milestone = MILESTONES.includes(newStreak) ? newStreak : null;

    return {
        streakData: { ...existing, ...updatePayload },
        milestone,
        freezeUsed,
    };
};

// ─── Helpers ───

function getUTCDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function daysBetween(dateStrA, dateStrB) {
    const a = new Date(dateStrA + 'T00:00:00Z');
    const b = new Date(dateStrB + 'T00:00:00Z');
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
