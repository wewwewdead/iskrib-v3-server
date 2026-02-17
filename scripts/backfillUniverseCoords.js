import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE,
);

const simpleHash = (str) => {
    let h = 0;
    for(let i = 0; i < str.length; i++){
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
};

const userHomeCoords = (userId) => {
    const mid = Math.floor(userId.length / 2);
    const xHash = Math.abs(simpleHash(userId.slice(0, mid)));
    const yHash = Math.abs(simpleHash(userId.slice(mid)));
    const x = (xHash % 50001) / 50000 * 50000 - 25000;
    const y = (yHash % 50001) / 50000 * 50000 - 25000;
    return {x, y};
};

const spiralLayout = (index) => {
    if(index === 0) return {dx: 0, dy: 0};
    const angle = index * 0.8;
    const radius = 30 * Math.sqrt(index);
    return {dx: radius * Math.cos(angle), dy: radius * Math.sin(angle)};
};

async function backfill(){
    console.log('Fetching posts with no universe coordinates...');

    const {data: posts, error} = await supabase
        .from('journals')
        .select('id, user_id, created_at')
        .is('universe_x', null)
        .order('user_id', {ascending: true})
        .order('created_at', {ascending: true});

    if(error){
        console.error('Error fetching posts:', error.message);
        process.exit(1);
    }

    if(!posts || posts.length === 0){
        console.log('No posts to backfill.');
        process.exit(0);
    }

    console.log(`Found ${posts.length} posts to backfill.`);

    const grouped = {};
    for(const post of posts){
        if(!grouped[post.user_id]) grouped[post.user_id] = [];
        grouped[post.user_id].push(post);
    }

    let updated = 0;
    let failed = 0;

    for(const [userId, userPosts] of Object.entries(grouped)){
        const {count: existingCount} = await supabase
            .from('journals')
            .select('id', {count: 'exact', head: true})
            .eq('user_id', userId)
            .not('universe_x', 'is', null);

        const startIndex = existingCount || 0;
        const home = userHomeCoords(userId);

        for(let i = 0; i < userPosts.length; i++){
            const offset = spiralLayout(startIndex + i);
            const universe_x = home.x + offset.dx;
            const universe_y = home.y + offset.dy;

            const {error: updateError} = await supabase
                .from('journals')
                .update({universe_x, universe_y})
                .eq('id', userPosts[i].id);

            if(updateError){
                console.error(`Failed to update post ${userPosts[i].id}:`, updateError.message);
                failed++;
            } else {
                updated++;
            }
        }
    }

    console.log(`Backfill complete. Updated: ${updated}, Failed: ${failed}`);
    process.exit(0);
}

backfill();
