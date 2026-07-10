/**
 * Anti-Loop-Guard für vollautomatische KI-Antworten: begrenzt Antworten
 * pro Absender und Tag (Dedup-Tabelle, Muster email_vacation_reply_dedup).
 * Das Gate (email.auto_reply) prüft; markiert wird erst, wenn der Versand
 * tatsächlich eingeplant wurde (email.send_draft / draft-send-prep).
 */
import { getDb } from '../sqlite-service';
import { EMAIL_AUTO_REPLY_DEDUP_TABLE } from '../database-schema';
import { loadAutoReplyMaxPerSenderPerDay } from './auto-reply-settings';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSender(sender: string): string {
  return sender.trim().toLowerCase();
}

/** Wie viele automatische Antworten gingen heute schon an diesen Absender? */
export function autoReplyCountToday(accountId: number, sender: string): number {
  const row = getDb()
    .prepare(
      `SELECT reply_count FROM ${EMAIL_AUTO_REPLY_DEDUP_TABLE}
       WHERE account_id = ? AND sender = ? AND day = ?`,
    )
    .get(accountId, normalizeSender(sender), today()) as { reply_count: number } | undefined;
  return row?.reply_count ?? 0;
}

/** True, wenn das Tageslimit für diesen Absender bereits erreicht ist. */
export function isAutoReplyRateLimited(accountId: number, sender: string): boolean {
  const s = normalizeSender(sender);
  if (!s) return true;
  return autoReplyCountToday(accountId, s) >= loadAutoReplyMaxPerSenderPerDay();
}

/** Nach dem Einplanen des Versands aufrufen — zählt die Antwort. */
export function markAutoReplySent(
  accountId: number,
  sender: string,
  messageId: number | null,
): void {
  const s = normalizeSender(sender);
  if (!s) return;
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_AUTO_REPLY_DEDUP_TABLE}
         (account_id, sender, day, reply_count, last_message_id, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(account_id, sender, day)
       DO UPDATE SET reply_count = reply_count + 1,
                     last_message_id = excluded.last_message_id,
                     updated_at = excluded.updated_at`,
    )
    .run(accountId, s, today(), messageId, new Date().toISOString());
}
