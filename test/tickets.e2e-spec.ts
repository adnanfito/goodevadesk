import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { generateApiKey, hashApiKey } from '../src/auth/api-key.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';
import type { TicketResponse } from '../src/tickets/ticket.mapper';
import {
  LLM_PROVIDER,
  LlmError,
  type LlmProvider,
  type TriageInput,
} from '../src/triage/llm/llm.provider';

interface TicketList {
  data: TicketResponse[];
  meta: { page: number; limit: number; total: number };
}

/**
 * Runs against real Postgres + Redis (`docker compose up -d postgres redis`)
 * and the real embedding model; only the LLM is faked.
 */
class FakeLlm implements LlmProvider {
  readonly cacheVersion = 'e2e-fake';
  calls: TriageInput[] = [];
  private flakyFailures = 0;

  triage(input: TriageInput) {
    this.calls.push(input);
    if (input.subject.includes('[permanent-fail]')) {
      return Promise.reject(new LlmError('LLM request rejected (400)', false));
    }
    if (input.subject.includes('[flaky]') && this.flakyFailures++ === 0) {
      return Promise.reject(new LlmError('LLM rate limit exceeded', true));
    }
    return Promise.resolve({
      category: 'technical' as const,
      suggestedReply: `Halo [nama pelanggan], terima kasih sudah menghubungi kami.`,
    });
  }
}

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  const llm = new FakeLlm();
  const orgA = { id: '', key: generateApiKey() };
  const orgB = { id: '', key: generateApiKey() };

  const api = () => request(app.getHttpServer());

  const createTicket = async (
    key: string,
    subject: string,
    message: string,
  ) => {
    const res = await api()
      .post('/tickets')
      .set('x-api-key', key)
      .send({ customer_email: 'budi@example.com', subject, message })
      .expect(201);
    expect(res.body).toMatchObject({ ai_status: 'pending', status: 'open' });
    return res.body as TicketResponse;
  };

  const waitForTriage = async (key: string, id: string) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const res = await api()
        .get(`/tickets/${id}`)
        .set('x-api-key', key)
        .expect(200);
      const ticket = res.body as TicketResponse;
      if (ticket.ai_status !== 'pending') return ticket;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Ticket ${id} still pending`);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(llm)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    const suffix = Date.now();
    orgA.id = (
      await prisma.organization.create({
        data: { name: `e2e-a-${suffix}`, apiKey: hashApiKey(orgA.key) },
      })
    ).id;
    orgB.id = (
      await prisma.organization.create({
        data: { name: `e2e-b-${suffix}`, apiKey: hashApiKey(orgB.key) },
      })
    ).id;
  });

  afterAll(async () => {
    if (!app) return;
    const orgIds = [orgA.id, orgB.id].filter(Boolean);
    for (const id of orgIds) {
      const keys = await redis.keys(`triage:*:${id}:*`);
      if (keys.length) await redis.del(...keys);
    }
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await app.close();
  });

  describe('auth', () => {
    it('rejects requests without an API key', () =>
      api().get('/tickets').expect(401));

    it('rejects an unknown API key', () =>
      api().get('/tickets').set('x-api-key', 'nope').expect(401));

    it('keeps /health public', () => api().get('/health').expect(200));
  });

  describe('triage and Redis cache', () => {
    let firstTicketId: string;

    it('classifies a new ticket with the LLM', async () => {
      const { id } = await createTicket(
        orgA.key,
        'Tidak bisa login',
        'Saya tidak bisa login ke akun saya sejak tadi pagi',
      );
      firstTicketId = id;

      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({
        ai_status: 'completed',
        ai_source: 'llm',
        category: 'technical',
        status: 'open',
      });
      expect(ticket.suggested_reply).toEqual(expect.any(String));
      expect(llm.calls).toHaveLength(1);
    });

    it('reuses the result for an identical ticket (exact hit)', async () => {
      const { id } = await createTicket(
        orgA.key,
        '  TIDAK BISA LOGIN ',
        'Saya tidak bisa  login ke akun saya sejak tadi pagi',
      );
      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({ ai_source: 'cache_exact' });
      expect(llm.calls).toHaveLength(1);
    });

    it('reuses the result for a paraphrased ticket (vector search hit)', async () => {
      const { id } = await createTicket(
        orgA.key,
        'Gagal masuk akun',
        'Sejak pagi saya tidak bisa login ke akun saya',
      );
      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({
        ai_source: 'cache_semantic',
        category: 'technical',
      });
      expect(llm.calls).toHaveLength(1);
    });

    it('calls the LLM for an unrelated ticket', async () => {
      const { id } = await createTicket(
        orgA.key,
        'Tagihan dobel',
        'Kartu saya ditagih dua kali bulan ini',
      );
      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({ ai_source: 'llm' });
      expect(llm.calls).toHaveLength(2);
    });

    it('never shares cache entries across organizations', async () => {
      const { id } = await createTicket(
        orgB.key,
        'Tidak bisa login',
        'Saya tidak bisa login ke akun saya sejak tadi pagi',
      );
      const ticket = await waitForTriage(orgB.key, id);
      expect(ticket).toMatchObject({ ai_source: 'llm' });
      expect(llm.calls).toHaveLength(3);
    });

    it('does not reuse a cached reply written in another language', async () => {
      // Semantically close to the cached Indonesian ticket, but in English.
      const { id } = await createTicket(
        orgA.key,
        'Cannot log in',
        'I cannot log in to my account since this morning',
      );
      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({ ai_source: 'llm' });
      expect(llm.calls).toHaveLength(4);
    });

    it('retries transient LLM errors', async () => {
      const { id } = await createTicket(
        orgA.key,
        '[flaky] Webhook tidak terkirim',
        'Webhook ke server kami berhenti sejak deploy terakhir',
      );
      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({
        ai_status: 'completed',
        ai_source: 'llm',
      });
    });

    it('keeps the ticket when the LLM fails permanently', async () => {
      const { id } = await createTicket(
        orgA.key,
        '[permanent-fail] Pertanyaan kerja sama',
        'Apakah GoodevaDesk membuka program partner?',
      );
      const ticket = await waitForTriage(orgA.key, id);
      expect(ticket).toMatchObject({
        ai_status: 'failed',
        status: 'open',
        category: null,
        suggested_reply: null,
      });
      expect(ticket.ai_error).toContain('400');
    });

    describe('tenant isolation', () => {
      it('hides tickets of other organizations', async () => {
        await api()
          .get(`/tickets/${firstTicketId}`)
          .set('x-api-key', orgB.key)
          .expect(404);
      });

      it('prevents updating tickets of other organizations', async () => {
        await api()
          .patch(`/tickets/${firstTicketId}/status`)
          .set('x-api-key', orgB.key)
          .send({ status: 'closed' })
          .expect(404);

        const res = await api()
          .get(`/tickets/${firstTicketId}`)
          .set('x-api-key', orgA.key)
          .expect(200);
        expect((res.body as TicketResponse).status).toBe('open');
      });

      it('lists only the caller organization tickets', async () => {
        const res = await api()
          .get('/tickets')
          .set('x-api-key', orgB.key)
          .expect(200);
        expect((res.body as TicketList).meta.total).toBe(1);
        expect(
          (res.body as TicketList).data.every(
            (t: { organization_id: string }) => t.organization_id === orgB.id,
          ),
        ).toBe(true);
      });
    });
  });

  describe('status and filters', () => {
    it('updates status and filters by status/category', async () => {
      const list = await api()
        .get('/tickets?category=technical')
        .set('x-api-key', orgA.key)
        .expect(200);
      const target = (list.body as TicketList).data[0] as { id: string };

      await api()
        .patch(`/tickets/${target.id}/status`)
        .set('x-api-key', orgA.key)
        .send({ status: 'in_progress' })
        .expect(200)
        .expect((res) =>
          expect((res.body as TicketResponse).status).toBe('in_progress'),
        );

      const filtered = await api()
        .get('/tickets?status=in_progress')
        .set('x-api-key', orgA.key)
        .expect(200);
      expect(
        (filtered.body as TicketList).data.map((t: { id: string }) => t.id),
      ).toEqual([target.id]);
    });

    it('validates input', async () => {
      await api()
        .patch('/tickets/not-a-uuid/status')
        .set('x-api-key', orgA.key)
        .send({ status: 'closed' })
        .expect(400);
      await api()
        .get('/tickets?status=bogus')
        .set('x-api-key', orgA.key)
        .expect(400);
      await api()
        .post('/tickets')
        .set('x-api-key', orgA.key)
        .send({ customer_email: 'not-an-email', subject: '', message: 'x' })
        .expect(400);
    });
  });
});
