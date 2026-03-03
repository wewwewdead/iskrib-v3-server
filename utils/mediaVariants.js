const STORAGE_PUBLIC_SEGMENT = '/storage/v1/object/public/';
const VARIANT_SUFFIXES = {
    thumbnail: '__thumb',
    card: '__card',
    detail: '__detail',
    original: '__original'
};

export const MEDIA_VARIANT_CONFIG = {
    avatars: {
        original: { width: 400, height: 400, fit: 'cover' },
        detail: { width: 256, height: 256, fit: 'cover' },
        card: { width: 128, height: 128, fit: 'cover' },
        thumbnail: { width: 64, height: 64, fit: 'cover' }
    },
    background: {
        original: { width: 1920, height: 1080, fit: 'inside' },
        detail: { width: 1440, height: 810, fit: 'inside' },
        card: { width: 960, height: 540, fit: 'inside' },
        thumbnail: { width: 480, height: 270, fit: 'inside' }
    },
    'story-covers': {
        original: { width: 800, height: 1200, fit: 'inside' },
        detail: { width: 640, height: 960, fit: 'inside' },
        card: { width: 480, height: 720, fit: 'inside' },
        thumbnail: { width: 240, height: 360, fit: 'inside' }
    },
    'journal-images': {
        original: { width: 1600, height: 1600, fit: 'inside' },
        detail: { width: 1280, height: 1280, fit: 'inside' },
        card: { width: 640, height: 640, fit: 'inside' },
        thumbnail: { width: 320, height: 320, fit: 'inside' }
    }
};

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getBaseNameData = (fileName = '') => {
    const match = fileName.match(/^(.*?)(__(?:thumb|card|detail|original))?(\.[^.]*)$/i);
    if(!match){
        return {
            baseName: fileName,
            extension: '',
            variantKey: null
        };
    }

    const variantEntry = Object.entries(VARIANT_SUFFIXES)
        .find(([, suffix]) => suffix.toLowerCase() === (match[2] || '').toLowerCase());

    return {
        baseName: match[1],
        extension: match[3] || '',
        variantKey: variantEntry?.[0] || null
    };
};

const getBucketPathFromUrl = (bucket, url = '') => {
    if(typeof url !== 'string' || !url){
        return '';
    }

    try {
        const parsed = new URL(url);
        const publicPrefix = `${STORAGE_PUBLIC_SEGMENT}${bucket}/`;
        const index = parsed.pathname.indexOf(publicPrefix);
        if(index === -1){
            return '';
        }
        return decodeURIComponent(parsed.pathname.slice(index + publicPrefix.length));
    } catch {
        return '';
    }
};

const createPublicUrlForPath = (bucket, url = '', path = '') => {
    if(!path){
        return typeof url === 'string' ? url : null;
    }

    if(typeof url === 'string' && url){
        try {
            const parsed = new URL(url);
            const publicPrefix = `${STORAGE_PUBLIC_SEGMENT}${bucket}/`;
            const index = parsed.pathname.indexOf(publicPrefix);
            if(index !== -1){
                parsed.pathname = `${parsed.pathname.slice(0, index + publicPrefix.length)}${path}`;
                parsed.search = '';
                parsed.hash = '';
                return parsed.toString();
            }
        } catch {
            return url;
        }
    }

    return null;
};

export const getVariantPathSet = (path = '') => {
    if(typeof path !== 'string' || !path){
        return {
            representativePath: '',
            thumbnailPath: '',
            cardPath: '',
            detailPath: '',
            originalPath: '',
            isVariantManaged: false
        };
    }

    const slashIndex = path.lastIndexOf('/');
    const directory = slashIndex === -1 ? '' : path.slice(0, slashIndex + 1);
    const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
    const { baseName, extension, variantKey } = getBaseNameData(fileName);

    if(!variantKey){
        return {
            representativePath: path,
            thumbnailPath: path,
            cardPath: path,
            detailPath: path,
            originalPath: path,
            isVariantManaged: false
        };
    }

    return {
        representativePath: `${directory}${baseName}${VARIANT_SUFFIXES.detail}${extension}`,
        thumbnailPath: `${directory}${baseName}${VARIANT_SUFFIXES.thumbnail}${extension}`,
        cardPath: `${directory}${baseName}${VARIANT_SUFFIXES.card}${extension}`,
        detailPath: `${directory}${baseName}${VARIANT_SUFFIXES.detail}${extension}`,
        originalPath: `${directory}${baseName}${VARIANT_SUFFIXES.original}${extension}`,
        isVariantManaged: true
    };
};

export const buildVariantDescriptor = (bucket, urlOrPath = '') => {
    const input = typeof urlOrPath === 'string' ? urlOrPath : '';
    const path = input.includes('http') ? getBucketPathFromUrl(bucket, input) : input;
    if(!path){
        return null;
    }

    const pathSet = getVariantPathSet(path);
    const thumbnailUrl = createPublicUrlForPath(bucket, input, pathSet.thumbnailPath);
    const cardUrl = createPublicUrlForPath(bucket, input, pathSet.cardPath);
    const detailUrl = createPublicUrlForPath(bucket, input, pathSet.detailPath);
    const originalUrl = createPublicUrlForPath(bucket, input, pathSet.originalPath);

    return {
        bucket,
        path: pathSet.representativePath,
        thumbnailPath: pathSet.thumbnailPath,
        cardPath: pathSet.cardPath,
        detailPath: pathSet.detailPath,
        originalPath: pathSet.originalPath,
        isVariantManaged: pathSet.isVariantManaged,
        thumbnailUrl: thumbnailUrl || input,
        cardUrl: cardUrl || input,
        detailUrl: detailUrl || input,
        originalUrl: originalUrl || input
    };
};

export const pickVariantUrl = (bucket, urlOrPath, usage = 'card') => {
    const descriptor = buildVariantDescriptor(bucket, urlOrPath);
    if(!descriptor){
        return typeof urlOrPath === 'string' ? urlOrPath : null;
    }

    if(usage === 'thumbnail'){
        return descriptor.thumbnailUrl;
    }
    if(usage === 'feed_banner'){
        return descriptor.detailUrl;
    }
    if(usage === 'detail'){
        return descriptor.detailUrl;
    }
    if(usage === 'original'){
        return descriptor.originalUrl;
    }
    return descriptor.cardUrl;
};

export const listVariantPathsForDeletion = (path = '') => {
    const descriptor = getVariantPathSet(path);
    if(!descriptor.representativePath){
        return [];
    }

    const paths = descriptor.isVariantManaged
        ? [
            descriptor.thumbnailPath,
            descriptor.cardPath,
            descriptor.detailPath,
            descriptor.originalPath
        ]
        : [descriptor.representativePath];

    return [...new Set(paths.filter(Boolean))];
};

export const isRepresentativeVariantPath = (path = '') => {
    const descriptor = getVariantPathSet(path);
    return descriptor.representativePath === path;
};

export const isPrimaryListableFileName = (fileName = '') => {
    const { variantKey } = getBaseNameData(fileName);
    return !variantKey || variantKey === 'detail';
};

export const createVariantFileNames = (baseFileName = '') => {
    const { baseName, extension } = getBaseNameData(baseFileName);
    return {
        thumbnail: `${baseName}${VARIANT_SUFFIXES.thumbnail}${extension || '.webp'}`,
        card: `${baseName}${VARIANT_SUFFIXES.card}${extension || '.webp'}`,
        detail: `${baseName}${VARIANT_SUFFIXES.detail}${extension || '.webp'}`,
        original: `${baseName}${VARIANT_SUFFIXES.original}${extension || '.webp'}`
    };
};

export const createMediaResponsePayload = (bucket, urlOrPath = '', usage = 'card') => {
    const descriptor = buildVariantDescriptor(bucket, urlOrPath);
    if(!descriptor){
        return null;
    }

    return {
        bucket,
        path: descriptor.path,
        thumbnail_url: descriptor.thumbnailUrl,
        card_url: descriptor.cardUrl,
        detail_url: descriptor.detailUrl,
        original_url: descriptor.originalUrl,
        preferred_url: pickVariantUrl(bucket, urlOrPath, usage)
    };
};

export const buildPathMatcher = (path = '') => {
    const candidates = listVariantPathsForDeletion(path).map((item) => escapeRegExp(item));
    if(candidates.length === 0){
        return null;
    }
    return new RegExp(`/(?:${candidates.join('|')})$`, 'i');
};
