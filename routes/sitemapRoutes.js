import express from 'express';
import supabase from '../services/supabase.js';
import { SITE_URL, makePostUrl } from '../utils/urlUtils.js';

const sitemapRouter = express.Router();

const CACHE_MAX_AGE_SECONDS = 3600; // 1 hour
const SITEMAP_PAGE_SIZE = 10000; // 10K URLs per sitemap file (protocol max is 50K)

const escXml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// ── GET /api/sitemap-posts-:page.xml ── (paginated)
sitemapRouter.get('/sitemap-posts-:page.xml', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.params.page, 10) || 1);
        const from = (page - 1) * SITEMAP_PAGE_SIZE;
        const to = from + SITEMAP_PAGE_SIZE - 1;

        const { data: posts, error } = await supabase
            .from('journals')
            .select('id, title, created_at')
            .eq('privacy', 'public')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            console.error('sitemap-posts query error:', error.message);
            return res.status(500).send('internal error');
        }

        if (!posts || posts.length === 0) {
            return res.status(404).send('not found');
        }

        const urls = posts.map((post) => {
            const loc = escXml(makePostUrl(post.id, post.title || ''));
            const lastmod = post.created_at
                ? new Date(post.created_at).toISOString().split('T')[0]
                : '';
            return `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
        });

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
        return res.send(xml);
    } catch (err) {
        console.error('sitemap-posts error:', err?.message || err);
        return res.status(500).send('internal error');
    }
});

// ── GET /api/sitemap-profiles-:page.xml ── (paginated)
sitemapRouter.get('/sitemap-profiles-:page.xml', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.params.page, 10) || 1);
        const from = (page - 1) * SITEMAP_PAGE_SIZE;
        const to = from + SITEMAP_PAGE_SIZE - 1;

        const { data: users, error } = await supabase
            .from('users')
            .select('id, username')
            .not('username', 'is', null)
            .range(from, to);

        if (error) {
            console.error('sitemap-profiles query error:', error.message);
            return res.status(500).send('internal error');
        }

        if (!users || users.length === 0) {
            return res.status(404).send('not found');
        }

        const urls = users.map((user) => {
            const loc = escXml(`${SITE_URL}/u/${user.username}`);
            return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
        });

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
        return res.send(xml);
    } catch (err) {
        console.error('sitemap-profiles error:', err?.message || err);
        return res.status(500).send('internal error');
    }
});

// ── GET /api/sitemap-index.xml ── (dynamic — counts rows to generate page list)
sitemapRouter.get('/sitemap-index.xml', async (_req, res) => {
    try {
        const [postsCount, profilesCount] = await Promise.all([
            supabase.from('journals').select('id', { count: 'exact', head: true }).eq('privacy', 'public'),
            supabase.from('users').select('id', { count: 'exact', head: true }).not('username', 'is', null),
        ]);

        const totalPosts = postsCount.count || 0;
        const totalProfiles = profilesCount.count || 0;

        const postPages = Math.max(1, Math.ceil(totalPosts / SITEMAP_PAGE_SIZE));
        const profilePages = Math.max(1, Math.ceil(totalProfiles / SITEMAP_PAGE_SIZE));

        let sitemaps = `  <sitemap>\n    <loc>${escXml(`${SITE_URL}/sitemap.xml`)}</loc>\n  </sitemap>\n`;

        for (let i = 1; i <= postPages; i++) {
            sitemaps += `  <sitemap>\n    <loc>${escXml(`${SITE_URL}/api/sitemap-posts-${i}.xml`)}</loc>\n  </sitemap>\n`;
        }
        for (let i = 1; i <= profilePages; i++) {
            sitemaps += `  <sitemap>\n    <loc>${escXml(`${SITE_URL}/api/sitemap-profiles-${i}.xml`)}</loc>\n  </sitemap>\n`;
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps}</sitemapindex>`;

        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
        return res.send(xml);
    } catch (err) {
        console.error('sitemap-index error:', err?.message || err);
        return res.status(500).send('internal error');
    }
});

export default sitemapRouter;
