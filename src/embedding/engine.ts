import type { EmbeddingEngine } from '../types.js';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

let pipeline: any = null;

async function getPipeline() {
  if (pipeline) return pipeline;

  // Dynamic import to avoid loading the heavy module until needed
  const { pipeline: createPipeline } = await import('@xenova/transformers');
  pipeline = await createPipeline('feature-extraction', MODEL_NAME, {
    quantized: true,
  });

  return pipeline;
}

export class OnnxEmbeddingEngine implements EmbeddingEngine {
  async embed(text: string): Promise<Float32Array> {
    const pipe = await getPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    // Process sequentially to avoid OOM on large batches
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// Validate embedding dimensions
export function validateEmbedding(embedding: Float32Array): boolean {
  return embedding.length === EMBEDDING_DIM;
}

export const EMBEDDING_DIMENSIONS = EMBEDDING_DIM;
