import supabase from './supabase.js';

/**
 * Get Monday 00:00 UTC for the current week.
 */
function getCurrentWeekMonday() {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    const monday = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - diff,
        0, 0, 0, 0
    ));
    return monday.toISOString();
}

export const getWeeklyRecapService = async (userId) => {
    const weekStart = getCurrentWeekMonday();

    const { data, error } = await supabase.rpc('get_weekly_recap', {
        p_user_id: userId,
        p_week_start: weekStart,
    });

    if (error) {
        console.error('weekly recap RPC error:', error);
        throw new Error(error.message || 'Failed to get weekly recap');
    }

    return data;
};
