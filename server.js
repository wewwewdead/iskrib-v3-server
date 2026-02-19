import express from "express";
import cors from 'cors';
import compression from "compression";
import helmet from "helmet";
import net from "node:net";
import sharp from "sharp";
import router from "./routes/routes.js";
import supabase from "./services/supabase.js";

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = 'https://iskrib.com';
const DEFAULT_OG_IMAGE_URL = `${SITE_URL}/assets/no-image.png`;
const DEFAULT_OG_IMAGE_WIDTH = 1200;
const DEFAULT_OG_IMAGE_HEIGHT = 630;
const SOCIAL_PREVIEW_MAX_CHARS = 160;
const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 7000;
const REMOTE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const META_FB_APP_ID = (process.env.META_FB_APP_ID || process.env.FB_APP_ID || '').trim();

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

const escHtml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const makePostUrl = (journalId, title = '') => {
    const slug = title
        ? title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        : '';
    return `${SITE_URL}/home/post/${journalId}${slug ? '/' + slug : ''}`;
};

const getRequestOrigin = (req) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || req.get('host') || '';
    const requestProtocol = String(req.protocol || '').trim().toLowerCase();
    const protocol = forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : requestProtocol === 'http' || requestProtocol === 'https'
            ? requestProtocol
            : 'https';

    if (!host) {
        return SITE_URL;
    }

    return `${protocol}://${host}`;
};

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

const buildShareMetaFromJournal = (journal) => {
    const lexicalData = extractFromLexical(journal?.content);
    const canvasData = extractFromCanvasDoc(journal?.canvas_doc);
    const normalizedTitle = typeof journal?.title === 'string' ? normalizeWhitespace(journal.title) : '';
    const title = normalizedTitle || 'Untitled Post';
    const authorName = normalizeWhitespace(journal?.users?.name) || 'Someone';

    let description = lexicalData.text || '';
    if (!description && canvasData.text) {
        description = canvasData.text;
    }
    if (!description) {
        description = `Read "${title}" by ${authorName} on Iskryb`;
    }

    const imageCandidate =
        lexicalData.image?.src ||
        canvasData.image?.src ||
        journal?.users?.image_url ||
        DEFAULT_OG_IMAGE_URL;

    return {
        title,
        normalizedTitle,
        description: toPreviewText(description),
        imageCandidate
    };
};

const resolveAbsoluteHttpUrl = (rawUrl) => {
    try {
        const parsed = new URL(String(rawUrl || ''), SITE_URL);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
};

const isPrivateIpv4Address = (ip) => {
    const parts = ip.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return true;
    }

    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
};

const isPrivateIpv6Address = (ip) => {
    const normalized = ip.toLowerCase();
    return (
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')
    );
};

const isPrivateIpAddress = (ip) => {
    const ipVersion = net.isIP(ip);
    if (ipVersion === 4) return isPrivateIpv4Address(ip);
    if (ipVersion === 6) return isPrivateIpv6Address(ip);
    return true;
};

const isSafeRemoteImageUrl = (imageUrl) => {
    try {
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }

        const hostname = parsed.hostname.toLowerCase();
        if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
            return false;
        }

        if (net.isIP(hostname) && isPrivateIpAddress(hostname)) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
};

const resolveShareImageSourceUrl = (rawUrl) => {
    const absoluteUrl = resolveAbsoluteHttpUrl(rawUrl);
    if (!absoluteUrl) return null;

    try {
        const path = new URL(absoluteUrl).pathname.toLowerCase();
        if (path.endsWith('.svg')) {
            return null;
        }
    } catch {
        return null;
    }

    return absoluteUrl;
};

const fetchRemoteImageBuffer = async (imageUrl) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(imageUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                Accept: 'image/*,*/*;q=0.8',
            },
        });

        if (!response.ok) {
            throw new Error(`upstream image status ${response.status}`);
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            throw new Error(`upstream content-type ${contentType || 'unknown'} is not an image`);
        }
        if (contentType.includes('image/svg')) {
            throw new Error('svg images are not used for share previews');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (!buffer.length) {
            throw new Error('upstream image is empty');
        }
        if (buffer.length > REMOTE_IMAGE_MAX_BYTES) {
            throw new Error(`upstream image exceeds ${REMOTE_IMAGE_MAX_BYTES} bytes`);
        }

        return buffer;
    } finally {
        clearTimeout(timeout);
    }
};

const convertToOgJpeg = async (inputBuffer) => {
    return sharp(inputBuffer, { limitInputPixels: 60_000_000 })
        .rotate()
        .resize(DEFAULT_OG_IMAGE_WIDTH, DEFAULT_OG_IMAGE_HEIGHT, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
};

const getShareJournal = async (journalId) => {
    const { data: journal, error } = await supabase
        .from('journals')
        .select('id, title, content, post_type, canvas_doc, created_at, users(name, image_url)')
        .eq('id', journalId)
        .single();

    if (error || !journal) {
        return null;
    }

    return journal;
};

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
app.get('/share/post/:journalId/image', async (req, res) => {
    const { journalId } = req.params;

    try {
        const journal = await getShareJournal(journalId);
        if (!journal) {
            return res.redirect(302, DEFAULT_OG_IMAGE_URL);
        }

        const shareMeta = buildShareMetaFromJournal(journal);
        const candidateUrl = resolveShareImageSourceUrl(shareMeta.imageCandidate);
        if (!candidateUrl || !isSafeRemoteImageUrl(candidateUrl)) {
            return res.redirect(302, DEFAULT_OG_IMAGE_URL);
        }

        const normalizedFallbackUrl = new URL(DEFAULT_OG_IMAGE_URL).toString();
        if (candidateUrl === normalizedFallbackUrl) {
            return res.redirect(302, DEFAULT_OG_IMAGE_URL);
        }

        const remoteImageBuffer = await fetchRemoteImageBuffer(candidateUrl);
        const ogImageBuffer = await convertToOgJpeg(remoteImageBuffer);

        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(ogImageBuffer);
    } catch (err) {
        console.error('share image route error:', err?.message || err);
        return res.redirect(302, DEFAULT_OG_IMAGE_URL);
    }
});

app.get('/share/post/:journalId', async (req, res) => {
    const { journalId } = req.params;
    const shareOrigin = getRequestOrigin(req);
    const buildRedirectUrl = (title = '') => makePostUrl(journalId, title);

    try {
        const journal = await getShareJournal(journalId);
        if (!journal) {
            return res.redirect(302, buildRedirectUrl(''));
        }

        const shareMeta = buildShareMetaFromJournal(journal);
        const clientPostUrl = buildRedirectUrl(shareMeta.normalizedTitle);
        const shareImageUrl = new URL(`/share/post/${journalId}/image`, `${shareOrigin}/`).toString();
        const fbAppIdTag = META_FB_APP_ID
            ? `<meta property="fb:app_id" content="${escHtml(META_FB_APP_ID)}">`
            : '';

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(shareMeta.title)} | Iskryb</title>
<meta name="description" content="${escHtml(shareMeta.description)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escHtml(shareMeta.title)}">
<meta property="og:description" content="${escHtml(shareMeta.description)}">
<meta property="og:image" content="${escHtml(shareImageUrl)}">
<meta property="og:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta property="og:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<meta property="og:url" content="${escHtml(clientPostUrl)}">
<meta property="og:site_name" content="Iskryb">
${fbAppIdTag}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(shareMeta.title)}">
<meta name="twitter:description" content="${escHtml(shareMeta.description)}">
<meta name="twitter:image" content="${escHtml(shareImageUrl)}">
<meta name="twitter:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta name="twitter:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<meta http-equiv="refresh" content="0; url=${escHtml(clientPostUrl)}">
</head>
<body>
<p>${escHtml(shareMeta.title)} - Redirecting to Iskryb...</p>
<a href="${escHtml(clientPostUrl)}">Click here if not redirected</a>
</body>
</html>`;

        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (err) {
        console.error('share route error:', err?.message || err);
        return res.redirect(302, buildRedirectUrl(''));
    }
});

// Also handle /api/share/post/:journalId so getShareUrl works in both configurations
app.get('/api/share/post/:journalId/image', (req, res) => {
    res.redirect(301, `/share/post/${req.params.journalId}/image`);
});

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
