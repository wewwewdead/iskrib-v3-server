import express from "express";
import cors from 'cors';
import compression from "compression";
import helmet from "helmet";
import router from "./routes/routes.js";
import supabase from "./services/supabase.js";

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
    origin: ['https://iskrib.com', 'https://iskrib-v3-client-side.onrender.com', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 60 * 60 * 24
};

app.use(cors(corsOptions));
app.use(compression({ threshold: 1024 }));
app.disable("x-powered-by");
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    })
);

app.use((req, res, next) => {
    if (req.method === "GET" && !req.headers.authorization) {
        // no-cache: browser must revalidate with server before using cached response.
        // This prevents stale data after mutations (likes, comments, replies, etc.)
        // while still allowing conditional requests (304 Not Modified) for performance.
        // React Query handles client-side caching, so browser cache is unnecessary.
        res.set("Cache-Control", "no-cache");
    }
    next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({extended: true, limit: "2mb", parameterLimit: 1000}));

// ── Share route: serves OG meta tags for social media previews ──
app.get('/share/post/:journalId', async (req, res) => {
    const { journalId } = req.params;
    const SITE_URL = 'https://iskrib.com';

    const makePostUrl = (title) => {
        const slug = title
            ? title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
            : '';
        return `${SITE_URL}/home/post/${journalId}${slug ? '/' + slug : ''}`;
    };

    try {
        const { data: journal, error } = await supabase
            .from('journals')
            .select('id, title, content, post_type, canvas_doc, created_at, users(name, image_url)')
            .eq('id', journalId)
            .single();

        if (error || !journal) {
            return res.redirect(302, makePostUrl(''));
        }

        // Extract plain text and first image from content
        let description = '';
        let ogImage = null;

        // Extract from Lexical JSON (text posts)
        const extractFromLexical = (contentJson) => {
            try {
                const parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
                const texts = [];
                let firstImage = null;

                const walk = (node) => {
                    if (!node) return;
                    if (node.type === 'text' && node.text) {
                        texts.push(node.text);
                    }
                    if (node.type === 'image' && node.src && !firstImage) {
                        firstImage = node.src;
                    }
                    if (Array.isArray(node.children)) {
                        node.children.forEach(walk);
                    }
                };

                if (parsed?.root) {
                    walk(parsed.root);
                }

                return {
                    text: texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160),
                    image: firstImage
                };
            } catch {
                return { text: '', image: null };
            }
        };

        // Extract first image from canvas_doc (canvas posts)
        const extractCanvasImage = (canvasDocRaw) => {
            try {
                const doc = typeof canvasDocRaw === 'string' ? JSON.parse(canvasDocRaw) : canvasDocRaw;
                if (Array.isArray(doc?.images)) {
                    const first = doc.images.find((img) => img && typeof img.src === 'string' && img.src);
                    if (first) return first.src;
                }
                return null;
            } catch {
                return null;
            }
        };

        if (journal.content) {
            const extracted = extractFromLexical(journal.content);
            description = extracted.text;
            if (extracted.image) {
                ogImage = extracted.image;
            }
        }

        // For canvas posts, also check canvas_doc for images
        if (!ogImage && journal.canvas_doc) {
            ogImage = extractCanvasImage(journal.canvas_doc);
        }

        // Fallback: use the author's avatar, then the site default PNG
        if (!ogImage) {
            ogImage = journal.users?.image_url || `${SITE_URL}/assets/no-image.png`;
        }

        const title = journal.title || 'Untitled Post';
        const authorName = journal.users?.name || 'Someone';
        if (!description) {
            description = `Read "${title}" by ${authorName} on Iskryb`;
        }

        const clientPostUrl = makePostUrl(journal.title);

        const escHtml = (str) => String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(title)} | Iskryb</title>
<meta name="description" content="${escHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:image" content="${escHtml(ogImage)}">
<meta property="og:url" content="${escHtml(clientPostUrl)}">
<meta property="og:site_name" content="Iskryb">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(ogImage)}">
<meta http-equiv="refresh" content="0; url=${escHtml(clientPostUrl)}">
</head>
<body>
<p>${escHtml(title)} — Redirecting to Iskryb...</p>
<a href="${escHtml(clientPostUrl)}">Click here if not redirected</a>
</body>
</html>`;

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('share route error:', err?.message || err);
        res.redirect(302, makePostUrl(''));
    }
});

// Also handle /api/share/post/:journalId so getShareUrl works in both configurations
app.get('/api/share/post/:journalId', (req, res) => {
    res.redirect(301, `/share/post/${req.params.journalId}`);
});

app.use('/api', router);
// Keep legacy root routes available while clients migrate to /api.
app.use(router)

app.get('/', (req, res) => {
    res.send(`hello from backend port ${PORT}`)
})

app.use((req, res) => {
    res.status(404).json({ error: "not found" });
});

app.use((err, _req, res, _next) => {
    console.error("unhandled server error:", err?.message || err);
    res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () =>{
    console.log(`server is running at port${PORT}`)
})
