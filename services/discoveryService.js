import supabase from "./supabase.js";
import { createLRUCache } from "../utils/LRUCache.js";

// ── In-memory LRU cache for related posts ──
const relatedCache = createLRUCache(200, 10 * 60 * 1000); // 200 entries, 10min TTL
const getRelatedCached = (key) => relatedCache.get(key);
const setRelatedCached = (key, value) => relatedCache.set(key, value);

// ── In-memory LRU cache for user echoes (Echo Bloom) ──
// Keyed on `${userId}:${journalId}` so two users asking "my echoes of X"
// get separate cache slots. TTL mirrors relatedCache.
const userEchoesCache = createLRUCache(200, 10 * 60 * 1000);
const getUserEchoesCached = (key) => userEchoesCache.get(key);
const setUserEchoesCached = (key, value) => userEchoesCache.set(key, value);

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

// ═══════════════════════════════════════════════════════════════════
// Echo Bloom — user-scoped semantic similarity
//
// Returns the requesting user's OWN past journals that are semantically
// close to `journalId`. Uses find_user_echoes (pgvector cosine on
// gte-small embeddings), not a popularity or recency heuristic.
//
// Confidence tiers are looser than the cross-author /related endpoint
// because a single user's archive is much smaller than the global pool
// and will naturally produce lower top similarities.
// ═══════════════════════════════════════════════════════════════════

const USER_ECHOES_TIERS = {
    high:   { threshold: 0.55, maxResults: 3, label: 'high' },
    medium: { threshold: 0.42, maxResults: 2, label: 'medium' },
    low:    { threshold: 0.32, maxResults: 1, label: 'low' },
};

function getUserEchoesTier(topSimilarity) {
    if (topSimilarity >= USER_ECHOES_TIERS.high.threshold)   return USER_ECHOES_TIERS.high;
    if (topSimilarity >= USER_ECHOES_TIERS.medium.threshold) return USER_ECHOES_TIERS.medium;
    if (topSimilarity >= USER_ECHOES_TIERS.low.threshold)    return USER_ECHOES_TIERS.low;
    return null;
}

export async function getUserEchoesService(journalId, userId) {
    if (!journalId) {
        throw { status: 400, error: 'journalId is required' };
    }
    if (!userId) {
        throw { status: 401, error: 'authentication required' };
    }

    const cacheKey = `${userId}:${journalId}`;
    const cached = getUserEchoesCached(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase.rpc('find_user_echoes', {
        source_post_id: journalId,
        source_user_id: userId,
        match_count: 3,
        similarity_floor: 0.32,
    });

    if (error) {
        console.error('find_user_echoes RPC error:', error.message);
        throw { status: 500, error: 'failed to find user echoes' };
    }

    if (!data || data.length === 0) {
        const empty = { posts: [], confidence: 'none', topSimilarity: 0 };
        setUserEchoesCached(cacheKey, empty);
        return empty;
    }

    const topSimilarity = data[0]?.semantic_similarity || 0;
    const tier = getUserEchoesTier(topSimilarity);

    if (!tier) {
        const noneResult = { posts: [], confidence: 'none', topSimilarity };
        setUserEchoesCached(cacheKey, noneResult);
        return noneResult;
    }

    const result = {
        posts: data.slice(0, tier.maxResults),
        confidence: tier.label,
        topSimilarity,
    };
    setUserEchoesCached(cacheKey, result);
    return result;
}

// ═══════════════════════════════════════════════════════════════════
// V3 — Thread retrieval
//
// Backed by find_journal_thread (recursive CTE over parent_journal_id).
// Returns the full chain containing `journalId`, ordered root → leaf,
// with privacy honoring the viewer: the viewer always sees their own
// posts, other users' private posts are filtered out by the RPC.
//
// Intentionally NOT cached — threads mutate whenever a new child is
// published, and the volume is low enough that a DB hit per read is
// fine. If thread reads become a hot path, add an LRU keyed on
// `${viewerId}:${journalId}` with short TTL (~60s).
// ═══════════════════════════════════════════════════════════════════

export async function getJournalThreadService(journalId, viewerUserId = null) {
    if (!journalId) {
        throw { status: 400, error: 'journalId is required' };
    }

    const { data, error } = await supabase.rpc('find_journal_thread', {
        source_id: journalId,
        viewer_user_id: viewerUserId,
        max_depth: 20,
    });

    if (error) {
        // If the RPC doesn't exist yet (pre-migration environment),
        // fail soft with an empty thread rather than 500ing the request.
        if (error?.message?.includes('find_journal_thread')) {
            return { posts: [] };
        }
        console.error('find_journal_thread RPC error:', error.message);
        throw { status: 500, error: 'failed to fetch journal thread' };
    }

    return { posts: data || [] };
}
