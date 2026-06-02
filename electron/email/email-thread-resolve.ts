import { getDb } from '../sqlite-service';
import { EMAIL_THREAD_ALIASES_TABLE } from '../database-schema';
import type { EmailMessageRow } from './email-store';

export function canonicalThreadId(threadId: string): string {
  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
  } catch {
    return threadId;
  }
  if (!db) return threadId;
  let current = threadId;
  for (let i = 0; i < 8; i++) {
    const row = db
      .prepare(
        `SELECT canonical_thread_id FROM ${EMAIL_THREAD_ALIASES_TABLE} WHERE alias_thread_id = ?`,
      )
      .get(current) as { canonical_thread_id: string } | undefined;
    if (!row) break;
    current = row.canonical_thread_id;
  }
  return current;
}

export type ThreadConfidence = 'high' | 'medium' | 'low';

export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return '';
  let s = subject.trim().toLowerCase();
  for (let i = 0; i < 8; i++) {
    const stripped = s.replace(/^(re|fwd|fw|aw|wg):\s*/i, '').trim();
    if (stripped === s) break;
    s = stripped;
  }
  return s;
}

function senderKey(fromJson: string | null): string {
  if (!fromJson) return '';
  try {
    const p = JSON.parse(fromJson) as { value?: { address?: string }[] };
    return (p.value?.[0]?.address ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Plan order: ticket_code → imap_thread_id → thread_id → subject heuristic. */
export function resolveThreadListKey(
  m: Pick<
    EmailMessageRow,
    'id' | 'account_id' | 'ticket_code' | 'imap_thread_id' | 'thread_id' | 'subject' | 'from_json'
  >,
): { key: string; confidence: ThreadConfidence; resolver: string } {
  const ticket = m.ticket_code?.trim();
  if (ticket) {
    return { key: `ticket:${ticket}`, confidence: 'high', resolver: 'ticket_code' };
  }
  const imap = m.imap_thread_id?.trim();
  if (imap) {
    return {
      key: `imap:${m.account_id}:${imap}`,
      confidence: 'medium',
      resolver: 'imap_thread_id',
    };
  }
  const thread = m.thread_id?.trim();
  if (thread) {
    const canon = canonicalThreadId(thread);
    return { key: `thread:${canon}`, confidence: 'medium', resolver: 'thread_id' };
  }
  const norm = normalizeSubject(m.subject);
  const from = senderKey(m.from_json);
  if (norm && from) {
    return {
      key: `heur:${norm}|${from}`,
      confidence: 'low',
      resolver: 'normalized_subject',
    };
  }
  return { key: `m:${m.id}`, confidence: 'low', resolver: 'singleton' };
}
