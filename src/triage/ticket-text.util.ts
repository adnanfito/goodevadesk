import { createHash } from 'node:crypto';

/**
 * Canonical text used for both cache keys and embeddings, so trivial
 * differences (case, extra whitespace) still produce an exact cache hit.
 */
export function normalizeTicketText(subject: string, message: string): string {
  return `${subject}\n${message}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
