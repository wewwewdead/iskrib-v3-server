/**
 * One-time script to generate usernames for existing users.
 * Run: node --env-file=.env server/scripts/backfillUsernames.js
 *
 * Reads from .env file in project root.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const slugify = (name) => {
    return String(name || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

const randomSuffix = () => {
    return Math.random().toString(36).slice(2, 6);
};

const run = async () => {
    // Fetch all users without a username
    const { data: users, error } = await supabase
        .from('users')
        .select('id, name, username')
        .is('username', null);

    if (error) {
        console.error('Failed to fetch users:', error.message);
        process.exit(1);
    }

    if (!users || users.length === 0) {
        console.log('No users need username backfill.');
        return;
    }

    console.log(`Found ${users.length} users without usernames.`);

    // Track used usernames to avoid collisions within this batch
    const usedUsernames = new Set();

    // Also fetch all existing usernames
    const { data: existingUsers } = await supabase
        .from('users')
        .select('username')
        .not('username', 'is', null);

    if (existingUsers) {
        existingUsers.forEach((u) => usedUsernames.add(u.username.toLowerCase()));
    }

    let updated = 0;
    let failed = 0;

    for (const user of users) {
        let base = slugify(user.name);
        if (!base || base.length < 3) {
            base = `user-${randomSuffix()}`;
        }

        let candidate = base.slice(0, 50);
        let attempts = 0;

        while (usedUsernames.has(candidate.toLowerCase()) && attempts < 10) {
            candidate = `${base.slice(0, 44)}-${randomSuffix()}`;
            attempts++;
        }

        if (usedUsernames.has(candidate.toLowerCase())) {
            console.error(`Could not find unique username for user ${user.id} (name: "${user.name}")`);
            failed++;
            continue;
        }

        const { error: updateError } = await supabase
            .from('users')
            .update({ username: candidate })
            .eq('id', user.id);

        if (updateError) {
            console.error(`Failed to update user ${user.id}:`, updateError.message);
            failed++;
        } else {
            usedUsernames.add(candidate.toLowerCase());
            updated++;
            console.log(`  ${user.name} -> @${candidate}`);
        }
    }

    console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
};

run().catch((err) => {
    console.error('Backfill error:', err);
    process.exit(1);
});
