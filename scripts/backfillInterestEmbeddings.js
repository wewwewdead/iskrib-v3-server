/**
 * One-time script to generate interests embeddings for existing users.
 * Run: node --env-file=.env server/scripts/backfillInterestEmbeddings.js
 */
import { createClient } from '@supabase/supabase-js';
import GenerateEmbeddings from '../utils/GenerateEmbeddings.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const run = async () => {
    // Fetch users who have writing_interests but no interests_embedding
    const { data: users, error } = await supabase
        .from('users')
        .select('id, writing_interests')
        .not('writing_interests', 'is', null)
        .is('interests_embedding', null);

    if (error) {
        console.error('Failed to fetch users:', error.message);
        process.exit(1);
    }

    // Filter to users who actually have a non-empty interests array
    const eligible = (users || []).filter(u =>
        Array.isArray(u.writing_interests) && u.writing_interests.length > 0
    );

    if (eligible.length === 0) {
        console.log('No users need interest embedding backfill.');
        return;
    }

    console.log(`Found ${eligible.length} users with interests but no embedding.`);

    let updated = 0;
    let failed = 0;

    for (const user of eligible) {
        const joined = user.writing_interests
            .filter(i => typeof i === 'string' && i.trim())
            .join(', ');

        if (!joined) {
            console.log(`  Skipping user ${user.id} — empty interests after filtering`);
            failed++;
            continue;
        }

        const embedding = await GenerateEmbeddings(joined, '');

        if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
            console.error(`  Failed to generate embedding for user ${user.id}`);
            failed++;
            continue;
        }

        const { error: updateError } = await supabase
            .from('users')
            .update({ interests_embedding: embedding })
            .eq('id', user.id);

        if (updateError) {
            console.error(`  Failed to update user ${user.id}:`, updateError.message);
            failed++;
        } else {
            updated++;
            console.log(`  User ${user.id} -> embedding (${embedding.length} dims) [${user.writing_interests.join(', ')}]`);
        }
    }

    console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
};

run().catch((err) => {
    console.error('Backfill error:', err);
    process.exit(1);
});
