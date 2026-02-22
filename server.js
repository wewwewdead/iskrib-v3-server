import express from "express";
import cors from 'cors';
import compression from "compression";
import helmet from "helmet";
import net from "node:net";
import sharp from "sharp";
import router from "./routes/routes.js";
import sitemapRouter from "./routes/sitemapRoutes.js";
import supabase from "./services/supabase.js";
import { SITE_URL as SITE_URL_SHARED, makePostUrl as makePostUrlShared } from "./utils/urlUtils.js";

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = SITE_URL_SHARED;
const DEFAULT_OG_IMAGE_URL = `${SITE_URL}/assets/no-image.png`;
const DEFAULT_OG_IMAGE_WIDTH = 1200;
const DEFAULT_OG_IMAGE_HEIGHT = 630;
const SOCIAL_PREVIEW_MAX_CHARS = 160;
const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 7000;
const REMOTE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const SHARE_IMAGE_FETCH_USER_AGENT = 'IskrybShareBot/1.0 (+https://iskrib.com)';
const META_FB_APP_ID = (process.env.META_FB_APP_ID || process.env.FB_APP_ID || process.env.VITE_FB_APP_ID || '').trim();
const SHARE_IMAGE_DEBUG = false;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();

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

const makePostUrl = makePostUrlShared;

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

const pickFirstNonEmptyString = (...values) => {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) return trimmed;
        }
    }
    return '';
};

const parseImageDimension = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
};

const imageFromNodeLike = (nodeLike) => {
    if (!nodeLike || typeof nodeLike !== 'object') return null;

    const src = pickFirstNonEmptyString(
        nodeLike.src,
        nodeLike.url,
        nodeLike.image_url,
        nodeLike.imageUrl,
        nodeLike?.payload?.src,
        nodeLike?.data?.src
    );
    if (!src) return null;

    return {
        src,
        width: parseImageDimension(nodeLike.width),
        height: parseImageDimension(nodeLike.height),
    };
};

const extractFromLexical = (contentJson) => {
    try {
        const parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
        const texts = [];
        let firstImage = null;

        const walk = (node) => {
            if (!node || typeof node !== 'object') return;

            const nodeType = String(node.type || node.__type || '').trim().toLowerCase();
            if (nodeType === 'text' && typeof node.text === 'string') {
                texts.push(node.text);
            }

            const isImageNode = nodeType === 'image' || nodeType.endsWith('image') || nodeType.includes('image');
            if (!firstImage && isImageNode) {
                const image = imageFromNodeLike(node);
                if (image) {
                    firstImage = image;
                }
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
            const first = doc.images.find((img) => imageFromNodeLike(img));
            if (first) image = imageFromNodeLike(first);
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

    let imageCandidate = DEFAULT_OG_IMAGE_URL;
    let imageCandidateSource = 'fallback';
    if (lexicalData.image?.src) {
        imageCandidate = lexicalData.image.src;
        imageCandidateSource = 'lexical';
    } else if (canvasData.image?.src) {
        imageCandidate = canvasData.image.src;
        imageCandidateSource = 'canvas';
    } else if (journal?.users?.image_url) {
        imageCandidate = journal.users.image_url;
        imageCandidateSource = 'author_avatar';
    }

    return {
        title,
        normalizedTitle,
        description: toPreviewText(description),
        imageCandidate,
        imageCandidateSource
    };
};

const resolveAbsoluteHttpUrl = (rawUrl) => {
    try {
        const raw = String(rawUrl || '').trim();
        if (!raw) return null;

        const isSupabasePath =
            raw.startsWith('/storage/v1/object/public/')
            || raw.startsWith('storage/v1/object/public/');

        const baseUrl = isSupabasePath && SUPABASE_URL
            ? `${SUPABASE_URL}/`
            : SITE_URL;

        const parsed = new URL(raw, baseUrl);
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

const evaluateShareImageCandidate = (rawUrl) => {
    const absoluteUrl = resolveAbsoluteHttpUrl(rawUrl);
    if (!absoluteUrl) {
        return {
            ok: false,
            reason: 'invalid_or_non_http_url',
            resolvedUrl: null,
        };
    }

    let path = '';
    try {
        const parsed = new URL(absoluteUrl);
        path = String(parsed.pathname || '').toLowerCase();
    } catch {
        return {
            ok: false,
            reason: 'invalid_resolved_url',
            resolvedUrl: null,
        };
    }

    if (path.endsWith('.svg')) {
        return {
            ok: false,
            reason: 'svg_not_supported_for_share_image',
            resolvedUrl: absoluteUrl,
        };
    }

    if (!isSafeRemoteImageUrl(absoluteUrl)) {
        return {
            ok: false,
            reason: 'unsafe_remote_url',
            resolvedUrl: absoluteUrl,
        };
    }

    return {
        ok: true,
        reason: 'ok',
        resolvedUrl: absoluteUrl,
    };
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
                'Accept-Encoding': 'identity',
                'User-Agent': SHARE_IMAGE_FETCH_USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`upstream image status ${response.status}`);
        }

        const finalUrl = response.url || imageUrl;
        if (!isSafeRemoteImageUrl(finalUrl)) {
            throw new Error('upstream redirected to unsafe url');
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            throw new Error(`upstream content-type ${contentType || 'unknown'} is not an image`);
        }
        if (contentType.includes('image/svg')) {
            throw new Error('svg images are not used for share previews');
        }

        const headerContentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(headerContentLength) && headerContentLength > REMOTE_IMAGE_MAX_BYTES) {
            throw new Error(`upstream content-length exceeds ${REMOTE_IMAGE_MAX_BYTES} bytes`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (!buffer.length) {
            throw new Error('upstream image is empty');
        }
        if (buffer.length > REMOTE_IMAGE_MAX_BYTES) {
            throw new Error(`upstream image exceeds ${REMOTE_IMAGE_MAX_BYTES} bytes`);
        }

        return {
            buffer,
            contentType,
            byteLength: buffer.length,
            finalUrl,
        };
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

const isShareImageDebugRequest = (req) => {
    const debugFlag = String(req?.query?.debug || '').trim().toLowerCase();
    return SHARE_IMAGE_DEBUG && (debugFlag === '1' || debugFlag === 'true');
};

const sendShareImageDebug = (res, payload) => {
    return res.status(200).json(payload);
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
    const debugMode = isShareImageDebugRequest(req);
    const debugPayload = {
        ok: false,
        fallback: false,
        journalId,
        stage: 'start',
        reason: '',
        meta: {
            imageCandidateSource: null,
            imageCandidateRaw: null,
            imageCandidateResolved: null,
            upstreamFinalUrl: null,
            upstreamContentType: null,
            upstreamBytes: null,
            outputBytes: null,
        },
    };

    const fallbackWithReason = (reason) => {
        debugPayload.ok = false;
        debugPayload.fallback = true;
        debugPayload.stage = 'fallback';
        debugPayload.reason = reason;
        if (debugMode) {
            return sendShareImageDebug(res, debugPayload);
        }
        return res.redirect(302, DEFAULT_OG_IMAGE_URL);
    };

    try {
        const journal = await getShareJournal(journalId);
        debugPayload.stage = 'journal_loaded';
        if (!journal) {
            return fallbackWithReason('journal_not_found');
        }

        const shareMeta = buildShareMetaFromJournal(journal);
        debugPayload.stage = 'candidate_extracted';
        debugPayload.meta.imageCandidateSource = shareMeta.imageCandidateSource;
        debugPayload.meta.imageCandidateRaw = shareMeta.imageCandidate;

        const candidateEvaluation = evaluateShareImageCandidate(shareMeta.imageCandidate);
        debugPayload.meta.imageCandidateResolved = candidateEvaluation.resolvedUrl;
        if (!candidateEvaluation.ok || !candidateEvaluation.resolvedUrl) {
            return fallbackWithReason(candidateEvaluation.reason);
        }

        const normalizedFallbackUrl = new URL(DEFAULT_OG_IMAGE_URL).toString();
        if (candidateEvaluation.resolvedUrl === normalizedFallbackUrl) {
            return fallbackWithReason('candidate_is_default_fallback');
        }

        debugPayload.stage = 'fetching_upstream';
        const remoteImage = await fetchRemoteImageBuffer(candidateEvaluation.resolvedUrl);
        debugPayload.stage = 'upstream_loaded';
        debugPayload.meta.upstreamFinalUrl = remoteImage.finalUrl;
        debugPayload.meta.upstreamContentType = remoteImage.contentType;
        debugPayload.meta.upstreamBytes = remoteImage.byteLength;

        debugPayload.stage = 'converting_image';
        const ogImageBuffer = await convertToOgJpeg(remoteImage.buffer);
        debugPayload.stage = 'converted_image';
        debugPayload.ok = true;
        debugPayload.reason = 'ok';
        debugPayload.meta.outputBytes = ogImageBuffer.length;

        if (debugMode) {
            return sendShareImageDebug(res, debugPayload);
        }

        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(ogImageBuffer);
    } catch (err) {
        debugPayload.stage = 'error';
        debugPayload.reason = err?.message || 'unknown_error';
        console.error('share image route error:', err?.message || err);
        return fallbackWithReason(debugPayload.reason);
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
${fbAppIdTag}
<link rel="canonical" href="${escHtml(clientPostUrl)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escHtml(shareMeta.title)}">
<meta property="og:description" content="${escHtml(shareMeta.description)}">
<meta property="og:image" content="${escHtml(shareImageUrl)}">
<meta property="og:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta property="og:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<meta property="og:url" content="${escHtml(clientPostUrl)}">
<meta property="og:site_name" content="Iskryb">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(shareMeta.title)}">
<meta name="twitter:description" content="${escHtml(shareMeta.description)}">
<meta name="twitter:image" content="${escHtml(shareImageUrl)}">
<meta name="twitter:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta name="twitter:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<script>
window.location.replace(${JSON.stringify(clientPostUrl)});
</script>
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

app.use('/api', sitemapRouter);
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
