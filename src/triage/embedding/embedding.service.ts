import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';
import type { Env } from '../../config/env';

/**
 * Sentence embeddings computed in-process with transformers.js (ONNX).
 * The model is loaded lazily on first use and shared across calls.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  readonly model: string;
  private extractor?: Promise<FeatureExtractionPipeline>;

  constructor(config: ConfigService<Env, true>) {
    this.model = config.get('EMBEDDING_MODEL', { infer: true });
    env.cacheDir = config.get('EMBEDDING_CACHE_DIR', { infer: true });
  }

  /** Returns an L2-normalized vector, so cosine similarity = dot product. */
  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.load();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Float32Array.from(output.data as ArrayLike<number>);
  }

  private load(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      const started = Date.now();
      this.extractor = pipeline('feature-extraction', this.model, {
        dtype: 'q8',
      })
        .then((extractor) => {
          this.logger.log(
            `Loaded embedding model ${this.model} in ${Date.now() - started}ms`,
          );
          return extractor;
        })
        .catch((err: unknown) => {
          // Allow a later call to retry loading instead of caching the failure.
          this.extractor = undefined;
          throw err;
        });
    }
    return this.extractor;
  }
}
