// Pre-downloads the embedding model into EMBEDDING_CACHE_DIR so containers
// start without fetching from the Hugging Face Hub. Run at Docker build time
// or locally via `pnpm model:download`.
import { env, pipeline } from '@huggingface/transformers';

try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the process environment
}

const model =
  process.env.EMBEDDING_MODEL ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
env.cacheDir = process.env.EMBEDDING_CACHE_DIR ?? './.models';

console.log(`Downloading ${model} into ${env.cacheDir} ...`);
const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' });
const output = await extractor('warm-up', { pooling: 'mean', normalize: true });
console.log(`Ready: ${model} (dim=${output.dims.at(-1)})`);
await extractor.dispose();
