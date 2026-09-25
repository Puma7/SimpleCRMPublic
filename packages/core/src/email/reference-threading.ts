/**
 * Pure RFC-5322 reference-threading helpers used by the server sync thread
 * resolver. String-only so the server (Postgres) and the electron JWZ path
 * normalize Message-IDs identically — a normalization mismatch silently splits
 * conversations into separate threads.
 *
 * electron/email/email-threading-jwz.ts imports normalizeThreadingMessageId and
 * collectRelatedIds from here, so both editions link messages by the same ids.
 */

/** Cap on ids considered per message (shared with the electron JWZ path). */
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

/** Shortest Message-ID accepted for linking conversations ("x@y.z"). */
export const MIN_THREADING_MESSAGE_ID_LENGTH = 5;
/** RFC 5322 msg-id body: id-left "@" id-right, no brackets or whitespace. */
const THREADING_MESSAGE_ID_SHAPE = /^[^\s<>]+@[^\s<>]+$/;

/**
 * normalizeMessageId, but only for a plausible msg-id — the form used to LINK
 * messages into a thread. A sender-controlled bare token such as "com" must not
 * match unrelated conversations. (C-A62)
 */
export function normalizeThreadingMessageId(raw: string | null | undefined): string | null {
  const normalized = normalizeMessageId(raw);
  return normalized
    && normalized.length >= MIN_THREADING_MESSAGE_ID_LENGTH
    && THREADING_MESSAGE_ID_SHAPE.test(normalized)
    ? normalized
    : null;
}

/**
 * Split a References header into its plausible ids, in order. Brackets separate
 * ids like whitespace does ("<a@b><c@d>" is valid RFC 5322).
 */
export function parseReferenceIds(referencesHeader: string | null | undefined): string[] {
  if (!referencesHeader) return [];
  return referencesHeader
    .split(/[\s<>]+/)
    .map((token) => normalizeThreadingMessageId(token))
    .filter((id): id is string => id !== null);
}

/**
 * The plausible normalized ids that link a message to its thread: its own
 * Message-ID ∪ In-Reply-To ∪ References, deduped (Message-ID first) and capped
 * at MAX_THREAD_REF_IDS.
 */
export function collectRelatedIds(
  messageId: string | null | undefined,
  inReplyTo: string | null | undefined,
  referencesHeader: string | null | undefined,
): string[] {
  const ids = new Set<string>();
  const own = normalizeThreadingMessageId(messageId);
  if (own) ids.add(own);
  const parent = normalizeThreadingMessageId(inReplyTo);
  if (parent) ids.add(parent);
  for (const ref of parseReferenceIds(referencesHeader)) {
    if (ids.size >= MAX_THREAD_REF_IDS) break;
    ids.add(ref);
  }
  return [...ids];
}
