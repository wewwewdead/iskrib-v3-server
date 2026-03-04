import supabase from './supabase.js';

const RANGE_PRESETS = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
};

function computeDateRange(range) {
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);

    if (range === 'all') {
        // 5 years back as a practical "all time"
        const start = new Date();
        start.setUTCFullYear(start.getUTCFullYear() - 5);
        start.setUTCHours(0, 0, 0, 0);
        return { start: start.toISOString(), end: end.toISOString() };
    }

    const days = RANGE_PRESETS[range];
    if (!days) throw new Error('Invalid range. Use 7d, 30d, 90d, or all');

    const start = new Date();
    start.setUTCDate(start.getUTCDate() - days);
    start.setUTCHours(0, 0, 0, 0);

    return { start: start.toISOString(), end: end.toISOString() };
}

export const getWriterAnalyticsService = async (userId, range = '30d') => {
    const { start, end } = computeDateRange(range);

    const { data, error } = await supabase.rpc('get_writer_analytics', {
        p_user_id: userId,
        p_range_start: start,
        p_range_end: end,
    });

    if (error) {
        console.error('writer analytics RPC error:', error);
        throw new Error(error.message || 'Failed to get writer analytics');
    }

    return data;
};
