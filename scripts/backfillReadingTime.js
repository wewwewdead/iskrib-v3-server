/**
 * One-time script to backfill reading_time for existing journals.
 * Run: node --env-file=.env server/scripts/backfillReadingTime.js
 *
 * Reads from .env file in project root.
 * Processes journals in batches of 100 where reading_time IS NULL or = 1 (default).
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
const WORDS_PER_MIN = 150;

function computeReadingTime(text) {
    if (!text || !text.trim()) return 1;
    return Math.ceil(text.trim().split(/\s+/).length / WORDS_PER_MIN) || 1;
}

async function backfill() {
    let totalUpdated = 0;
    let totalSkipped = 0;
    let hasMore = true;
    let lastId = null;

    console.log('Starting reading_time backfill...');

    while (hasMore) {
        let query = supabase
            .from('journals')
            .select('id, content')
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
            const wholeText = parsed?.wholeText || '';
            const reading_time = computeReadingTime(wholeText);

            const { error: updateError } = await supabase
                .from('journals')
                .update({ reading_time })
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
