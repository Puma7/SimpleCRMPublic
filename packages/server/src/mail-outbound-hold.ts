import {
  composeOutboundHeldDraftBody,
  extractDraftBodyForOutboundBlock,
  outboundHoldReasonOrFallback,
} from '@simplecrm/core';

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
    .select(['uid', 'folder_kind', 'body_text', 'body_html'])
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
  return reason;
}

function snippetFromPlain(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}
