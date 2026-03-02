import supabase from "./supabase.js";
import GenerateEmbeddings from "../utils/GenerateEmbeddings.js";

// Canonical topics from onboarding wizard (InterestsStep.jsx)
const CANONICAL_TOPICS = [
    'Poetry', 'Fiction', 'Journals', 'Essays',
    'Philosophy', 'Self-Reflection', 'Creative Nonfiction', 'Short Stories',
    'Science', 'Nature', 'Music', 'Art',
    'Travel', 'Technology', 'Mental Health', 'Spirituality',
];

// In-memory cache: topic string → embedding array
const topicEmbeddingCache = new Map();

/**
 * Generate a single embedding from an array of interest strings.
 * Joins them into a comma-separated string and runs through the embedding pipeline.
 */
export const generateInterestsEmbedding = async (interests) => {
    if (!Array.isArray(interests) || interests.length === 0) {
        return null;
    }

    const joined = interests
        .filter(i => typeof i === 'string' && i.trim())
        .join(', ');

    if (!joined) return null;

    return GenerateEmbeddings(joined, '');
};

/**
 * Generate an interests embedding for a user and store it on the users table.
 */
export const updateUserInterestsEmbedding = async (userId, interests) => {
    const embedding = await generateInterestsEmbedding(interests);
    if (!embedding) {
        throw new Error('failed to generate interests embedding');
    }

    const { error } = await supabase
        .from('users')
        .update({ interests_embedding: embedding })
        .eq('id', userId);

    if (error) {
        throw new Error(`failed to update interests_embedding: ${error.message}`);
    }
};

/**
 * Bootstrap topic_embeddings table at server start.
 * Generates embeddings for any missing topics and loads all into the in-memory cache.
 */
export const bootstrapTopicEmbeddings = async () => {
    // Fetch existing topic embeddings
    const { data: existing, error: fetchError } = await supabase
        .from('topic_embeddings')
        .select('topic, embedding');

    if (fetchError) {
        console.error('Failed to fetch topic_embeddings:', fetchError.message);
        return;
    }

    const existingTopics = new Set((existing || []).map(r => r.topic));

    // Load existing into cache
    for (const row of (existing || [])) {
        topicEmbeddingCache.set(row.topic, row.embedding);
    }

    // Find missing topics
    const missing = CANONICAL_TOPICS.filter(t => !existingTopics.has(t));

    if (missing.length > 0) {
        console.log(`topic_embeddings: generating ${missing.length} missing embeddings...`);

        for (const topic of missing) {
            try {
                const embedding = await GenerateEmbeddings(topic, '');
                if (!embedding) {
                    console.error(`  Failed to generate embedding for topic "${topic}"`);
                    continue;
                }

                const { error: insertError } = await supabase
                    .from('topic_embeddings')
                    .upsert({ topic, embedding }, { onConflict: 'topic' });

                if (insertError) {
                    console.error(`  Failed to insert topic "${topic}":`, insertError.message);
                } else {
                    topicEmbeddingCache.set(topic, embedding);
                }
            } catch (err) {
                console.error(`  Error generating embedding for topic "${topic}":`, err.message);
            }
        }
    }

    console.log(`topic_embeddings: all topics present (${topicEmbeddingCache.size} cached)`);
};

/**
 * Get the cached embedding for a topic.
 * Returns null if not cached (topic was never bootstrapped or failed).
 */
export const getTopicEmbedding = (topic) => {
    return topicEmbeddingCache.get(topic) || null;
};
