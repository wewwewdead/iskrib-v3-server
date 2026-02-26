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
export const getPromptResponsesService = async (promptId, limit = 10) => {
    if (!promptId) return { responses: [], count: 0 };

    const { data, error, count } = await supabase
        .from('journals')
        .select(`
            id,
            title,
            created_at,
            user_id,
            users(id, name, image_url, badge)
        `, { count: 'exact' })
        .eq('prompt_id', promptId)
        .eq('privacy', 'public')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('error fetching prompt responses:', error.message);
        return { responses: [], count: 0 };
    }

    return { responses: data || [], count: count || 0 };
};
