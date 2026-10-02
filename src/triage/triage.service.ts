import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CacheScope,
  SemanticCacheService,
} from './cache/semantic-cache.service';
import { EmbeddingService } from './embedding/embedding.service';
import {
  LLM_PROVIDER,
  type LlmProvider,
  type TriageResult,
} from './llm/llm.provider';
import type { TriageJobData } from './triage.constants';
import { detectTicketLanguage } from './language.util';
import { hashText, normalizeTicketText } from './ticket-text.util';

interface ResolvedTriage {
  result: TriageResult;
  source: AiSource;
}

/**
 * Pipeline per ticket: exact cache → semantic cache → LLM.
 * Cache lookups are scoped to organization, ticket language and LLM version.
 * Cache and embedding failures are logged and skipped (best-effort);
 * only LLM errors propagate, so the queue can decide whether to retry.
 */
@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SemanticCacheService,
    private readonly embeddings: EmbeddingService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async triage({ ticketId, organizationId }: TriageJobData): Promise<void> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, organizationId },
    });
    if (!ticket) {
      this.logger.warn(`Ticket ${ticketId} no longer exists, skipping`);
      return;
    }
    if (ticket.aiStatus === 'completed') return;

    const { result, source } = await this.resolve(
      organizationId,
      ticket.subject,
      ticket.message,
    );

    await this.prisma.ticket.updateMany({
      where: { id: ticketId, organizationId },
      data: {
        category: result.category,
        suggestedReply: result.suggestedReply,
        aiStatus: 'completed',
        aiSource: source,
        aiError: null,
      },
    });
    this.logger.log(
      `Ticket ${ticketId} triaged as ${result.category} (source=${source})`,
    );
  }

  /** Called once the queue gives up, so the ticket never stays "pending". */
  async markFailed(
    { ticketId, organizationId }: TriageJobData,
    reason: string,
  ): Promise<void> {
    await this.prisma.ticket.updateMany({
      where: { id: ticketId, organizationId, aiStatus: 'pending' },
      data: { aiStatus: 'failed', aiError: reason.slice(0, 500) },
    });
  }

  private async resolve(
    organizationId: string,
    subject: string,
    message: string,
  ): Promise<ResolvedTriage> {
    const text = normalizeTicketText(subject, message);
    const textHash = hashText(text);
    const scope: CacheScope = {
      organizationId,
      language: detectTicketLanguage(text),
      version: this.llm.cacheVersion,
    };

    const exact = await this.bestEffort('exact cache lookup', () =>
      this.cache.getExact(scope, textHash),
    );
    if (exact) return { result: exact, source: 'cache_exact' };

    const vector = await this.bestEffort('embedding', () =>
      this.embeddings.embed(text),
    );
    if (vector) {
      const similar = await this.bestEffort('semantic cache lookup', () =>
        this.cache.findSimilar(scope, vector),
      );
      if (similar) {
        this.logger.debug(
          `Semantic cache hit (similarity=${similar.similarity.toFixed(3)})`,
        );
        return { result: similar.result, source: 'cache_semantic' };
      }
    }

    const result = await this.llm.triage({ subject, message });

    await this.bestEffort('cache store', () =>
      this.cache.store(scope, textHash, vector, result),
    );
    return { result, source: 'llm' };
  }

  private async bestEffort<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${label} failed, continuing without it: ${message}`);
      return null;
    }
  }
}
