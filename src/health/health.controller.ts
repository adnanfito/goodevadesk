import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      this.redis.ping().then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);

    const body = {
      status: db === 'up' && redis === 'up' ? 'ok' : 'error',
      db,
      redis,
    };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
