import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  LLM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),

  EMBEDDING_MODEL: z
    .string()
    .min(1)
    .default('Xenova/paraphrase-multilingual-MiniLM-L12-v2'),
  EMBEDDING_CACHE_DIR: z.string().min(1).default('./.models'),
  SEMANTIC_CACHE_THRESHOLD: z.coerce.number().gt(0).max(1).default(0.92),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  TRIAGE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule.forRoot({ validate }) — fails fast on boot. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
