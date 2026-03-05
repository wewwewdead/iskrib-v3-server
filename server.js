import cluster from "node:cluster";
import os from "node:os";
import express from "express";
import cors from 'cors';
import compression from "compression";
import helmet from "helmet";
import net from "node:net";
import sharp from "sharp";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import router from "./routes/routes.js";
import sitemapRouter from "./routes/sitemapRoutes.js";
import { generalLimiter } from "./middleware/rateLimiter.js";
import supabase from "./services/supabase.js";
import { SITE_URL as SITE_URL_SHARED, makePostUrl as makePostUrlShared } from "./utils/urlUtils.js";
import { getUserByUsernameService } from "./services/getUserDataService.js";
import { bootstrapTopicEmbeddings } from "./services/interestEmbeddingService.js";
import { createLRUCache } from "./utils/LRUCache.js";

// ── Cluster mode: fork one worker per CPU core ──
// Set CLUSTER_ENABLED=true in production to use all CPU cores.
// Disabled by default so local dev / single-core hosts work without surprises.
const CLUSTER_ENABLED = process.env.CLUSTER_ENABLED === 'true';
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT, 10) || os.cpus().length;

if (CLUSTER_ENABLED && cluster.isPrimary) {
    console.log(`Primary ${process.pid} starting ${WORKER_COUNT} workers...`);
    for (let i = 0; i < WORKER_COUNT; i++) {
        cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
        console.warn(`Worker ${worker.process.pid} exited (code=${code}, signal=${signal}). Restarting...`);
        cluster.fork();
    });
    // Primary does nothing else — workers handle all requests
} else {
// ── Worker (or non-clustered) process: run Express ──

// ── Bundled font setup for Sharp/librsvg SVG text rendering ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FONT_DIR = join(__dirname, '.fonts');
const FONT_PATH = join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD_PATH = join(FONT_DIR, 'DejaVuSans-Bold.ttf');
let fontsReady = false;

async function ensureShareFonts() {
    if (fontsReady) return;
    try {
        if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });

        const downloads = [];
        if (!existsSync(FONT_PATH)) {
            downloads.push(
                fetch('https://cdn.jsdelivr.net/npm/@vintproykt/dejavu-fonts-ttf@2.37.0/ttf/DejaVuSans.ttf')
                    .then(r => { if (!r.ok) throw new Error(`Font fetch failed: ${r.status}`); return r.arrayBuffer(); })
                    .then(buf => writeFileSync(FONT_PATH, Buffer.from(buf)))
            );
        }
        if (!existsSync(FONT_BOLD_PATH)) {
            downloads.push(
                fetch('https://cdn.jsdelivr.net/npm/@vintproykt/dejavu-fonts-ttf@2.37.0/ttf/DejaVuSans-Bold.ttf')
                    .then(r => { if (!r.ok) throw new Error(`Bold font fetch failed: ${r.status}`); return r.arrayBuffer(); })
                    .then(buf => writeFileSync(FONT_BOLD_PATH, Buffer.from(buf)))
            );
        }
        if (downloads.length) await Promise.all(downloads);

        fontsReady = true;
        console.log('Share fonts ready:', FONT_DIR);
    } catch (err) {
        console.error('Failed to setup share fonts:', err?.message || err);
    }
}

const app = express();
app.set('trust proxy', 1);
app.set('etag', 'weak');
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

// ── In-memory LRU cache for generated share images ──
const shareImageCache = createLRUCache(200, 60 * 60 * 1000); // 200 entries, 1h TTL
const getShareImageCached = (key) => shareImageCache.get(key);
const setShareImageCached = (key, buf) => shareImageCache.set(key, buf);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const PUBLIC_CACHE_CONTROL_VALUE = 'public, max-age=10, s-maxage=10, stale-while-revalidate=30';
const PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store';
const METRICS_TOKEN = (process.env.METRICS_TOKEN || '').trim();
const METRICS_ROUTE_LIMIT = 200;
const CACHEABLE_PUBLIC_ROUTE_PATTERNS = [
    /^\/journals$/,
    /^\/journals\/hottest-monthly$/,

    /^\/journals\/search$/,
    /^\/users\/search$/,
    /^\/journal\/[^/]+$/,
    /^\/sitemap-posts-\d+\.xml$/,
    /^\/sitemap-profiles-\d+\.xml$/,
    /^\/sitemap-index\.xml$/,
];

const metricsState = {
    startedAt: new Date().toISOString(),
    requests: 0,
    responses: 0,
    inFlight: 0,
    bytesSent: 0,
    statusBuckets: {
        '2xx': 0,
        '3xx': 0,
        '4xx': 0,
        '5xx': 0,
        other: 0,
    },
    routeStats: new Map(),
};

const normalizeApiPath = (path = '') => (
    String(path).startsWith('/api/')
        ? String(path).slice(4)
        : String(path)
);

const canonicalizeMetricsPath = (rawPath = '') => {
    const normalized = normalizeApiPath(rawPath);
    return normalized
        .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/ig, '/:id')
        .replace(/\/\d+(?=\/|$)/g, '/:id');
};

const isPersonalizedGetRequest = (req) => {
    if (req?.headers?.authorization) {
        return true;
    }

    const userId = String(req?.query?.userId || '').trim();
    const loggedInUserId = String(req?.query?.loggedInUserId || '').trim();
    return Boolean(userId || loggedInUserId);
};

const isCacheablePublicPath = (reqPath = '') => (
    CACHEABLE_PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(reqPath))
);

const classifyStatusBucket = (statusCode) => {
    if (statusCode >= 200 && statusCode < 300) return '2xx';
    if (statusCode >= 300 && statusCode < 400) return '3xx';
    if (statusCode >= 400 && statusCode < 500) return '4xx';
    if (statusCode >= 500 && statusCode < 600) return '5xx';
    return 'other';
};

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

const buildShareMetaFromJournal = (journal) => {
    const lexicalData = extractFromLexical(journal?.content);
    const normalizedTitle = typeof journal?.title === 'string' ? normalizeWhitespace(journal.title) : '';
    const title = normalizedTitle || 'Untitled Post';
    const authorName = normalizeWhitespace(journal?.users?.name) || 'Someone';

    let description = lexicalData.text || '';
    if (!description) {
        description = `Read "${title}" by ${authorName} on Iskryb`;
    }

    let imageCandidate = DEFAULT_OG_IMAGE_URL;
    let imageCandidateSource = 'fallback';
    if (lexicalData.image?.src) {
        imageCandidate = lexicalData.image.src;
        imageCandidateSource = 'lexical';
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
        .select('id, title, content, post_type, created_at, users(name, image_url)')
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

const CORS_ORIGINS = (
    process.env.CORS_ORIGINS ||
    (process.env.NODE_ENV === 'production'
        ? 'https://iskrib.com,https://iskrib-v3-client-side.onrender.com'
        : 'https://iskrib.com,https://iskrib-v3-client-side.onrender.com,http://localhost:5173')
)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const corsOptions = {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
    metricsState.requests += 1;
    metricsState.inFlight += 1;

    const startNs = process.hrtime.bigint();
    let byteCount = 0;

    // Skip byte-counting overhead for cheap internal routes
    const skipByteCount = req.path === '/health' || req.path === '/api/health'
        || req.path === '/metrics' || req.path === '/api/metrics';

    if (!skipByteCount) {
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        res.write = (chunk, encoding, callback) => {
            if (chunk) {
                byteCount += Buffer.isBuffer(chunk)
                    ? chunk.length
                    : Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8');
            }
            return originalWrite(chunk, encoding, callback);
        };

        res.end = (chunk, encoding, callback) => {
            if (chunk) {
                byteCount += Buffer.isBuffer(chunk)
                    ? chunk.length
                    : Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8');
            }
            return originalEnd(chunk, encoding, callback);
        };
    }

    res.on('finish', () => {
        metricsState.inFlight = Math.max(0, metricsState.inFlight - 1);
        metricsState.responses += 1;
        metricsState.bytesSent += byteCount;

        const statusBucket = classifyStatusBucket(res.statusCode);
        metricsState.statusBuckets[statusBucket] += 1;

        const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        const routeTemplate = req.route?.path
            ? `${req.baseUrl || ''}${req.route.path}`
            : req.path;
        const routeKey = `${req.method} ${canonicalizeMetricsPath(routeTemplate)}`;

        let routeStat = metricsState.routeStats.get(routeKey);
        if (!routeStat) {
            if (metricsState.routeStats.size >= METRICS_ROUTE_LIMIT) {
                return;
            }

            routeStat = {
                count: 0,
                totalDurationMs: 0,
                maxDurationMs: 0,
                bytesSent: 0,
                statusBuckets: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 },
            };
            metricsState.routeStats.set(routeKey, routeStat);
        }

        routeStat.count += 1;
        routeStat.totalDurationMs += durationMs;
        routeStat.maxDurationMs = Math.max(routeStat.maxDurationMs, durationMs);
        routeStat.bytesSent += byteCount;
        routeStat.statusBuckets[statusBucket] += 1;
    });

    next();
});

app.use((req, res, next) => {
    if (req.method !== "GET") {
        return next();
    }

    const normalizedPath = normalizeApiPath(req.path);
    const isPersonalized = isPersonalizedGetRequest(req);

    if (!isPersonalized && isCacheablePublicPath(normalizedPath)) {
        res.set("Cache-Control", PUBLIC_CACHE_CONTROL_VALUE);
    } else if (isPersonalized) {
        res.set("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
    }

    return next();
});

app.use(generalLimiter);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({extended: true, limit: "2mb", parameterLimit: 1000}));

// ── Profile share route: composite OG image for social media ──
app.get('/share/u/:username/image', async (req, res) => {
    const { username } = req.params;

    // Serve from cache if available
    const cached = getShareImageCached(`profile:${username}`);
    if (cached) {
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(cached);
    }

    await ensureShareFonts();

    try {
        const result = await getUserByUsernameService(username);
        const user = result?.userData?.[0];
        if (!user) {
            return res.redirect(302, DEFAULT_OG_IMAGE_URL);
        }

        const displayName = normalizeWhitespace(user.name) || username;
        const handle = `@${normalizeWhitespace(user.username || username)}`;
        const bio = toPreviewText(user.bio || '', 120);

        // ── Fetch background image ──
        let bgBuffer = null;
        const bgStyle = user.background || {};
        const bgImageMatch = typeof bgStyle.backgroundImage === 'string'
            ? bgStyle.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)
            : null;
        const bgImageUrl = bgImageMatch?.[1];

        if (bgImageUrl) {
            const bgEval = evaluateShareImageCandidate(bgImageUrl);
            if (bgEval.ok && bgEval.resolvedUrl) {
                try {
                    const remote = await fetchRemoteImageBuffer(bgEval.resolvedUrl);
                    bgBuffer = remote.buffer;
                } catch { /* use fallback gradient */ }
            }
        }

        // ── Base layer: background or dark gradient ──
        let baseLayer;
        if (bgBuffer) {
            baseLayer = await sharp(bgBuffer, { limitInputPixels: 60_000_000 })
                .resize(DEFAULT_OG_IMAGE_WIDTH, DEFAULT_OG_IMAGE_HEIGHT, { fit: 'cover' })
                .toBuffer();
        } else {
            // Use profile's solid background color if available, otherwise dark fallback
            const solidColor = (typeof bgStyle.background === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(bgStyle.background.trim()))
                ? bgStyle.background.trim()
                : null;
            const gradientSvg = solidColor
                ? `<svg width="${DEFAULT_OG_IMAGE_WIDTH}" height="${DEFAULT_OG_IMAGE_HEIGHT}">
                    <rect width="100%" height="100%" fill="${solidColor}"/>
                </svg>`
                : `<svg width="${DEFAULT_OG_IMAGE_WIDTH}" height="${DEFAULT_OG_IMAGE_HEIGHT}">
                    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#1a1a2e"/>
                        <stop offset="100%" stop-color="#16213e"/>
                    </linearGradient></defs>
                    <rect width="100%" height="100%" fill="url(#g)"/>
                </svg>`;
            baseLayer = await sharp(Buffer.from(gradientSvg))
                .resize(DEFAULT_OG_IMAGE_WIDTH, DEFAULT_OG_IMAGE_HEIGHT)
                .png()
                .toBuffer();
        }

        // ── Dark overlay + circular avatar (parallel) ──
        const avatarSize = 180;
        const avatarUrl = user.image_url;

        const overlayPromise = sharp(Buffer.from(
            `<svg width="${DEFAULT_OG_IMAGE_WIDTH}" height="${DEFAULT_OG_IMAGE_HEIGHT}">
                <rect width="100%" height="100%" fill="black" fill-opacity="0.55"/>
            </svg>`
        )).png().toBuffer();

        const avatarPromise = (async () => {
            if (!avatarUrl) return null;
            const avatarEval = evaluateShareImageCandidate(avatarUrl);
            if (!avatarEval.ok || !avatarEval.resolvedUrl) return null;
            try {
                const remote = await fetchRemoteImageBuffer(avatarEval.resolvedUrl);
                const circleMask = Buffer.from(
                    `<svg width="${avatarSize}" height="${avatarSize}">
                        <circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="white"/>
                    </svg>`
                );
                const resizedAvatar = await sharp(remote.buffer, { limitInputPixels: 60_000_000 })
                    .resize(avatarSize, avatarSize, { fit: 'cover' })
                    .png()
                    .toBuffer();
                return await sharp(resizedAvatar)
                    .composite([{ input: circleMask, blend: 'dest-in' }])
                    .png()
                    .toBuffer();
            } catch { return null; }
        })();

        const [overlayBuffer, avatarComposite] = await Promise.all([overlayPromise, avatarPromise]);

        // ── Compose all layers ──
        const composites = [
            { input: overlayBuffer, top: 0, left: 0 },
        ];

        if (avatarComposite) {
            const avatarLeft = Math.round((DEFAULT_OG_IMAGE_WIDTH - avatarSize) / 2);
            composites.push({ input: avatarComposite, top: 100, left: avatarLeft });
        }

        const finalImage = await sharp(baseLayer)
            .composite(composites)
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();

        setShareImageCached(`profile:${username}`, finalImage);
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(finalImage);
    } catch (err) {
        console.error('profile share image route error:', err?.message || err);
        return res.redirect(302, DEFAULT_OG_IMAGE_URL);
    }
});

// ── Profile share route: serves OG meta tags for social media previews ──
app.get('/share/u/:username', async (req, res) => {
    const { username } = req.params;
    const shareOrigin = getRequestOrigin(req);
    const clientProfileUrl = `${SITE_URL}/u/${encodeURIComponent(username)}`;

    try {
        const result = await getUserByUsernameService(username);
        const user = result?.userData?.[0];
        if (!user) {
            return res.redirect(302, clientProfileUrl);
        }

        const displayName = normalizeWhitespace(user.name) || username;
        const bio = toPreviewText(user.bio || '', SOCIAL_PREVIEW_MAX_CHARS) || `Check out ${displayName}'s profile on Iskryb`;
        const sharePageUrl = new URL(`/share/u/${encodeURIComponent(username)}`, `${shareOrigin}/`).toString();
        const shareImageUrl = new URL(`/share/u/${encodeURIComponent(username)}/image`, `${shareOrigin}/`).toString();
        const fbAppIdTag = META_FB_APP_ID
            ? `<meta property="fb:app_id" content="${escHtml(META_FB_APP_ID)}">`
            : '';

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(displayName)}'s Profile | Iskryb</title>
<meta name="description" content="${escHtml(bio)}">
${fbAppIdTag}
<link rel="canonical" href="${escHtml(sharePageUrl)}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${escHtml(displayName)}'s Profile | Iskryb">
<meta property="og:description" content="${escHtml(bio)}">
<meta property="og:image" content="${escHtml(shareImageUrl)}">
<meta property="og:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta property="og:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<meta property="og:url" content="${escHtml(sharePageUrl)}">
<meta property="og:site_name" content="Iskryb">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(displayName)}'s Profile | Iskryb">
<meta name="twitter:description" content="${escHtml(bio)}">
<meta name="twitter:image" content="${escHtml(shareImageUrl)}">
<meta name="twitter:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta name="twitter:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<script>
window.location.replace(${JSON.stringify(clientProfileUrl)});
</script>
</head>
<body>
<p>${escHtml(displayName)}'s Profile - Redirecting to Iskryb...</p>
<a href="${escHtml(clientProfileUrl)}">Click here if not redirected</a>
</body>
</html>`;

        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (err) {
        console.error('profile share route error:', err?.message || err);
        return res.redirect(302, clientProfileUrl);
    }
});

// ── Share route: serves OG meta tags for social media previews ──
app.get('/share/post/:journalId/image', async (req, res) => {
    const { journalId } = req.params;
    const debugMode = isShareImageDebugRequest(req);

    // Serve from cache if available (skip for debug)
    if (!debugMode) {
        const cached = getShareImageCached(`post:${journalId}`);
        if (cached) {
            res.set('Content-Type', 'image/jpeg');
            res.set('Cache-Control', 'public, max-age=3600');
            return res.send(cached);
        }
    }

    await ensureShareFonts();
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

        setShareImageCached(`post:${journalId}`, ogImageBuffer);
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
        const sharePageUrl = new URL(`/share/post/${journalId}`, `${shareOrigin}/`).toString();
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
<link rel="canonical" href="${escHtml(sharePageUrl)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escHtml(shareMeta.title)}">
<meta property="og:description" content="${escHtml(shareMeta.description)}">
<meta property="og:image" content="${escHtml(shareImageUrl)}">
<meta property="og:image:width" content="${String(DEFAULT_OG_IMAGE_WIDTH)}">
<meta property="og:image:height" content="${String(DEFAULT_OG_IMAGE_HEIGHT)}">
<meta property="og:url" content="${escHtml(sharePageUrl)}">
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

// Also handle /api/share/u/:username so getProfileShareUrl works in both configurations
app.get('/api/share/u/:username/image', (req, res) => {
    res.redirect(301, `/share/u/${req.params.username}/image`);
});

app.get('/api/share/u/:username', (req, res) => {
    res.redirect(301, `/share/u/${req.params.username}`);
});

const buildHealthPayload = () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: metricsState.startedAt,
    now: new Date().toISOString(),
});

const isMetricsAuthorized = (req) => {
    if (!METRICS_TOKEN) {
        return true;
    }

    const providedToken = String(req.headers['x-metrics-token'] || '').trim();
    return Boolean(providedToken && providedToken === METRICS_TOKEN);
};

const buildMetricsPayload = () => {
    const routeStats = Array.from(metricsState.routeStats.entries())
        .map(([route, stat]) => ({
            route,
            count: stat.count,
            avgDurationMs: stat.count > 0 ? Number((stat.totalDurationMs / stat.count).toFixed(2)) : 0,
            maxDurationMs: Number(stat.maxDurationMs.toFixed(2)),
            bytesSent: stat.bytesSent,
            statusBuckets: stat.statusBuckets,
        }))
        .sort((a, b) => b.count - a.count);

    return {
        startedAt: metricsState.startedAt,
        requests: metricsState.requests,
        responses: metricsState.responses,
        inFlight: metricsState.inFlight,
        bytesSent: metricsState.bytesSent,
        statusBuckets: metricsState.statusBuckets,
        routeStats: routeStats,
    };
};

const sendHealth = (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(buildHealthPayload());
};

const sendMetrics = (req, res) => {
    if (!isMetricsAuthorized(req)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    res.set('Cache-Control', 'no-store');
    return res.status(200).json(buildMetricsPayload());
};

app.get('/health', sendHealth);
app.get('/api/health', sendHealth);
app.get('/metrics', sendMetrics);
app.get('/api/metrics', sendMetrics);

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
    const workerInfo = CLUSTER_ENABLED ? ` (worker ${process.pid})` : '';
    console.log(`server is running at port${PORT}${workerInfo}`)

    // Bootstrap topic embeddings (non-blocking, only on first worker or non-clustered)
    if (!CLUSTER_ENABLED || cluster.worker?.id === 1) {
        bootstrapTopicEmbeddings()
            .catch(err => console.error('topic embeddings bootstrap error:', err?.message || err));
    }
})
} // end of cluster worker / non-clustered block
