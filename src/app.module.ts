import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { QueueOptions } from 'bullmq';
import { ApiKeyGuard } from './auth/api-key.guard';
import { type Env, validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TicketsModule } from './tickets/tickets.module';
import { TriageModule } from './triage/triage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): QueueOptions => {
        const url: string = config.get('REDIS_URL', { infer: true });
        return {
          connection: { url },
          defaultJobOptions: {
            attempts: config.get('LLM_MAX_ATTEMPTS', { infer: true }),
            backoff: {
              type: 'exponential',
              delay: config.get('LLM_RETRY_BASE_DELAY_MS', { infer: true }),
            },
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        };
      },
    }),
    PrismaModule,
    RedisModule,
    TicketsModule,
    TriageModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
