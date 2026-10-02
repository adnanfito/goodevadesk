import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env';

export const REDIS = Symbol('REDIS');

/**
 * Shared ioredis connection for the semantic cache and health checks.
 * BullMQ manages its own connections (it needs blocking clients).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          // Cache is best-effort: fail commands quickly instead of queueing
          // them forever while Redis is unreachable.
          maxRetriesPerRequest: 2,
          // ioredis 6 defaults to RESP3, which reshapes FT.SEARCH replies;
          // pin RESP2 so the raw-command parsing stays stable.
          protocol: 2,
        });
        client.on('error', (err) => logger.warn(err.message));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
