import supabase from "./supabase.js";

/**
 * Get today's writing prompt.
 * Uses dayOfYear % promptCount for deterministic rotation.
 */
export const getTodaysPromptService = async () => {
    // Get total prompt count
    const { count, error: countErr } = await supabase
        .from('writing_prompts')
        .select('id', { count: 'exact', head: true });

    if (countErr || !count || count === 0) {
        console.error('error getting prompt count:', countErr?.message);
        return null;
    }

    // Calculate today's prompt index
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const diff = now - startOfYear;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const promptIndex = dayOfYear % count;

    // Fetch the prompt at that index (ordered by id ASC)
    const { data, error } = await supabase
        .from('writing_prompts')
        .select('*')
        .order('id', { ascending: true })
        .range(promptIndex, promptIndex)
        .single();

    if (error) {
        console.error('error fetching today\'s prompt:', error.message);
        return null;
    }

    return data;
};

/**
 * Get journals that responded to a specific prompt.
 */
export const getPromptResponsesService = async (promptId, limit = 5, before = null) => {
    if (!promptId) return { responses: [], count: 0 };

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50);

    let query = supabase
        .from('journals')
        .select(`
            id,
            title,
            created_at,
            user_id,
            users(id, name, image_url, badge)
        `, { count: !before ? 'exact' : undefined })
        .eq('prompt_id', promptId)
        .eq('privacy', 'public')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(parsedLimit + 1);

    if (before) {
        query = query.lt('created_at', before);
    }

    const { data, error, count } = await query;

    if (error) {
        console.error('error fetching prompt responses:', error.message);
        return { responses: [], count: 0 };
    }

    const hasMore = (data || []).length > parsedLimit;
    const responses = hasMore ? data.slice(0, parsedLimit) : (data || []);

    const result = { responses, hasMore };
    if (!before) {
        result.count = count || 0;

        const { count: totalResponses } = await supabase
            .from('journals')
            .select('id', { count: 'exact', head: true })
            .eq('prompt_id', promptId)
            .eq('privacy', 'public');
        // Approximate unique count — for prompts, count of responses is close to unique users
        // since each user typically responds once
        result.uniqueCount = totalResponses || 0;
    }

    return result;
};
