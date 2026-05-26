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
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET scheduled_send_at = ? WHERE id = ?`)
    .run(atIso, messageId);
}

export function listDueScheduledDraftIds(limit = 30): number[] {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      `SELECT id FROM ${EMAIL_MESSAGES_TABLE}
       WHERE uid < 0 AND folder_kind = 'draft' AND scheduled_send_at IS NOT NULL
         AND scheduled_send_at <= ? AND outbound_hold = 0
       ORDER BY scheduled_send_at ASC
       LIMIT ?`,
    )
    .all(now, limit) as { id: number }[];
  return rows.map((r) => r.id);
}

export async function exportMessageAsEml(messageId: number): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const row = getEmailMessageById(messageId);
  if (!row) return { ok: false, error: 'Nachricht nicht gefunden' };
  const attachments = listAttachmentsForMessage(messageId);
  const { eml, meta } = buildEmlForMessage(row, attachments);
  if (!eml.trim()) {
    return { ok: false, error: 'Keine RFC822-Daten für diese Nachricht gespeichert' };
  }
  const subj = (row.subject ?? 'nachricht').replace(/[^\w.-]+/g, '_').slice(0, 60);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'E-Mail als .eml speichern',
    defaultPath: `${subj}.eml`,
    filters: [{ name: 'E-Mail', extensions: ['eml'] }],
  });
  if (canceled || !filePath) return { ok: false, error: 'Abgebrochen' };
  const buf =
    meta.source === 'original' && row.raw_rfc822_b64?.trim()
      ? Buffer.from(row.raw_rfc822_b64, 'base64')
      : Buffer.from(eml, 'utf8');
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
export const SNOOZE_FILTER_SQL = `(m.snoozed_until IS NULL OR m.snoozed_until <= datetime('now'))`;

/** Only messages currently snoozed (for „Zurückgestellt“ view). */
export const SNOOZE_ACTIVE_SQL = `(m.snoozed_until IS NOT NULL AND m.snoozed_until > datetime('now'))`;

/** Same as SNOOZE_FILTER_SQL without table alias (folder count queries). */
export const SNOOZE_FILTER_SQL_BARE = `(snoozed_until IS NULL OR snoozed_until <= datetime('now'))`;

export const SNOOZE_ACTIVE_SQL_BARE = `(snoozed_until IS NOT NULL AND snoozed_until > datetime('now'))`;
