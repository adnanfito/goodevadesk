import { createHash, randomBytes } from 'node:crypto';

/** API keys are stored as SHA-256 digests so a DB leak does not leak keys. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export function generateApiKey(): string {
  return `gdk_${randomBytes(24).toString('base64url')}`;
}
