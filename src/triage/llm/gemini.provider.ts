import { createHash } from 'node:crypto';
import { ApiError, GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env';
import {
  LlmError,
  type LlmProvider,
  type TriageInput,
  type TriageResult,
} from './llm.provider';
import {
  PROMPT_FINGERPRINT,
  TRIAGE_RESPONSE_SCHEMA,
  TRIAGE_SYSTEM_PROMPT,
  buildTriageUserPrompt,
} from './prompts';

const triageResponseSchema = z.object({
  category: z.enum(['billing', 'technical', 'general']),
  suggested_reply: z.string().trim().min(1).max(2000),
});

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly cacheVersion: string;
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly temperature: number;

  constructor(config: ConfigService<Env, true>) {
    this.client = new GoogleGenAI({
      apiKey: config.get('GEMINI_API_KEY', { infer: true }),
      // Retries are owned by the BullMQ job (with backoff), not the SDK.
      httpOptions: { retryOptions: { attempts: 1 } },
    });
    this.model = config.get('GEMINI_MODEL', { infer: true });
    this.timeoutMs = config.get('LLM_TIMEOUT_MS', { infer: true });
    this.temperature = config.get('LLM_TEMPERATURE', { infer: true });
    this.cacheVersion = createHash('sha256')
      .update(`gemini:${this.model}:${PROMPT_FINGERPRINT}`)
      .digest('hex')
      .slice(0, 12);
  }

  async triage(input: TriageInput): Promise<TriageResult> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let text: string | undefined;
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: buildTriageUserPrompt(input),
        config: {
          systemInstruction: TRIAGE_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseJsonSchema: TRIAGE_RESPONSE_SCHEMA,
          temperature: this.temperature,
          abortSignal: signal,
        },
      });
      text = response.text;
    } catch (err) {
      // The SDK may wrap the abort in its own error type; the signal is the
      // reliable source of truth for "this was our timeout".
      throw toLlmError(err, this.timeoutMs, signal.aborted);
    }

    return parseTriageResponse(text);
  }
}

export function parseTriageResponse(text: string | undefined): TriageResult {
  if (!text) {
    // Empty output usually means a safety block or truncated generation.
    throw new LlmError('LLM returned an empty response', false);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new LlmError('LLM response is not valid JSON', false, { cause: err });
  }

  const parsed = triageResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new LlmError(
      `LLM response does not match schema: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
      false,
    );
  }

  return {
    category: parsed.data.category,
    suggestedReply: parsed.data.suggested_reply,
  };
}

export function toLlmError(
  err: unknown,
  timeoutMs: number,
  timedOut = false,
): LlmError {
  if (err instanceof LlmError) return err;

  // Duck-typed: AbortSignal throws a DOMException, which is not always an
  // `instanceof Error` across realms.
  const name = (err as { name?: unknown } | null)?.name;
  if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
    return new LlmError(`LLM request timed out after ${timeoutMs}ms`, true, {
      cause: err,
    });
  }

  if (err instanceof ApiError) {
    if (err.status === 429) {
      return new LlmError('LLM rate limit exceeded', true, { cause: err });
    }
    if (err.status === 408 || err.status >= 500) {
      return new LlmError(`LLM provider error (${err.status})`, true, {
        cause: err,
      });
    }
    // 400 / 401 / 403 / 404: retrying will not fix a bad key or model name.
    return new LlmError(`LLM request rejected (${err.status})`, false, {
      cause: err,
    });
  }

  // Network failures (DNS, connection reset, ...) are worth retrying.
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError(`LLM request failed: ${message}`, true, { cause: err });
}
