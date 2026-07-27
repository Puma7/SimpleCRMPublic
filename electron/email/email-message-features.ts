import fs from 'fs';
import { dialog } from 'electron';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getEmailMessageById } from './email-store';
import { listAttachmentsForMessage } from './email-message-attachments-store';
import { buildEmlForMessage } from './mail-eml-build';

export function setMessageSnoozedUntil(messageId: number, untilIso: string | null): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET snoozed_until = ? WHERE id = ?`)
    .run(untilIso, messageId);
}

export function setDraftScheduledSendAt(messageId: number, atIso: string | null): void {
  if (atIso) {
    getDb()
      .prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE}
         SET scheduled_send_at = ?, outbound_hold = 0, outbound_block_reason = NULL
         WHERE id = ?`,
      )
      .run(atIso, messageId);
    return;
  }
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET scheduled_send_at = ? WHERE id = ?`)
    .run(atIso, messageId);
}

/** Faelligkeitsbedingung — geteilt, damit Liste und Nachpruefung nicht driften. */
const DUE_SCHEDULED_SEND_WHERE = `uid < 0 AND folder_kind = 'draft' AND scheduled_send_at IS NOT NULL
         AND scheduled_send_at <= ? AND outbound_hold = 0`;

export function listDueScheduledDraftIds(limit = 30): number[] {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      `SELECT id FROM ${EMAIL_MESSAGES_TABLE}
       WHERE ${DUE_SCHEDULED_SEND_WHERE}
       ORDER BY scheduled_send_at ASC
       LIMIT ?`,
    )
    .all(now, limit) as { id: number }[];
  return rows.map((r) => r.id);
}

/**
 * Ist dieser Entwurf JETZT noch fällig?
 *
 * `listDueScheduledDraftIds` liefert einen Schnappschuss. Wartet die Sendeschleife
 * anschließend am SMTP-Aufruf für einen früheren Entwurf, kann die Gegenlese-KI
 * einen späteren aus derselben Liste auf „Wartet auf Freigabe" stempeln und
 * dessen `scheduled_send_at` löschen — zu diesem Zeitpunkt stand unser Claim für
 * ihn noch nicht, sie kommt also durch. Ohne diese Nachprüfung ginge genau der
 * zurückgehaltene Entwurf trotzdem raus.
 */
export function scheduledSendIsStillDue(draftId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM ${EMAIL_MESSAGES_TABLE}
       WHERE ${DUE_SCHEDULED_SEND_WHERE} AND id = ?`,
    )
    .get(new Date().toISOString(), draftId) as { ok: number } | undefined;
  return row !== undefined;
}

export async function exportMessageAsEml(messageId: number): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const row = getEmailMessageById(messageId);
  if (!row) return { ok: false, error: 'Nachricht nicht gefunden' };
  const attachments = listAttachmentsForMessage(messageId);
  const { eml, meta } = buildEmlForMessage(row, attachments);
  const rawB64 = row.raw_rfc822_b64?.trim();
  if (!eml.trim() && !rawB64) {
    return { ok: false, error: 'Keine RFC822-Daten für diese Nachricht gespeichert' };
  }
  const subj = (row.subject ?? 'nachricht').replace(/[^\w.-]+/g, '_').slice(0, 60);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'E-Mail als .eml speichern',
    defaultPath: `${subj}.eml`,
    filters: [{ name: 'E-Mail', extensions: ['eml'] }],
  });
  if (canceled || !filePath) return { ok: false, error: 'Abgebrochen' };
  const useRaw =
    Boolean(rawB64) && (meta.source === 'original' || !eml.trim());
  const buf = useRaw ? Buffer.from(rawB64!, 'base64') : Buffer.from(eml, 'utf8');
  fs.writeFileSync(filePath, buf);
  return { ok: true, path: filePath };
}

export function messageLooksEncrypted(row: {
  raw_headers: string | null;
  body_text: string | null;
}): boolean {
  const h = (row.raw_headers ?? '').toLowerCase();
  if (h.includes('multipart/encrypted') || h.includes('application/pkcs7-mime')) return true;
  const body = (row.body_text ?? '').trim();
  return body.startsWith('-----BEGIN PGP MESSAGE-----');
}

/** Hide actively snoozed messages from normal mail views. */
export const SNOOZE_FILTER_SQL = `(m.snoozed_until IS NULL OR datetime(m.snoozed_until) <= datetime('now'))`;

/** Only messages currently snoozed (for „Zurückgestellt“ view). */
export const SNOOZE_ACTIVE_SQL = `(m.snoozed_until IS NOT NULL AND datetime(m.snoozed_until) > datetime('now'))`;

/** Same as SNOOZE_FILTER_SQL without table alias (folder count queries). */
export const SNOOZE_FILTER_SQL_BARE = `(snoozed_until IS NULL OR datetime(snoozed_until) <= datetime('now'))`;

export const SNOOZE_ACTIVE_SQL_BARE = `(snoozed_until IS NOT NULL AND datetime(snoozed_until) > datetime('now'))`;
