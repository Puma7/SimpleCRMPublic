/**
 * POP3 UIDL tracking: avoid unbounded `email_folders.pop3_uidl_str` growth.
 * Skip-Set comes from DB (`email_messages.pop3_uidl`); persisted JSON is only
 * the current server UIDL list (capped).
 */

/** Upper bound for serialized UIDL JSON on the folder row. */
export const POP3_UIDL_PERSIST_MAX = 20_000;

/** Serialize UIDLs reported by the server for this sync (sorted, deduped, capped). */
export function serializePop3ServerUidls(serverUidls: Iterable<string>): string {
  const sorted = [...new Set(serverUidls)].filter(Boolean).sort();
  if (sorted.length <= POP3_UIDL_PERSIST_MAX) {
    return JSON.stringify(sorted);
  }
  return JSON.stringify(sorted.slice(-POP3_UIDL_PERSIST_MAX));
}

/** Legacy folder JSON — parse only for migration logging; do not grow from this. */
export function parseLegacyPop3UidlStr(raw: string | null | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) out.add(item);
      if (out.size >= POP3_UIDL_PERSIST_MAX) break;
    }
    return out;
  } catch {
    return new Set();
  }
}
