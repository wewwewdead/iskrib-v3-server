import supabase from "./supabase.js";

const CONFIDENCE_TIERS = {
    high:   { threshold: 0.60, maxResults: 5, label: 'high' },
    medium: { threshold: 0.48, maxResults: 3, label: 'medium' },
    low:    { threshold: 0.38, maxResults: 2, label: 'low' },
};

async function getDynamicFloor() {
    const { count, error } = await supabase
        .from('journals')
        .select('id', { count: 'exact', head: true })
        .eq('privacy', 'public')
        .not('embeddings', 'is', null);

    if (error) {
        console.error('getDynamicFloor count error:', error.message);
        return 0.30;
    }

    if (count < 500)  return 0.35;
    if (count < 2000) return 0.40;
    return 0.45;
}

function getConfidenceTier(topSimilarity) {
    if (topSimilarity >= CONFIDENCE_TIERS.high.threshold)   return CONFIDENCE_TIERS.high;
    if (topSimilarity >= CONFIDENCE_TIERS.medium.threshold) return CONFIDENCE_TIERS.medium;
    if (topSimilarity >= CONFIDENCE_TIERS.low.threshold)    return CONFIDENCE_TIERS.low;
    return null;
}

export async function getRelatedPostsService(journalId) {
    const dynamicFloor = await getDynamicFloor();

    // First attempt with dynamic floor
    let { data, error } = await supabase.rpc('find_related_posts', {
        source_post_id: journalId,
        match_count: 8,
        similarity_floor: dynamicFloor,
        recency_days: 365,
    });

    if (error) {
        throw { status: 500, error: 'Failed to find related posts: ' + error.message };
    }

    // Fallback: if < 2 results, try with a lower floor
    if (!data || data.length < 2) {
        const lowerFloor = Math.max(dynamicFloor - 0.03, 0.30);
        if (lowerFloor < dynamicFloor) {
            const fallback = await supabase.rpc('find_related_posts', {
                source_post_id: journalId,
                match_count: 8,
                similarity_floor: lowerFloor,
                recency_days: 365,
            });
            if (!fallback.error && fallback.data && fallback.data.length >= 2) {
                data = fallback.data;
            }
        }
    }

    // Never show fewer than 2 results
    if (!data || data.length < 2) {
        return { posts: [], confidence: 'none', topSimilarity: 0 };
    }

    const topSimilarity = data[0]?.semantic_similarity || 0;
    const tier = getConfidenceTier(topSimilarity);

    if (!tier) {
        return { posts: [], confidence: 'none', topSimilarity };
    }

    // Cap results by confidence tier
    const cappedPosts = data.slice(0, tier.maxResults);

    // Ensure we still have at least 2 after capping
    if (cappedPosts.length < 2) {
        return { posts: [], confidence: 'none', topSimilarity };
    }

    return {
        posts: cappedPosts,
        confidence: tier.label,
        topSimilarity,
    };
}
