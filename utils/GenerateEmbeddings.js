import { pipeline } from "@xenova/transformers";

const GenerateEmbeddings = async(title, body) => {
    const genereateEmbedding = await pipeline('feature-extraction', 'Supabase/gte-small');
    const output = await genereateEmbedding(`${title}  ${body}`, {
        pooling: 'mean',
        normalize: true
    })

    const embedding = Array.from(output.data);

    return embedding;
}

export default GenerateEmbeddings;