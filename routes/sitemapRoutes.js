import express from 'express';
import supabase from '../services/supabase.js';
import { SITE_URL, makePostUrl } from '../utils/urlUtils.js';

const sitemapRouter = express.Router();

const CACHE_MAX_AGE_SECONDS = 3600; // 1 hour
const API_BASE_URL = 'https://iskrib-v3-server-production.up.railway.app';

const escXml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// ── GET /api/sitemap-posts.xml ──
sitemapRouter.get('/sitemap-posts.xml', async (_req, res) => {
    try {
        const { data: posts, error } = await supabase
            .from('journals')
            .select('id, title, created_at')
            .eq('privacy', 'public')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('sitemap-posts query error:', error.message);
            return res.status(500).send('internal error');
        }

        const urls = (posts || []).map((post) => {
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

// ── GET /api/sitemap-profiles.xml ──
sitemapRouter.get('/sitemap-profiles.xml', async (_req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('id, username')
            .not('username', 'is', null);

        if (error) {
            console.error('sitemap-profiles query error:', error.message);
            return res.status(500).send('internal error');
        }

        const urls = (users || []).map((user) => {
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

// ── GET /api/sitemap-index.xml ──
sitemapRouter.get('/sitemap-index.xml', (_req, res) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${escXml(`${SITE_URL}/sitemap.xml`)}</loc>
  </sitemap>
  <sitemap>
    <loc>${escXml(`${API_BASE_URL}/api/sitemap-posts.xml`)}</loc>
  </sitemap>
  <sitemap>
    <loc>${escXml(`${API_BASE_URL}/api/sitemap-profiles.xml`)}</loc>
  </sitemap>
</sitemapindex>`;

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
    return res.send(xml);
});

export default sitemapRouter;
