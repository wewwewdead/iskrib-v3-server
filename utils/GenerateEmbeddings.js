import { pipeline } from "@xenova/transformers";

let embeddingPipelinePromise;

const getEmbeddingPipeline = () => {
    if(!embeddingPipelinePromise){
        embeddingPipelinePromise = pipeline('feature-extraction', 'Supabase/gte-small');
    }
    return embeddingPipelinePromise;
}

const GenerateEmbeddings = async(title, body) => {
    const genereateEmbedding = await getEmbeddingPipeline();
    const output = await genereateEmbedding(`${title}  ${body}`, {
        pooling: 'mean',
        normalize: true
    })

    const embedding = Array.from(output.data);

    return embedding;
}

export default GenerateEmbeddings;
