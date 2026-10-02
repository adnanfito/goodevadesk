import { ApiError } from '@google/genai';
import type { Env } from '../../config/env';
import { LlmError } from './llm.provider';
import { ConfigService } from '@nestjs/config';
import {
  GeminiProvider,
  parseTriageResponse,
  toLlmError,
} from './gemini.provider';

describe('parseTriageResponse', () => {
  it('parses a valid structured response', () => {
    expect(
      parseTriageResponse(
        JSON.stringify({ category: 'billing', suggested_reply: ' Hi there ' }),
      ),
    ).toEqual({ category: 'billing', suggestedReply: 'Hi there' });
  });

  it.each([
    ['empty output', undefined],
    ['non-JSON output', 'Sure! The category is billing.'],
    [
      'unknown category',
      JSON.stringify({ category: 'sales', suggested_reply: 'Hi' }),
    ],
    ['missing reply', JSON.stringify({ category: 'general' })],
    [
      'blank reply',
      JSON.stringify({ category: 'general', suggested_reply: '   ' }),
    ],
  ])('rejects %s as a non-retryable error', (_label, text) => {
    expect.assertions(2);
    try {
      parseTriageResponse(text);
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).retryable).toBe(false);
    }
  });
});

describe('toLlmError', () => {
  const apiError = (status: number) =>
    new ApiError({ message: `status ${status}`, status });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
  ])('maps HTTP %i to retryable=%s', (status, retryable) => {
    expect(toLlmError(apiError(status), 1000).retryable).toBe(retryable);
  });

  it('treats timeouts as retryable', () => {
    const timeout = new DOMException('signal timed out', 'TimeoutError');
    const err = toLlmError(timeout, 1500);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('1500ms');
  });

  it('treats network failures as retryable', () => {
    expect(toLlmError(new TypeError('fetch failed'), 1000).retryable).toBe(
      true,
    );
  });
});

describe('GeminiProvider.cacheVersion', () => {
  const provider = (model: string) => {
    const values: Record<string, unknown> = {
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: model,
      LLM_TIMEOUT_MS: 1000,
      LLM_TEMPERATURE: 0.2,
    };
    const config = { get: (key: string) => values[key] };
    return new GeminiProvider(config as unknown as ConfigService<Env, true>);
  };

  it('is stable for the same model and prompt', () => {
    expect(provider('gemini-2.5-flash').cacheVersion).toBe(
      provider('gemini-2.5-flash').cacheVersion,
    );
  });

  it('changes when the model changes', () => {
    expect(provider('gemini-2.5-flash').cacheVersion).not.toBe(
      provider('gemini-2.5-pro').cacheVersion,
    );
  });
});
