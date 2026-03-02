import supabase from "./supabase.js";
import { getTopicEmbedding } from "./interestEmbeddingService.js";

const MAX_INTEREST_SECTIONS = 8;
const MIN_POSTS_PER_SECTION = 2;

/**
 * Get interest-based explore sections for a user.
 * Fetches the user's writing_interests, looks up cached topic embeddings,
 * and calls get_interest_posts RPC in parallel for each interest.
 */
export const getInterestSectionsService = async (userId) => {
    if (!userId) {
        throw { status: 401, error: 'authentication required' };
    }

    // Fetch user's writing interests
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('writing_interests')
        .eq('id', userId)
        .single();

    if (userError) {
        console.error('supabase error fetching user interests:', userError.message);
        throw { status: 500, error: 'failed to fetch user interests' };
    }

    const interests = userData?.writing_interests;
    if (!Array.isArray(interests) || interests.length === 0) {
        return { sections: [] };
    }

    // Cap at MAX_INTEREST_SECTIONS
    const capped = interests.slice(0, MAX_INTEREST_SECTIONS);

    // Build queries in parallel — skip interests without a cached embedding
    const sectionPromises = capped.map(async (interest) => {
        const embedding = getTopicEmbedding(interest);
        if (!embedding) {
            return null;
        }

        try {
            const { data: posts, error: rpcError } = await supabase.rpc('get_interest_posts', {
                p_topic_embedding: embedding,
                p_limit: 8,
                p_recency_days: 30
            });

            if (rpcError) {
                console.error(`RPC error for interest "${interest}":`, rpcError.message);
                return null;
            }

            if (!posts || posts.length < MIN_POSTS_PER_SECTION) {
                return null;
            }

            return {
                interest,
                posts: posts.map(row => ({
                    id: row.id,
                    user_id: row.user_id,
                    title: row.title,
                    content: row.content,
                    post_type: row.post_type,
                    created_at: row.created_at,
                    views: row.views,
                    user_name: row.user_name,
                    user_image_url: row.user_image_url,
                    user_badge: row.user_badge,
                    username: row.username,
                    like_count: Number(row.like_count),
                    comment_count: Number(row.comment_count),
                    bookmark_count: Number(row.bookmark_count),
                }))
            };
        } catch (err) {
            console.error(`Error fetching interest posts for "${interest}":`, err?.message || err);
            return null;
        }
    });

    const results = await Promise.all(sectionPromises);
    const sections = results.filter(Boolean);

    return { sections };
};
