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
    const DEFAULT_OG_IMAGE_WIDTH = 1200;
    const DEFAULT_OG_IMAGE_HEIGHT = 630;
    const SOCIAL_PREVIEW_MAX_CHARS = 160;

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
        let ogImageWidth = DEFAULT_OG_IMAGE_WIDTH;
        let ogImageHeight = DEFAULT_OG_IMAGE_HEIGHT;

        const normalizeWhitespace = (value) => String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim();

        const toPreviewText = (value, maxLength = SOCIAL_PREVIEW_MAX_CHARS) => {
            const normalized = normalizeWhitespace(value);
            if (!normalized) return '';
            if (normalized.length <= maxLength) return normalized;
            if (maxLength <= 3) return normalized.slice(0, maxLength);
            return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
        };

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
                        firstImage = {
                            src: node.src,
                            width: Number(node.width),
                            height: Number(node.height),
                        };
                    }
                    if (Array.isArray(node.children)) {
                        node.children.forEach(walk);
                    }
                };

                if (parsed?.root) {
                    walk(parsed.root);
                }

                return {
                    text: normalizeWhitespace(texts.join(' ')),
                    image: firstImage
                };
            } catch {
                return { text: '', image: null };
            }
        };

        // Extract text + first image from canvas_doc (canvas posts)
        const extractFromCanvasDoc = (canvasDocRaw) => {
            try {
                const doc = typeof canvasDocRaw === 'string' ? JSON.parse(canvasDocRaw) : canvasDocRaw;
                const text = Array.isArray(doc?.snippets)
                    ? normalizeWhitespace(
                        doc.snippets
                            .map((snippet) => (typeof snippet?.text === 'string' ? snippet.text : ''))
                            .join(' ')
                    )
                    : '';

                let image = null;
                if (Array.isArray(doc?.images)) {
                    const first = doc.images.find((img) => img && typeof img.src === 'string' && img.src);
                    if (first) image = first;
                }

                return { text, image };
            } catch {
                return { text: '', image: null };
            }
        };

        const applyImageDimensions = (imageLike) => {
            if (!imageLike || typeof imageLike !== 'object') return;
            const parsedWidth = Number(imageLike.width);
            const parsedHeight = Number(imageLike.height);
            const roundedWidth = Math.round(parsedWidth);
            const roundedHeight = Math.round(parsedHeight);

            // Canvas docs may store normalized dimensions (0-1), so only use realistic pixel values.
            if (Number.isFinite(parsedWidth) && roundedWidth >= 16) {
                ogImageWidth = roundedWidth;
            }
            if (Number.isFinite(parsedHeight) && roundedHeight >= 16) {
                ogImageHeight = roundedHeight;
            }
        };

        if (journal.content) {
            const extracted = extractFromLexical(journal.content);
            description = extracted.text;
            if (extracted.image) {
                ogImage = extracted.image.src;
                applyImageDimensions(extracted.image);
            }
        }

        // For canvas posts, use snippet text and canvas images when present.
        if (journal.canvas_doc) {
            const canvasData = extractFromCanvasDoc(journal.canvas_doc);
            if (!description && canvasData.text) {
                description = canvasData.text;
            }
            if (!ogImage && canvasData.image) {
                ogImage = canvasData.image.src;
                applyImageDimensions(canvasData.image);
            }
        }

        // Fallback: use the author's avatar, then the site default PNG
        if (!ogImage) {
            ogImage = journal.users?.image_url || `${SITE_URL}/assets/no-image.png`;
        }

        try {
            ogImage = new URL(ogImage, SITE_URL).toString();
        } catch {
            ogImage = `${SITE_URL}/assets/no-image.png`;
            ogImageWidth = DEFAULT_OG_IMAGE_WIDTH;
            ogImageHeight = DEFAULT_OG_IMAGE_HEIGHT;
        }

        const normalizedTitle = typeof journal.title === 'string' ? normalizeWhitespace(journal.title) : '';
        const title = normalizedTitle || 'Untitled Post';
        const authorName = journal.users?.name || 'Someone';
        if (!description) {
            description = `Read "${title}" by ${authorName} on Iskryb`;
        }
        description = toPreviewText(description);

        const clientPostUrl = makePostUrl(normalizedTitle);

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
<meta property="og:image:width" content="${String(ogImageWidth)}">
<meta property="og:image:height" content="${String(ogImageHeight)}">
<meta property="og:url" content="${escHtml(clientPostUrl)}">
<meta property="og:site_name" content="Iskryb">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(ogImage)}">
<meta name="twitter:image:width" content="${String(ogImageWidth)}">
<meta name="twitter:image:height" content="${String(ogImageHeight)}">
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
