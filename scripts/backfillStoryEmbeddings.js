/**
 * One-time script to generate embeddings for existing stories.
 * Run: node --env-file=.env server/scripts/backfillStoryEmbeddings.js
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
    const { data: stories, error } = await supabase
        .from('stories')
        .select('id, title, description')
        .is('embedding', null);

    if (error) {
        console.error('Failed to fetch stories:', error.message);
        process.exit(1);
    }

    if (!stories || stories.length === 0) {
        console.log('No stories need embedding backfill.');
        return;
    }

    console.log(`Found ${stories.length} stories without embeddings.`);

    let updated = 0;
    let failed = 0;

    for (const story of stories) {
        const embedding = await GenerateEmbeddings(
            (story.title || '').trim(),
            (story.description || '').trim()
        );

        if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
            console.error(`  Failed to generate embedding for story ${story.id} ("${story.title}")`);
            failed++;
            continue;
        }

        const { error: updateError } = await supabase
            .from('stories')
            .update({ embedding })
            .eq('id', story.id);

        if (updateError) {
            console.error(`  Failed to update story ${story.id}:`, updateError.message);
            failed++;
        } else {
            updated++;
            console.log(`  ${story.title} -> embedding (${embedding.length} dims)`);
        }
    }

    console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
};

run().catch((err) => {
    console.error('Backfill error:', err);
    process.exit(1);
});
