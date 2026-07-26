import { sql as kyselySql } from 'kysely';
import {
  addressesFromRecipientJson,
  extractDraftBodyForOutboundBlock,
  normalizeEmailAddress,
} from '@simplecrm/core';

import type { WorkspaceTransaction } from './db/workspace-context';
import { autoSubmittedDraftKey } from './mail-compose-send';
import { persistManualOutboundApproval } from './mail-outbound-approval-store';
import { clearDraftApproval } from './workflow-ai-draft-nodes';

export type DraftApprovalActionResult =
  | { success: true }
  | { success: false; error: string };

type ApprovalDraftRow = Readonly<{
  id: number;
  uid: number;
  folder_kind: string | null;
  approval_state: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  to_json: unknown;
  cc_json: unknown;
  bcc_json: unknown;
  draft_attachment_paths_json: unknown;
  ticket_code: string | null;
  account_id: number | string | null;
  reply_parent_message_id: number | null;
}>;

function recipientFieldFromStoredJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value);
    return addressesFromRecipientJson(asString);
  } catch {
    return '';
  }
}

function firstRecipientAddress(value: unknown): string {
  return recipientFieldFromStoredJson(value).split(',')[0]?.trim() ?? '';
}

/** "Jetzt senden": plant den freigegebenen KI-Entwurf zum Versand ein. */
export async function approveDraftSendInTransaction(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    actorUserId: string;
    draftId: number;
    now?: Date;
  },
): Promise<DraftApprovalActionResult> {
  const now = input.now ?? new Date();
  const draft = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'uid',
      'folder_kind',
      'approval_state',
      'scheduled_send_at',
      'subject',
      'body_text',
      'body_html',
      'to_json',
      'cc_json',
      'bcc_json',
      'draft_attachment_paths_json',
      'ticket_code',
      'account_id',
      'reply_parent_message_id',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .forUpdate()
    .executeTakeFirst() as (ApprovalDraftRow & { scheduled_send_at: Date | string | null }) | undefined;

  if (!draft) return { success: false, error: 'Entwurf nicht gefunden' };
  if (draft.approval_state !== 'pending') {
    return {
      success: false,
      error: 'Entwurf wartet nicht (mehr) auf Freigabe — bitte Ansicht aktualisieren.',
    };
  }
  if (draft.scheduled_send_at != null) {
    return {
      success: false,
      error: 'Entwurf ist bereits zum Versand eingeplant — bitte Ansicht aktualisieren.',
    };
  }
  if (draft.folder_kind !== 'draft' || Number(draft.uid) >= 0) {
    return { success: false, error: `Nachricht ${input.draftId} ist kein Entwurf` };
  }

  const cleaned = extractDraftBodyForOutboundBlock({
    body_text: draft.body_text ?? null,
    body_html: draft.body_html ?? null,
  });
  const subject = draft.subject?.trim() || '(Ohne Betreff)';
  const to = recipientFieldFromStoredJson(draft.to_json);
  const cc = recipientFieldFromStoredJson(draft.cc_json) || null;
  const bcc = recipientFieldFromStoredJson(draft.bcc_json) || null;
  // Validate recipients before mutating approval/schedule — otherwise a draft
  // without To clears pending approval, the API reports success, and
  // processScheduledDraft only releases the claim without sending.
  if (!to.trim()) {
    return { success: false, error: 'Empfänger fehlt — Freigabe bleibt bestehen.' };
  }

  try {
    await persistManualOutboundApproval(trx, {
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      subject,
      bodyText: cleaned.plain,
      bodyHtml: cleaned.html,
      to,
      cc,
      bcc,
      draftSnapshot: draft,
      now,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }

  await trx
    .updateTable('email_messages')
    .set({
      scheduled_send_at: now,
      scheduled_send_actor_user_id: input.actorUserId,
      scheduled_send_trusted_service_principal: null,
      auto_submitted: 1,
      updated_at: now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .execute();

  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key: autoSubmittedDraftKey(input.draftId),
      value: '1',
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: '1',
      last_updated: now,
      updated_at: now,
    }))
    .execute();

  const accountId = Number(draft.account_id);
  const recipient = normalizeEmailAddress(firstRecipientAddress(draft.to_json));
  if (Number.isInteger(accountId) && accountId > 0 && recipient) {
    await markServerAutoReplySentUnconditionally(trx, {
      workspaceId: input.workspaceId,
      accountId,
      recipient,
      sourceMessageId: draft.reply_parent_message_id ?? null,
      draftMessageId: input.draftId,
      now,
    });
  }

  await clearDraftApproval(trx, input.workspaceId, input.draftId);
  return { success: true };
}

/** "Als Entwurf behalten": Mensch übernimmt — kein Auto-Versand. */
export async function dismissDraftApprovalInTransaction(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; draftId: number; now?: Date },
): Promise<DraftApprovalActionResult> {
  const now = input.now ?? new Date();
  const draft = await trx
    .selectFrom('email_messages')
    .select(['id', 'approval_state', 'scheduled_send_at'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .forUpdate()
    .executeTakeFirst();
  if (!draft) return { success: false, error: 'Entwurf nicht gefunden' };
  if (draft.approval_state !== 'pending') {
    return {
      success: false,
      error: 'Entwurf wartet nicht (mehr) auf Freigabe — bitte Ansicht aktualisieren.',
    };
  }
  if (draft.scheduled_send_at != null) {
    return {
      success: false,
      error: 'Entwurf ist bereits zum Versand eingeplant — bitte Ansicht aktualisieren.',
    };
  }

  await clearDraftApproval(trx, input.workspaceId, input.draftId);
  await trx
    .updateTable('email_messages')
    .set({ auto_submitted: 0, updated_at: now })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .execute();
  await trx
    .deleteFrom('sync_info')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', autoSubmittedDraftKey(input.draftId))
    .execute();
  return { success: true };
}

async function markServerAutoReplySentUnconditionally(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    accountId: number;
    recipient: string;
    sourceMessageId: number | null;
    draftMessageId: number;
    now: Date;
  },
): Promise<void> {
  const replyDay = input.now.toISOString().slice(0, 10);
  await trx
    .insertInto('email_auto_reply_daily_counters')
    .values({
      workspace_id: input.workspaceId,
      account_id: input.accountId,
      recipient: input.recipient,
      reply_day: replyDay,
      reply_count: 0,
      last_source_message_id: null,
      last_draft_message_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'account_id', 'recipient', 'reply_day'])
      .doNothing())
    .execute();

  await trx
    .updateTable('email_auto_reply_daily_counters')
    .set({
      reply_count: kyselySql<number>`reply_count + 1`,
      last_source_message_id: input.sourceMessageId,
      last_draft_message_id: input.draftMessageId,
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('account_id', '=', input.accountId)
    .where('recipient', '=', input.recipient)
    .where('reply_day', '=', replyDay)
    .execute();
}

function serverApiSourceRow() {
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}
