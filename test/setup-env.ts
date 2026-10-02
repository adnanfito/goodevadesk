// Runs before AppModule is imported (ConfigModule validates env at import).
// The real LLM is replaced by a fake in the e2e suite, so any key works.
process.env.GEMINI_API_KEY ||= 'e2e-fake-key';
process.env.LLM_MAX_ATTEMPTS = '3';
process.env.LLM_RETRY_BASE_DELAY_MS = '50';
