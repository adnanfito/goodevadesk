import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../../config/env';
import { TicketCategory } from '../../generated/prisma/enums';
import { REDIS } from '../../redis/redis.module';
import { EmbeddingService } from '../embedding/embedding.service';
import type { TriageResult } from '../llm/llm.provider';

/** Everything a cached result must match besides the text itself. */
export interface CacheScope {
  organizationId: string;
  /** Language of the ticket; a cached reply is only valid in its language. */
  language: string;
  /** LlmProvider.cacheVersion: provider + model + prompt fingerprint. */
  version: string;
}

export interface SemanticHit {
  result: TriageResult;
  similarity: number;
}

const CATEGORIES = new Set<string>(Object.values(TicketCategory));

/**
 * Redis-backed cache of triage results, one HASH per (organization, LLM
 * version, text).
 *
 * The same document serves two lookups:
 *  - exact: direct HMGET on `{prefix}{orgId}:{version}:{sha256(text)}`
 *  - semantic: KNN over the `embedding` vector field, filtered by the
 *    `org`, `lang` and `ver` TAGs
 *
 * Index and key prefix include the embedding model slug, so switching
 * EMBEDDING_MODEL never mixes vectors of different models or dimensions.
 * `v2` is the index schema version (bumped when the SCHEMA changes).
 */
@Injectable()
export class SemanticCacheService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly prefix: string;
  private readonly indexName: string;
  private readonly threshold: number;
  private readonly ttlSeconds: number;
  private indexReady?: Promise<void>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly embeddings: EmbeddingService,
    config: ConfigService<Env, true>,
  ) {
    const slug = embeddings.model.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    this.prefix = `triage:v2:${slug}:`;
    this.indexName = `idx:triage:v2:${slug}`;
    this.threshold = config.get('SEMANTIC_CACHE_THRESHOLD', { infer: true });
    this.ttlSeconds = config.get('CACHE_TTL_SECONDS', { infer: true });
  }

  /** Warm up the model and index in the background; never blocks boot. */
  onApplicationBootstrap() {
    void this.embeddings
      .embed('warm-up')
      .then((vector) => this.ensureIndex(vector.length))
      .catch((err: unknown) =>
        this.logger.warn(`Cache warm-up failed: ${errorMessage(err)}`),
      );
  }

  async getExact(
    scope: CacheScope,
    textHash: string,
  ): Promise<TriageResult | null> {
    const doc = await this.redis.hmget(
      this.key(scope, textHash),
      'category',
      'suggested_reply',
    );
    return toTriageResult(doc[0], doc[1]);
  }

  async findSimilar(
    scope: CacheScope,
    vector: Float32Array,
  ): Promise<SemanticHit | null> {
    await this.ensureIndex(vector.length);

    const filter = [
      `@org:{${escapeTag(scope.organizationId)}}`,
      `@lang:{${escapeTag(scope.language)}}`,
      `@ver:{${escapeTag(scope.version)}}`,
    ].join(' ');
    const reply = (await this.redis.call(
      'FT.SEARCH',
      this.indexName,
      `(${filter})=>[KNN 1 @embedding $vec AS dist]`,
      'PARAMS',
      '2',
      'vec',
      toBuffer(vector),
      'SORTBY',
      'dist',
      'RETURN',
      '3',
      'category',
      'suggested_reply',
      'dist',
      'LIMIT',
      '0',
      '1',
      'DIALECT',
      '2',
    )) as [number, ...unknown[]];

    // RESP2 reply: [total, key, [field, value, ...], ...]
    const fields = reply[2];
    if (!reply[0] || !Array.isArray(fields)) return null;

    const doc = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      doc.set(String(fields[i]), String(fields[i + 1]));
    }

    const result = toTriageResult(
      doc.get('category'),
      doc.get('suggested_reply'),
    );
    const distance = Number(doc.get('dist'));
    if (!result || Number.isNaN(distance)) return null;

    // Vectors are normalized and the metric is COSINE: similarity = 1 - distance.
    const similarity = 1 - distance;
    return similarity >= this.threshold ? { result, similarity } : null;
  }

  async store(
    scope: CacheScope,
    textHash: string,
    vector: Float32Array | null,
    result: TriageResult,
  ): Promise<void> {
    const key = this.key(scope, textHash);
    const doc: Record<string, string | Buffer> = {
      org: scope.organizationId,
      lang: scope.language,
      ver: scope.version,
      category: result.category,
      suggested_reply: result.suggestedReply,
      created_at: new Date().toISOString(),
    };
    if (vector) {
      await this.ensureIndex(vector.length);
      doc.embedding = toBuffer(vector);
    }
    await this.redis.multi().hset(key, doc).expire(key, this.ttlSeconds).exec();
  }

  private key(scope: CacheScope, textHash: string) {
    return `${this.prefix}${scope.organizationId}:${scope.version}:${textHash}`;
  }

  private ensureIndex(dim: number): Promise<void> {
    if (!this.indexReady) {
      this.indexReady = this.createIndexIfMissing(dim).catch((err: unknown) => {
        this.indexReady = undefined;
        throw err;
      });
    }
    return this.indexReady;
  }

  private async createIndexIfMissing(dim: number) {
    try {
      await this.redis.call('FT.INFO', this.indexName);
      return;
    } catch (err) {
      if (!/unknown index|no such index|not found/i.test(errorMessage(err))) {
        throw err;
      }
    }

    try {
      await this.redis.call(
        'FT.CREATE',
        this.indexName,
        'ON',
        'HASH',
        'PREFIX',
        '1',
        this.prefix,
        'SCHEMA',
        'org',
        'TAG',
        'lang',
        'TAG',
        'ver',
        'TAG',
        'category',
        'TAG',
        'embedding',
        'VECTOR',
        'HNSW',
        '6',
        'TYPE',
        'FLOAT32',
        'DIM',
        String(dim),
        'DISTANCE_METRIC',
        'COSINE',
      );
      this.logger.log(`Created vector index ${this.indexName} (dim=${dim})`);
    } catch (err) {
      // Another replica may have created it concurrently.
      if (!/already exists/i.test(errorMessage(err))) throw err;
    }
  }
}

function toTriageResult(
  category: string | null | undefined,
  suggestedReply: string | null | undefined,
): TriageResult | null {
  if (!category || !suggestedReply || !CATEGORIES.has(category)) return null;
  return { category: category as TicketCategory, suggestedReply };
}

function toBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/** TAG queries treat punctuation (e.g. the hyphens in UUIDs) as separators. */
function escapeTag(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '\\$&');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
