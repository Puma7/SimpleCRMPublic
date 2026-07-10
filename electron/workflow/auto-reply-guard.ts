/**
 * Anti-Loop-Guard für vollautomatische KI-Antworten: begrenzt Antworten
 * pro Empfänger und Tag (Dedup-Tabelle, Muster email_vacation_reply_dedup).
 *
 * Geschlüsselt wird auf die Adresse, an die die Antwort tatsächlich GEHT
 * (Reply-To vor From) — nicht auf den sichtbaren From-Header: Ticket-/
 * VERP-Systeme wechseln From pro Nachricht (ticket-1@, ticket-2@, …) bei
 * konstantem Reply-To und würden sonst mit jedem "neuen" Absender ein
 * frisches Tagesbudget bekommen.
 *
 * Das Gate (email.auto_reply) prüft nur lesend (isAutoReplyRateLimited);
 * beim Einplanen reserviert email.send_draft den Slot ATOMAR
 * (tryReserveAutoReplySlot) — check-then-mark hätte ein Race-Fenster,
 * wenn Backfill und Live-Sync dieselbe Absenderin parallel verarbeiten.
 */
import { getDb } from '../sqlite-service';
import { EMAIL_AUTO_REPLY_DEDUP_TABLE } from '../database-schema';
import { normalizeEmailAddress } from '../../shared/email-address-normalize';
import { loadAutoReplyMaxPerSenderPerDay } from './auto-reply-settings';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Volle Normalisierung (Plus-Tags weg, Punycode-Domain): sonst umgeht
// bot+1@x.de / bot+2@x.de das Tageslimit mit je eigenem Budget.
function normalizeSender(sender: string): string {
  return normalizeEmailAddress(sender);
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

/**
 * Zählt eine Antwort BEDINGUNGSLOS gegen das Tagesbudget — für menschlich
 * freigegebene Sends (ApproveDraftSend): der Mensch wird nie blockiert,
 * aber nachfolgende AUTOMATISCHE Antworten an dieselbe Adresse respektieren
 * das verbrauchte Budget.
 */
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

/**
 * Reserviert atomar einen Antwort-Slot für den automatischen Versand.
 * False = Tageslimit erreicht (oder Adresse leer) → NICHT senden.
 *
 * Check und Inkrement passieren in EINEM bedingten UPDATE — zwei parallele
 * Läufe (z. B. Admin-Backfill neben Live-Sync) können so nie beide über das
 * Limit rutschen. Die Reservierung passiert VOR dem Einplanen; schlägt das
 * Einplanen danach fehl, bleibt der Slot verbraucht — bewusst fail-safe
 * ("lieber eine Antwort zu wenig als ein Loop").
 */
export function tryReserveAutoReplySlot(
  accountId: number,
  recipient: string,
  messageId: number | null,
): boolean {
  const s = normalizeSender(recipient);
  if (!s) return false;
  const limit = loadAutoReplyMaxPerSenderPerDay();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO ${EMAIL_AUTO_REPLY_DEDUP_TABLE}
       (account_id, sender, day, reply_count, last_message_id, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(account_id, sender, day) DO NOTHING`,
  ).run(accountId, s, today(), messageId, now);
  const result = db
    .prepare(
      `UPDATE ${EMAIL_AUTO_REPLY_DEDUP_TABLE}
       SET reply_count = reply_count + 1, last_message_id = ?, updated_at = ?
       WHERE account_id = ? AND sender = ? AND day = ? AND reply_count < ?`,
    )
    .run(messageId, now, accountId, s, today(), limit);
  return result.changes > 0;
}
