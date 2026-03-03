/**
 * One-time script to backfill preview_text and thumbnail_url for existing journals.
 * Run: node --env-file=.env server/scripts/backfillPreviews.js
 *
 * Reads from .env file in project root.
 * Processes journals in batches of 100 where preview_text IS NULL.
 */
import { createClient } from '@supabase/supabase-js';
import ParseContent from '../utils/parseData.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 100;

async function backfill() {
    let totalUpdated = 0;
    let totalSkipped = 0;
    let hasMore = true;
    let lastId = null;

    console.log('Starting preview backfill...');

    while (hasMore) {
        let query = supabase
            .from('journals')
            .select('id, content')
            .is('preview_text', null)
            .order('id', { ascending: true })
            .limit(BATCH_SIZE);

        if (lastId) {
            query = query.gt('id', lastId);
        }

        const { data: journals, error } = await query;

        if (error) {
            console.error('Error fetching journals:', error.message);
            break;
        }

        if (!journals || journals.length === 0) {
            hasMore = false;
            break;
        }

        for (const journal of journals) {
            lastId = journal.id;

            const parsed = ParseContent(journal.content);
            const preview_text = parsed?.slicedText || '';
            const thumbnail_url = parsed?.firstImage?.src || null;

            const { error: updateError } = await supabase
                .from('journals')
                .update({ preview_text, thumbnail_url })
                .eq('id', journal.id);

            if (updateError) {
                console.error(`  Error updating journal ${journal.id}:`, updateError.message);
                totalSkipped++;
            } else {
                totalUpdated++;
            }
        }

        console.log(`  Processed batch: ${journals.length} journals (total updated: ${totalUpdated})`);

        if (journals.length < BATCH_SIZE) {
            hasMore = false;
        }
    }

    console.log(`\nBackfill complete: ${totalUpdated} updated, ${totalSkipped} skipped`);
}

backfill().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
