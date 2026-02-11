import { pipeline } from "@xenova/transformers";

let embeddingPipelinePromise;

const EMBEDDING_MODEL = 'Supabase/gte-small';
const MAX_EMBEDDING_INPUT_CHARS = 6000;
const CACHE_MAX_ENTRIES = 250;
const CACHE_TTL_MS = 10 * 60 * 1000;
const embeddingCache = new Map();

const getEmbeddingPipeline = () => {
    if(!embeddingPipelinePromise){
        embeddingPipelinePromise = pipeline('feature-extraction', EMBEDDING_MODEL);
    }
    return embeddingPipelinePromise;
}

const normalizeTextInput = (title = '', body = '') => {
    const merged = `${title ?? ''} ${body ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();

    if(!merged){
        return null;
    }

    if(merged.length <= MAX_EMBEDDING_INPUT_CHARS){
        return merged;
    }

    return merged.slice(0, MAX_EMBEDDING_INPUT_CHARS);
}

const getCachedEmbedding = (text) => {
    const cached = embeddingCache.get(text);
    if(!cached){
        return null;
    }

    if(Date.now() > cached.expiresAt){
        embeddingCache.delete(text);
        return null;
    }

    return [...cached.embedding];
}

const setCachedEmbedding = (text, embedding) => {
    if(embeddingCache.size >= CACHE_MAX_ENTRIES){
        const firstKey = embeddingCache.keys().next().value;
        if(firstKey){
            embeddingCache.delete(firstKey);
        }
    }

    embeddingCache.set(text, {
        embedding: [...embedding],
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

const GenerateEmbeddings = async(title = '', body = '') => {
    const normalizedText = normalizeTextInput(title, body);
    if(!normalizedText){
        return null;
    }

    const cachedEmbedding = getCachedEmbedding(normalizedText);
    if(cachedEmbedding){
        return cachedEmbedding;
    }

    const genereateEmbedding = await getEmbeddingPipeline();
    const output = await genereateEmbedding(normalizedText, {
        pooling: 'mean',
        normalize: true
    })

    const embedding = Array.from(output.data);
    setCachedEmbedding(normalizedText, embedding);

    return embedding;
}

export default GenerateEmbeddings;
