import {
  determineSentProvenance,
  outboundReviewSkippedKey,
  type DraftOriginKind,
  type SentProvenance,
} from '@simplecrm/core';

import type { WorkspaceTransaction } from './db/workspace-context';
import { outboundReviewApprovedKey } from './mail-outbound-approval-store';
import { terminalInboundChildContext } from './workflow-inbound-chain-advance';

/**
 * Teilautomatisierung P3 (Server): Herkunft eines Entwurfs und Kennzeichnung
 * „gesendet von“. Bewusst eigene Helfer statt Änderungen in markDraftAsSent:
 * finalizeSentDraft ruft recordSentProvenance unmittelbar vor dem Übergang zu
 * folder_kind 'sent' auf, solange Freigabe- und Übersprung-Marker noch stehen.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wer versendet: Mensch (Compose, Planer, Freigabe) oder Workflow ohne Menschen (Trusted Service). */
export type ComposeSentByActor = { kind: 'human'; userId: string } | { kind: 'workflow' };

/**
 * Ein Workflow-Knoten hat den Entwurf angelegt (KI ⇒ 'ai', sonst 'workflow').
 * onlyIfUnset: send_draft/release_outbound überschreiben eine vorhandene
 * Herkunft (etwa 'ai' vom Entwurfs-Knoten) nicht.
 */
export async function markDraftOrigin(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    draftId: number;
    kind: DraftOriginKind;
    workflowId: number | null | undefined;
    onlyIfUnset?: boolean;
  },
): Promise<void> {
  let query = trx
    .updateTable('email_messages')
    .set({
      draft_origin_kind: input.kind,
      draft_origin_workflow_id: input.workflowId ?? null,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .where('uid', '<', 0);
  if (input.onlyIfUnset) query = query.where('draft_origin_kind', 'is', null);
  await query.execute();
}

/** Workflow eines asynchronen KI-Jobs (Fortsetzung oder terminaler Kettenschritt). */
export function workflowIdFromAiJob(input: {
  continuation?: { workflowId?: number } | null;
  terminalChainPayload?: Record<string, unknown> | null;
}): number | null {
  const fromContinuation = input.continuation?.workflowId;
  if (Number.isSafeInteger(fromContinuation) && Number(fromContinuation) > 0) return Number(fromContinuation);
  const terminal = input.terminalChainPayload ? terminalInboundChildContext(input.terminalChainPayload) : null;
  return terminal?.workflowId ?? null;
}

/**
 * Bestimmt die Kennzeichnung und schreibt sie an die Mail. Übersprungen gilt
 * der Versand nur, solange der Übersprung-Marker dem aktuellen Freigabe-Marker
 * entspricht (eine spätere Änderung hätte den Freigabe-Marker entwertet).
 */
export async function recordSentProvenance(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; messageId: number; sentBy: ComposeSentByActor; now: Date },
): Promise<SentProvenance | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(['draft_origin_kind', 'draft_origin_workflow_id', 'draft_origin_edited'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!row) return null;

  const markers = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', input.workspaceId)
    .where('key', 'in', [outboundReviewSkippedKey(input.messageId), outboundReviewApprovedKey(input.messageId)])
    .execute();
  const skippedMarker = markers.find((marker) => marker.key === outboundReviewSkippedKey(input.messageId))?.value;
  const approvalMarker = markers.find((marker) => marker.key === outboundReviewApprovedKey(input.messageId))?.value;
  const originWorkflowId = row.draft_origin_workflow_id === null ? null : Number(row.draft_origin_workflow_id);

  let actor: Parameters<typeof determineSentProvenance>[0]['actor'];
  if (input.sentBy.kind === 'human') {
    // users.id ist uuid: ein anderer Wert (Automations-Schlüssel, Altbestand)
    // würde die Transaktion abbrechen — dann fehlt nur der Anzeigename.
    const user = UUID_PATTERN.test(input.sentBy.userId)
      ? await trx
        .selectFrom('users')
        .select('display_name')
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.sentBy.userId)
        .executeTakeFirst()
      : undefined;
    actor = { kind: 'human', userId: input.sentBy.userId, userLabel: user?.display_name ?? null };
  } else {
    const workflow = originWorkflowId === null
      ? undefined
      : await trx
        .selectFrom('email_workflows')
        .select('name')
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', originWorkflowId)
        .executeTakeFirst();
    actor = { kind: 'workflow', workflowId: null, workflowName: workflow?.name ?? null };
  }

  const provenance = determineSentProvenance({
    actor,
    draftOriginKind: row.draft_origin_kind,
    draftOriginWorkflowId: originWorkflowId,
    draftOriginEdited: row.draft_origin_edited === true,
    outboundReviewSkipped: Boolean(skippedMarker) && skippedMarker === approvalMarker,
  });
  await trx
    .updateTable('email_messages')
    .set({
      sent_by_kind: provenance.kind,
      sent_by_user_id: provenance.userId,
      sent_by_workflow_id: provenance.workflowId,
      sent_by_label: provenance.label,
      sent_outbound_review_skipped: provenance.outboundReviewSkipped,
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .execute();
  await trx
    .deleteFrom('sync_info')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', outboundReviewSkippedKey(input.messageId))
    .execute();
  return provenance;
}
