import { PrismaService } from '../prisma/prisma.service';
import { SemanticCacheService } from './cache/semantic-cache.service';
import { EmbeddingService } from './embedding/embedding.service';
import { LlmError } from './llm/llm.provider';
import { TriageService } from './triage.service';

const job = { ticketId: 'ticket-1', organizationId: 'org-1' };
const ticket = {
  id: job.ticketId,
  organizationId: job.organizationId,
  subject: 'Cannot log in',
  message: 'I cannot log in since this morning',
  aiStatus: 'pending',
};
// The sample ticket is English, so cache entries are scoped to "en".
const scope = { organizationId: 'org-1', language: 'en', version: 'v-test' };
const llmResult = {
  category: 'technical' as const,
  suggestedReply: 'Sorry about that, we are looking into it.',
};
const cached = {
  category: 'billing' as const,
  suggestedReply: 'Cached reply',
};

describe('TriageService', () => {
  let prisma: {
    ticket: { findFirst: jest.Mock; updateMany: jest.Mock };
  };
  let cache: {
    getExact: jest.Mock;
    findSimilar: jest.Mock;
    store: jest.Mock;
  };
  let embeddings: { embed: jest.Mock };
  let llm: { cacheVersion: string; triage: jest.Mock };
  let service: TriageService;
  const vector = new Float32Array([0.1, 0.2, 0.3]);

  beforeEach(() => {
    prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    cache = {
      getExact: jest.fn().mockResolvedValue(null),
      findSimilar: jest.fn().mockResolvedValue(null),
      store: jest.fn().mockResolvedValue(undefined),
    };
    embeddings = { embed: jest.fn().mockResolvedValue(vector) };
    llm = {
      cacheVersion: 'v-test',
      triage: jest.fn().mockResolvedValue(llmResult),
    };

    service = new TriageService(
      prisma as unknown as PrismaService,
      cache as unknown as SemanticCacheService,
      embeddings as unknown as EmbeddingService,
      llm,
    );
  });

  const savedData = () =>
    (prisma.ticket.updateMany.mock.calls[0] as [{ data: unknown }])[0].data;

  it('uses an exact cache hit without embedding or calling the LLM', async () => {
    cache.getExact.mockResolvedValue(cached);

    await service.triage(job);

    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(llm.triage).not.toHaveBeenCalled();
    expect(savedData()).toMatchObject({
      category: 'billing',
      aiStatus: 'completed',
      aiSource: 'cache_exact',
    });
  });

  it('uses a semantic cache hit without calling the LLM', async () => {
    cache.findSimilar.mockResolvedValue({ result: cached, similarity: 0.95 });

    await service.triage(job);

    expect(cache.findSimilar).toHaveBeenCalledWith(scope, vector);
    expect(llm.triage).not.toHaveBeenCalled();
    expect(savedData()).toMatchObject({ aiSource: 'cache_semantic' });
  });

  it('calls the LLM on a cache miss and stores the result', async () => {
    await service.triage(job);

    expect(llm.triage).toHaveBeenCalledWith({
      subject: ticket.subject,
      message: ticket.message,
    });
    expect(cache.store).toHaveBeenCalledWith(
      scope,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      vector,
      llmResult,
    );
    expect(savedData()).toMatchObject({
      category: 'technical',
      suggestedReply: llmResult.suggestedReply,
      aiStatus: 'completed',
      aiSource: 'llm',
    });
  });

  it('scopes ticket reads and writes to the organization', async () => {
    await service.triage(job);

    expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
      where: { id: 'ticket-1', organizationId: 'org-1' },
    });
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1', organizationId: 'org-1' },
      }),
    );
  });

  it('falls back to the LLM when Redis and embeddings are unavailable', async () => {
    cache.getExact.mockRejectedValue(new Error('ECONNREFUSED'));
    embeddings.embed.mockRejectedValue(new Error('model failed to load'));
    cache.store.mockRejectedValue(new Error('ECONNREFUSED'));

    await service.triage(job);

    expect(cache.findSimilar).not.toHaveBeenCalled();
    expect(cache.store).toHaveBeenCalledWith(
      scope,
      expect.any(String),
      null,
      llmResult,
    );
    expect(savedData()).toMatchObject({ aiSource: 'llm' });
  });

  it('scopes cache lookups to the ticket language and LLM version', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      ...ticket,
      subject: 'Tidak bisa login',
      message: 'Saya tidak bisa login ke akun saya sejak tadi pagi',
    });

    await service.triage(job);

    const idScope = { ...scope, language: 'id' };
    expect(cache.getExact).toHaveBeenCalledWith(idScope, expect.any(String));
    expect(cache.findSimilar).toHaveBeenCalledWith(idScope, vector);
  });

  it('propagates LLM errors and leaves the ticket untouched', async () => {
    llm.triage.mockRejectedValue(new LlmError('rate limited', true));

    await expect(service.triage(job)).rejects.toThrow('rate limited');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(cache.store).not.toHaveBeenCalled();
  });

  it('skips tickets that were already triaged', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      ...ticket,
      aiStatus: 'completed',
    });

    await service.triage(job);

    expect(llm.triage).not.toHaveBeenCalled();
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('markFailed only touches pending tickets of the same organization', async () => {
    await service.markFailed(job, 'boom');

    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', organizationId: 'org-1', aiStatus: 'pending' },
      data: { aiStatus: 'failed', aiError: 'boom' },
    });
  });
});
