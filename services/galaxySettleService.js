import supabase from './supabase.js';

// ── Hash helpers (mirror client-side userHomeCoords) ──────────────────
const simpleHash = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
};

const userHomeCoords = (userId) => {
    const mid = Math.floor(userId.length / 2);
    const xHash = simpleHash(userId.slice(0, mid));
    const yHash = simpleHash(userId.slice(mid));
    const x = (xHash % 50001) / 50000 * 50000 - 25000;
    const y = (yHash % 50001) / 50000 * 50000 - 25000;
    return { x, y };
};

const spiralLayout = (index) => {
    if (index === 0) return { dx: 0, dy: 0 };
    const angle = index * 0.8;
    const radius = 30 * Math.sqrt(index);
    return { dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) };
};

// ── Physics constants ─────────────────────────────────────────────────
const REPULSION_K = 5e8;
const ATTRACTION_K = 0.0005;
const BOUNDARY = 25000;
const MAX_ITERATIONS = 200;
const INITIAL_TEMP = 1.0;
const COOLING = 0.97;
const DAMPING = 0.9;
const STAR_PULL_MAX = 80;

// ── Dot product for normalized vectors ────────────────────────────────
const dot = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
};

// ══════════════════════════════════════════════════════════════════════
// Step 1: Recompute all galaxy centroids
// ══════════════════════════════════════════════════════════════════════
export async function recomputeAllCentroids() {
    // Get all users who have public posts with embeddings
    const { data: users, error: usersErr } = await supabase
        .from('journals')
        .select('user_id')
        .eq('privacy', 'public')
        .not('embeddings', 'is', null);

    if (usersErr) throw new Error(`Failed to query users: ${usersErr.message}`);

    const uniqueUserIds = [...new Set((users || []).map(u => u.user_id))];
    console.log(`[galaxy-settle] Found ${uniqueUserIds.length} users with embeddings`);

    let upserted = 0;
    for (const userId of uniqueUserIds) {
        // Compute mean embedding via RPC or manual fetch
        const { data: posts, error: postsErr } = await supabase
            .from('journals')
            .select('embeddings')
            .eq('user_id', userId)
            .eq('privacy', 'public')
            .not('embeddings', 'is', null);

        if (postsErr || !posts || posts.length === 0) continue;

        // Compute mean embedding
        const dim = 384;
        const mean = new Array(dim).fill(0);
        for (const post of posts) {
            const emb = post.embeddings;
            if (!emb || emb.length !== dim) continue;
            for (let i = 0; i < dim; i++) mean[i] += emb[i];
        }
        for (let i = 0; i < dim; i++) mean[i] /= posts.length;

        // Normalize the mean embedding
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += mean[i] * mean[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < dim; i++) mean[i] /= norm;
        }

        // Format as pgvector string
        const vectorStr = `[${mean.join(',')}]`;

        const { error: upsertErr } = await supabase
            .from('galaxy_centroids')
            .upsert({
                user_id: userId,
                mean_embedding: vectorStr,
                post_count: posts.length,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (upsertErr) {
            console.error(`[galaxy-settle] Failed to upsert centroid for ${userId}:`, upsertErr.message);
        } else {
            upserted++;
        }
    }

    console.log(`[galaxy-settle] Upserted ${upserted} centroids`);
    return upserted;
}

// ══════════════════════════════════════════════════════════════════════
// Step 2: Recompute galaxy edges (similarity between centroids)
// ══════════════════════════════════════════════════════════════════════
export async function recomputeGalaxyEdges() {
    const { data: centroids, error } = await supabase
        .from('galaxy_centroids')
        .select('user_id, mean_embedding')
        .not('mean_embedding', 'is', null);

    if (error) throw new Error(`Failed to fetch centroids: ${error.message}`);
    if (!centroids || centroids.length < 2) {
        console.log('[galaxy-settle] Not enough centroids for edges');
        return 0;
    }

    const THRESHOLD = 0.25;
    const edges = [];

    for (let i = 0; i < centroids.length; i++) {
        for (let j = i + 1; j < centroids.length; j++) {
            const a = centroids[i];
            const b = centroids[j];

            // Parse embeddings (they come as arrays from Supabase)
            const embA = Array.isArray(a.mean_embedding) ? a.mean_embedding : null;
            const embB = Array.isArray(b.mean_embedding) ? b.mean_embedding : null;
            if (!embA || !embB) continue;

            const similarity = dot(embA, embB);
            if (similarity >= THRESHOLD) {
                // Ensure user_a < user_b
                const [userA, userB] = a.user_id < b.user_id
                    ? [a.user_id, b.user_id]
                    : [b.user_id, a.user_id];
                edges.push({ user_a: userA, user_b: userB, similarity });
            }
        }
    }

    // Clear old edges and insert new ones
    await supabase.from('galaxy_edges').delete().neq('similarity', -999);

    if (edges.length > 0) {
        // Batch insert in chunks of 500
        for (let i = 0; i < edges.length; i += 500) {
            const chunk = edges.slice(i, i + 500);
            const { error: insertErr } = await supabase
                .from('galaxy_edges')
                .upsert(chunk, { onConflict: 'user_a,user_b' });
            if (insertErr) {
                console.error('[galaxy-settle] Edge insert error:', insertErr.message);
            }
        }
    }

    console.log(`[galaxy-settle] Computed ${edges.length} galaxy edges`);
    return edges.length;
}

// ══════════════════════════════════════════════════════════════════════
// Step 3: Force-directed galaxy position settle
// ══════════════════════════════════════════════════════════════════════
export async function settleGalaxyPositions() {
    const { data: centroids, error: centErr } = await supabase
        .from('galaxy_centroids')
        .select('user_id, post_count');

    if (centErr) throw new Error(`Failed to fetch centroids: ${centErr.message}`);
    if (!centroids || centroids.length === 0) return;

    const { data: edges, error: edgeErr } = await supabase
        .from('galaxy_edges')
        .select('user_a, user_b, similarity');

    if (edgeErr) throw new Error(`Failed to fetch edges: ${edgeErr.message}`);

    // Initialize positions from hash-based coords
    const nodes = new Map();
    for (const c of centroids) {
        const home = userHomeCoords(c.user_id);
        nodes.set(c.user_id, {
            x: home.x,
            y: home.y,
            vx: 0,
            vy: 0,
            count: c.post_count || 1,
        });
    }

    const nodeIds = Array.from(nodes.keys());
    let temperature = INITIAL_TEMP;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        // Reset forces
        const forces = new Map();
        for (const id of nodeIds) forces.set(id, { fx: 0, fy: 0 });

        // Repulsion: all pairs
        for (let i = 0; i < nodeIds.length; i++) {
            for (let j = i + 1; j < nodeIds.length; j++) {
                const a = nodes.get(nodeIds[i]);
                const b = nodes.get(nodeIds[j]);
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq) || 1;

                const force = REPULSION_K * (a.count + b.count) / distSq;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                const fa = forces.get(nodeIds[i]);
                const fb = forces.get(nodeIds[j]);
                fa.fx -= fx;
                fa.fy -= fy;
                fb.fx += fx;
                fb.fy += fy;
            }
        }

        // Attraction: edge pairs (spring force)
        if (edges) {
            for (const edge of edges) {
                const a = nodes.get(edge.user_a);
                const b = nodes.get(edge.user_b);
                if (!a || !b) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const idealDist = 2000 * (1 - edge.similarity);
                const force = ATTRACTION_K * edge.similarity * (dist - idealDist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                const fa = forces.get(edge.user_a);
                const fb = forces.get(edge.user_b);
                fa.fx += fx;
                fa.fy += fy;
                fb.fx -= fx;
                fb.fy -= fy;
            }
        }

        // Apply forces with cooling and damping
        let maxDisp = 0;
        for (const id of nodeIds) {
            const node = nodes.get(id);
            const f = forces.get(id);

            node.vx = (node.vx + f.fx) * DAMPING;
            node.vy = (node.vy + f.fy) * DAMPING;

            const dispX = node.vx * temperature;
            const dispY = node.vy * temperature;

            node.x += dispX;
            node.y += dispY;

            // Soft boundary
            if (node.x > BOUNDARY) node.x = BOUNDARY - (node.x - BOUNDARY) * 0.5;
            if (node.x < -BOUNDARY) node.x = -BOUNDARY - (node.x + BOUNDARY) * 0.5;
            if (node.y > BOUNDARY) node.y = BOUNDARY - (node.y - BOUNDARY) * 0.5;
            if (node.y < -BOUNDARY) node.y = -BOUNDARY - (node.y + BOUNDARY) * 0.5;

            const disp = Math.sqrt(dispX * dispX + dispY * dispY);
            if (disp > maxDisp) maxDisp = disp;
        }

        temperature *= COOLING;

        if (maxDisp < 1.0) {
            console.log(`[galaxy-settle] Converged at iteration ${iter}`);
            break;
        }
    }

    // Write settled positions to galaxy_centroids
    for (const id of nodeIds) {
        const node = nodes.get(id);
        const { error: updateErr } = await supabase
            .from('galaxy_centroids')
            .update({
                galaxy_x: Math.round(node.x * 100) / 100,
                galaxy_y: Math.round(node.y * 100) / 100,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', id);

        if (updateErr) {
            console.error(`[galaxy-settle] Failed to update position for ${id}:`, updateErr.message);
        }
    }

    console.log(`[galaxy-settle] Settled ${nodeIds.length} galaxy positions`);
}

// ══════════════════════════════════════════════════════════════════════
// Step 4: Settle star (post) positions within galaxies
// ══════════════════════════════════════════════════════════════════════
export async function settleStarPositions() {
    const { data: centroids, error: centErr } = await supabase
        .from('galaxy_centroids')
        .select('user_id, galaxy_x, galaxy_y, mean_embedding')
        .not('galaxy_x', 'is', null);

    if (centErr) throw new Error(`Failed to fetch centroids: ${centErr.message}`);
    if (!centroids || centroids.length === 0) return;

    const centroidMap = new Map();
    for (const c of centroids) {
        centroidMap.set(c.user_id, c);
    }

    // Fetch edges for neighbor lookups
    const { data: edges } = await supabase
        .from('galaxy_edges')
        .select('user_a, user_b, similarity')
        .gte('similarity', 0.3);

    // Build neighbor map
    const neighbors = new Map();
    for (const e of (edges || [])) {
        if (!neighbors.has(e.user_a)) neighbors.set(e.user_a, []);
        if (!neighbors.has(e.user_b)) neighbors.set(e.user_b, []);
        neighbors.get(e.user_a).push({ userId: e.user_b, similarity: e.similarity });
        neighbors.get(e.user_b).push({ userId: e.user_a, similarity: e.similarity });
    }

    let totalUpdated = 0;

    for (const [userId, centroid] of centroidMap) {
        // Fetch this user's public posts with embeddings
        const { data: posts, error: postsErr } = await supabase
            .from('journals')
            .select('id, embeddings')
            .eq('user_id', userId)
            .eq('privacy', 'public')
            .not('embeddings', 'is', null)
            .order('created_at', { ascending: true });

        if (postsErr || !posts || posts.length === 0) continue;

        const galaxyNeighbors = neighbors.get(userId) || [];
        const neighborCentroids = galaxyNeighbors
            .map(n => centroidMap.get(n.userId))
            .filter(Boolean);

        for (let idx = 0; idx < posts.length; idx++) {
            const post = posts[idx];
            const offset = spiralLayout(idx);
            let baseX = centroid.galaxy_x + offset.dx;
            let baseY = centroid.galaxy_y + offset.dy;

            // Compute gravity pulls from neighboring galaxy centroids
            let pullX = 0;
            let pullY = 0;

            if (post.embeddings && Array.isArray(post.embeddings)) {
                for (const nc of neighborCentroids) {
                    if (!nc.mean_embedding || !Array.isArray(nc.mean_embedding)) continue;

                    const similarity = dot(post.embeddings, nc.mean_embedding);
                    if (similarity < 0.4) continue;

                    const strength = (similarity - 0.4) * STAR_PULL_MAX;
                    const dx = nc.galaxy_x - baseX;
                    const dy = nc.galaxy_y - baseY;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    pullX += (dx / dist) * strength;
                    pullY += (dy / dist) * strength;
                }
            }

            // Clamp total pull
            const pullMag = Math.sqrt(pullX * pullX + pullY * pullY);
            if (pullMag > STAR_PULL_MAX) {
                pullX = (pullX / pullMag) * STAR_PULL_MAX;
                pullY = (pullY / pullMag) * STAR_PULL_MAX;
            }

            const settledX = Math.round((baseX + pullX) * 100) / 100;
            const settledY = Math.round((baseY + pullY) * 100) / 100;

            const { error: updateErr } = await supabase
                .from('journals')
                .update({ settled_x: settledX, settled_y: settledY })
                .eq('id', post.id);

            if (!updateErr) totalUpdated++;
        }
    }

    console.log(`[galaxy-settle] Settled ${totalUpdated} star positions`);
}

// ══════════════════════════════════════════════════════════════════════
// Step 5: Incremental settle for a single user
// ══════════════════════════════════════════════════════════════════════
export async function incrementalSettleForUser(userId) {
    if (!userId) return;

    try {
        // 1. Recompute this user's centroid
        const { data: posts } = await supabase
            .from('journals')
            .select('embeddings')
            .eq('user_id', userId)
            .eq('privacy', 'public')
            .not('embeddings', 'is', null);

        if (!posts || posts.length === 0) return;

        const dim = 384;
        const mean = new Array(dim).fill(0);
        let validCount = 0;
        for (const post of posts) {
            const emb = post.embeddings;
            if (!emb || emb.length !== dim) continue;
            for (let i = 0; i < dim; i++) mean[i] += emb[i];
            validCount++;
        }
        if (validCount === 0) return;

        for (let i = 0; i < dim; i++) mean[i] /= validCount;

        // Normalize
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += mean[i] * mean[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < dim; i++) mean[i] /= norm;
        }

        const vectorStr = `[${mean.join(',')}]`;

        // Get or create initial position from hash
        const { data: existing } = await supabase
            .from('galaxy_centroids')
            .select('galaxy_x, galaxy_y')
            .eq('user_id', userId)
            .single();

        const home = userHomeCoords(userId);

        await supabase.from('galaxy_centroids').upsert({
            user_id: userId,
            mean_embedding: vectorStr,
            galaxy_x: existing?.galaxy_x ?? home.x,
            galaxy_y: existing?.galaxy_y ?? home.y,
            post_count: validCount,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

        // 2. Recompute edges for this user against all other centroids
        const { data: allCentroids } = await supabase
            .from('galaxy_centroids')
            .select('user_id, mean_embedding')
            .not('mean_embedding', 'is', null)
            .neq('user_id', userId);

        if (allCentroids && allCentroids.length > 0) {
            const newEdges = [];
            for (const other of allCentroids) {
                const embB = Array.isArray(other.mean_embedding) ? other.mean_embedding : null;
                if (!embB) continue;

                const similarity = dot(mean, embB);
                if (similarity >= 0.25) {
                    const [userA, userB] = userId < other.user_id
                        ? [userId, other.user_id]
                        : [other.user_id, userId];
                    newEdges.push({ user_a: userA, user_b: userB, similarity });
                }
            }

            // Delete old edges involving this user
            await supabase.from('galaxy_edges').delete().or(`user_a.eq.${userId},user_b.eq.${userId}`);

            if (newEdges.length > 0) {
                await supabase.from('galaxy_edges').upsert(newEdges, { onConflict: 'user_a,user_b' });
            }
        }

        // 3. Re-settle this user's star positions (use current galaxy position)
        const { data: centroid } = await supabase
            .from('galaxy_centroids')
            .select('galaxy_x, galaxy_y, mean_embedding')
            .eq('user_id', userId)
            .single();

        if (!centroid || centroid.galaxy_x == null) return;

        const { data: userPosts } = await supabase
            .from('journals')
            .select('id, embeddings')
            .eq('user_id', userId)
            .eq('privacy', 'public')
            .not('embeddings', 'is', null)
            .order('created_at', { ascending: true });

        if (!userPosts) return;

        // Get neighbor centroids
        const { data: edges } = await supabase
            .from('galaxy_edges')
            .select('user_a, user_b, similarity')
            .or(`user_a.eq.${userId},user_b.eq.${userId}`)
            .gte('similarity', 0.3);

        const neighborIds = (edges || []).map(e =>
            e.user_a === userId ? e.user_b : e.user_a
        );

        let neighborCentroids = [];
        if (neighborIds.length > 0) {
            const { data: ncs } = await supabase
                .from('galaxy_centroids')
                .select('user_id, galaxy_x, galaxy_y, mean_embedding')
                .in('user_id', neighborIds)
                .not('galaxy_x', 'is', null);
            neighborCentroids = ncs || [];
        }

        for (let idx = 0; idx < userPosts.length; idx++) {
            const post = userPosts[idx];
            const offset = spiralLayout(idx);
            let baseX = centroid.galaxy_x + offset.dx;
            let baseY = centroid.galaxy_y + offset.dy;

            let pullX = 0;
            let pullY = 0;

            if (post.embeddings && Array.isArray(post.embeddings)) {
                for (const nc of neighborCentroids) {
                    if (!nc.mean_embedding || !Array.isArray(nc.mean_embedding)) continue;
                    const sim = dot(post.embeddings, nc.mean_embedding);
                    if (sim < 0.4) continue;

                    const strength = (sim - 0.4) * STAR_PULL_MAX;
                    const dx = nc.galaxy_x - baseX;
                    const dy = nc.galaxy_y - baseY;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    pullX += (dx / dist) * strength;
                    pullY += (dy / dist) * strength;
                }
            }

            const pullMag = Math.sqrt(pullX * pullX + pullY * pullY);
            if (pullMag > STAR_PULL_MAX) {
                pullX = (pullX / pullMag) * STAR_PULL_MAX;
                pullY = (pullY / pullMag) * STAR_PULL_MAX;
            }

            await supabase
                .from('journals')
                .update({
                    settled_x: Math.round((baseX + pullX) * 100) / 100,
                    settled_y: Math.round((baseY + pullY) * 100) / 100
                })
                .eq('id', post.id);
        }

        console.log(`[galaxy-settle] Incremental settle complete for user ${userId}`);
    } catch (err) {
        console.error('[galaxy-settle] Incremental settle error:', err?.message || err);
    }
}

// ══════════════════════════════════════════════════════════════════════
// Full settle orchestrator
// ══════════════════════════════════════════════════════════════════════
export async function runFullSettle() {
    console.log('[galaxy-settle] Starting full settle...');
    const start = Date.now();

    await recomputeAllCentroids();
    await recomputeGalaxyEdges();
    await settleGalaxyPositions();
    await settleStarPositions();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[galaxy-settle] Full settle complete in ${elapsed}s`);
}
