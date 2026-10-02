import type { TicketCategory } from '../../generated/prisma/enums';

export interface TriageResult {
  category: TicketCategory;
  suggestedReply: string;
}

export interface TriageInput {
  subject: string;
  message: string;
}

/**
 * Provider-agnostic contract so Gemini can be swapped (or mocked in tests)
 * without touching the triage pipeline.
 */
export interface LlmProvider {
  /**
   * Identifies provider + model + prompt. Cached results are namespaced by it,
   * so changing any of them never serves replies produced by the old setup.
   */
  readonly cacheVersion: string;
  triage(input: TriageInput): Promise<TriageResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/**
 * `retryable` tells the queue whether another attempt can help
 * (timeouts, rate limits, 5xx) or not (bad request, auth, malformed output).
 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}
