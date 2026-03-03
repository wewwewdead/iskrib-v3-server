import supabase from "./supabase.js";

// ── In-memory LRU cache for related posts ──
const RELATED_CACHE_MAX = 200;
const RELATED_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _relatedCache = new Map();
const getRelatedCached = (key) => {
    const entry = _relatedCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > RELATED_CACHE_TTL_MS) {
        _relatedCache.delete(key);
        return null;
    }
    // LRU refresh — move to end
    _relatedCache.delete(key);
    _relatedCache.set(key, entry);
    return entry.value;
};
const setRelatedCached = (key, value) => {
    if (_relatedCache.size >= RELATED_CACHE_MAX) {
        const firstKey = _relatedCache.keys().next().value;
        _relatedCache.delete(firstKey);
    }
    _relatedCache.set(key, { value, ts: Date.now() });
};

const CONFIDENCE_TIERS = {
    high:   { threshold: 0.60, maxResults: 5, label: 'high' },
    medium: { threshold: 0.48, maxResults: 3, label: 'medium' },
    low:    { threshold: 0.38, maxResults: 2, label: 'low' },
};

let _dynamicFloorCache = { value: null, ts: 0 };
const DYNAMIC_FLOOR_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getDynamicFloor() {
    if (_dynamicFloorCache.value !== null && Date.now() - _dynamicFloorCache.ts < DYNAMIC_FLOOR_TTL_MS) {
        return _dynamicFloorCache.value;
    }

    const { count, error } = await supabase
        .from('journals')
        .select('id', { count: 'exact', head: true })
        .eq('privacy', 'public')
        .not('embeddings', 'is', null);

    if (error) {
        console.error('getDynamicFloor count error:', error.message);
        return _dynamicFloorCache.value ?? 0.30;
    }

    let floor;
    if (count < 500)  floor = 0.35;
    else if (count < 2000) floor = 0.40;
    else floor = 0.45;

    _dynamicFloorCache = { value: floor, ts: Date.now() };
    return floor;
}

function getConfidenceTier(topSimilarity) {
    if (topSimilarity >= CONFIDENCE_TIERS.high.threshold)   return CONFIDENCE_TIERS.high;
    if (topSimilarity >= CONFIDENCE_TIERS.medium.threshold) return CONFIDENCE_TIERS.medium;
    if (topSimilarity >= CONFIDENCE_TIERS.low.threshold)    return CONFIDENCE_TIERS.low;
    return null;
}

export async function getRelatedPostsService(journalId) {
    const cached = getRelatedCached(journalId);
    if (cached) return cached;

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

    const result = {
        posts: cappedPosts,
        confidence: tier.label,
        topSimilarity,
    };
    setRelatedCached(journalId, result);
    return result;
}
