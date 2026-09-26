/**
 * Fingerprint des vom Ausgang endgültig angehaltenen Inhalts (TA-P2, Desktop):
 * „Ohne Ausgangsprüfung senden“ ist nur erlaubt, solange der gespeicherte
 * Entwurf diesem Inhalt entspricht (sync_info `outbound_hold_fingerprint:<id>`).
 * Eigenes Modul ohne Store-Abhängigkeiten, damit Store, Hold, Überspringen und
 * Versand es ohne Zyklen nutzen können.
 */
import { EMAIL_MESSAGES_TABLE, SYNC_INFO_TABLE } from '../database-schema';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import { outboundHoldFingerprint } from '../../packages/core/src/email/outbound-approval-marker';
import { outboundHoldFingerprintKey } from '../../packages/core/src/email/outbound-review-skip';

type DraftContentRow = {
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  to_json: string | null;
  cc_json: string | null;
  bcc_json?: string | null;
  draft_attachment_paths_json?: string | null;
};

/** Fingerprint des aktuell gespeicherten Entwurfs; null, wenn es ihn nicht gibt. */
export function currentOutboundHoldFingerprint(draftId: number): string | null {
  const row = getDb()
    .prepare(`SELECT * FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(draftId) as DraftContentRow | undefined;
  if (!row) return null;
  return outboundHoldFingerprint({
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    to: row.to_json,
    cc: row.cc_json,
    bcc: row.bcc_json ?? null,
    attachments: row.draft_attachment_paths_json ?? null,
  });
}

/** Nach dem endgültigen Anhalten: den angehaltenen Inhalt festhalten. */
export function storeOutboundHoldFingerprint(draftId: number): void {
  const fingerprint = currentOutboundHoldFingerprint(draftId);
  if (fingerprint) setSyncInfo(outboundHoldFingerprintKey(draftId), fingerprint);
}

/** Gespeicherter Fingerprint; null = keiner (Altbestand). */
export function readOutboundHoldFingerprint(draftId: number): string | null {
  const value = getSyncInfo(outboundHoldFingerprintKey(draftId));
  return value?.trim() ? value : null;
}

/** Aufräumen wie beim Freigabe-Marker: Versand, Freigabe, Löschen. */
export function clearOutboundHoldFingerprints(...draftIds: number[]): void {
  if (draftIds.length === 0) return;
  const del = getDb().prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = ?`);
  for (const id of draftIds) del.run(outboundHoldFingerprintKey(id));
}
