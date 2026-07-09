/**
 * Pure RFC-5322 reference-threading helpers used by the server sync thread
 * resolver. String-only so the server (Postgres) and the electron JWZ path
 * normalize Message-IDs identically — a normalization mismatch silently splits
 * conversations into separate threads.
 *
 * Mirrors electron/email/email-threading-jwz.ts (normId / parseReferences /
 * collectRelatedIds). Keep the two in lockstep; the parity is asserted in tests.
 */

/** Cap on ids considered per message (matches the electron JWZ path). */
export const MAX_THREAD_REF_IDS = 64;

/**
 * Normalize a single Message-ID for MATCHING (not for emitting headers): trim,
 * strip a single leading `<` / trailing `>`, lowercase. Empty → null.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/^<|>$/g, '').toLowerCase();
  return normalized || null;
}

/** Split a References header on whitespace and normalize each id, in order. */
export function parseReferenceIds(referencesHeader: string | null | undefined): string[] {
  if (!referencesHeader) return [];
  return referencesHeader
    .split(/\s+/)
    .map((token) => normalizeMessageId(token))
    .filter((id): id is string => id !== null);
}

/**
 * The normalized ids that link a message to its thread: its own Message-ID ∪
 * In-Reply-To ∪ References, deduped (Message-ID first) and capped at
 * MAX_THREAD_REF_IDS.
 */
export function collectRelatedIds(
  messageId: string | null | undefined,
  inReplyTo: string | null | undefined,
  referencesHeader: string | null | undefined,
): string[] {
  const ids = new Set<string>();
  const own = normalizeMessageId(messageId);
  if (own) ids.add(own);
  const parent = normalizeMessageId(inReplyTo);
  if (parent) ids.add(parent);
  for (const ref of parseReferenceIds(referencesHeader)) {
    if (ids.size >= MAX_THREAD_REF_IDS) break;
    ids.add(ref);
  }
  return [...ids];
}
