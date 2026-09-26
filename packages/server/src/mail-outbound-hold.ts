import {
  composeOutboundHeldDraftBody,
  extractDraftBodyForOutboundBlock,
  outboundHoldFingerprint,
  outboundHoldFingerprintKey,
  outboundHoldReasonOrFallback,
} from '@simplecrm/core';
import { sql } from 'kysely';

import type { WorkspaceTransaction } from './db/workspace-context';

/**
 * Hinweistext des Zwischenzustands „Prüfung läuft“: compose/send hat den
 * Entwurf angehalten und die Ausgangs-Workflows als Jobs gestartet. Kein
 * endgültiger Block — die Planung eines Workflow-Versands bleibt stehen.
 */
export const OUTBOUND_REVIEW_PENDING_REASON =
  'Ausgangspruefung wird serverseitig ausgefuehrt; Versand bleibt blockiert, bis die Pruefung abgeschlossen ist.';

/**
 * Persistiert einen ENDGÜLTIGEN Ausgangs-Block (Workflow „Versand sperren“,
 * Block der KI-Prüfung, synchroner Block beim geplanten Versand) am Entwurf:
 *
 * - `outbound_hold` + echter Grund (leer ⇒ einheitlicher Fallback-Text),
 * - der Warn-Banner im Entwurf nennt den echten Grund (ein vorhandener Banner,
 *   etwa „Prüfung läuft“, wird ersetzt),
 * - Planung und Planungs-Provenienz fallen weg: der Posteingang zeigt
 *   angehaltene Entwürfe nur ohne scheduled_send_at, und ein erneuter
 *   automatischer Versand ohne menschliche Entscheidung wäre falsch.
 *
 * Nur lokale Entwürfe (uid < 0, folder_kind 'draft') bekommen Banner und
 * Planungs-Reset; andere Nachrichten (z. B. Prüfrunde einer Lesebestätigung
 * auf der eingegangenen Mail) nur Sperre und Grund wie bisher.
 *
 * Für lokale Entwürfe wird außerdem der Fingerprint des angehaltenen Inhalts
 * gespeichert (sync_info `outbound_hold_fingerprint:<id>`): „Ohne
 * Ausgangsprüfung senden“ gilt nur, solange der Inhalt unverändert ist.
 */
export async function persistOutboundBlockOnDraft(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    reason: string | null | undefined;
    now: Date;
  },
): Promise<string> {
  const reason = outboundHoldReasonOrFallback(input.reason);
  const row = await trx
    .selectFrom('email_messages')
    .select([
      'uid', 'folder_kind', 'body_text', 'body_html',
      'subject', 'to_json', 'cc_json', 'bcc_json', 'draft_attachment_paths_json',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!row) return reason;

  const localDraft = Number(row.uid) < 0 && row.folder_kind === 'draft';
  if (!localDraft) {
    await trx
      .updateTable('email_messages')
      .set({ outbound_hold: true, outbound_block_reason: reason, updated_at: input.now })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .execute();
    return reason;
  }

  const body = composeOutboundHeldDraftBody(
    extractDraftBodyForOutboundBlock({ body_text: row.body_text, body_html: row.body_html }),
    reason,
  );
  await trx
    .updateTable('email_messages')
    .set({
      outbound_hold: true,
      outbound_block_reason: reason,
      body_text: body.bodyText,
      body_html: body.bodyHtml,
      snippet: snippetFromPlain(body.plain) ?? reason,
      folder_kind: 'draft',
      seen_local: false,
      archived: false,
      is_spam: false,
      soft_deleted: false,
      scheduled_send_at: null,
      scheduled_send_actor_user_id: null,
      scheduled_send_trusted_service_principal: null,
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .execute();
  await storeOutboundHoldFingerprint(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    fingerprint: outboundHoldFingerprint({
      subject: row.subject,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
      to: row.to_json,
      cc: row.cc_json,
      bcc: row.bcc_json,
      attachments: row.draft_attachment_paths_json,
    }),
    now: input.now,
  });
  return reason;
}

/** Fingerprint des aktuell gespeicherten Entwurfsinhalts (Vergleich beim Überspringen). */
export async function currentOutboundHoldFingerprint(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; messageId: number },
): Promise<string | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(['subject', 'body_text', 'body_html', 'to_json', 'cc_json', 'bcc_json', 'draft_attachment_paths_json'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!row) return null;
  return outboundHoldFingerprint({
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    to: row.to_json,
    cc: row.cc_json,
    bcc: row.bcc_json,
    attachments: row.draft_attachment_paths_json,
  });
}

/** Gespeicherter Fingerprint des angehaltenen Inhalts; null = keiner (Altbestand). */
export async function readOutboundHoldFingerprint(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; messageId: number },
): Promise<string | null> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', outboundHoldFingerprintKey(input.messageId))
    .executeTakeFirst();
  return row?.value?.trim() ? row.value : null;
}

/** Aufräumen wie beim Freigabe-Marker: Versand, Freigabe, Löschen. */
export async function clearOutboundHoldFingerprints(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; messageIds: readonly number[] },
): Promise<void> {
  if (input.messageIds.length === 0) return;
  await trx
    .deleteFrom('sync_info')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', 'in', input.messageIds.map((id) => outboundHoldFingerprintKey(id)))
    .execute();
}

async function storeOutboundHoldFingerprint(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; messageId: number; fingerprint: string; now: Date },
): Promise<void> {
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key: outboundHoldFingerprintKey(input.messageId),
      value: input.fingerprint,
      last_updated: input.now,
      source_row: sql`'{"origin":"server_api"}'::jsonb`,
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: input.fingerprint,
      last_updated: input.now,
      updated_at: input.now,
    }))
    .execute();
}

function snippetFromPlain(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}
