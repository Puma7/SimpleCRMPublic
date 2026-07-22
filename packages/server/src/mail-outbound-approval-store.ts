import { sql as kyselySql, type RawBuilder } from 'kysely';
import {
  addressesFromRecipientJson,
  encodeOutboundApprovalMarker,
  ensureTicketInSubject,
  extractDraftBodyForOutboundBlock,
  generateTicketCode,
  outboundDraftFingerprint,
} from '@simplecrm/core';

import { buildDefaultServerAccountMailSettings } from './account-mail-settings-defaults';
import type { WorkspaceTransaction } from './db/workspace-context';
import { extractWorkspaceTicketFromSubject, listWorkspaceTicketPrefixes } from './mail-ticket-prefixes';

export const OUTBOUND_REVIEW_APPROVED_PREFIX = 'outbound_review_approved:';

export function outboundReviewApprovedKey(draftId: number): string {
  return `${OUTBOUND_REVIEW_APPROVED_PREFIX}${draftId}`;
}

type OutboundApprovalDraftSnapshot = Readonly<{
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  to_json?: unknown | null;
  cc_json: unknown | null;
  bcc_json: unknown | null;
  draft_attachment_paths_json: unknown | null;
  ticket_code: string | null;
  account_id: number | string | null;
}>;

function addressesFromStoredRecipientJson(value: unknown): string {
  if (!value) return '';
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value);
    return addressesFromRecipientJson(asString);
  } catch {
    return '';
  }
}

function draftAttachmentPathsFromJson(value: unknown): readonly string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (!Array.isArray(parsed)) return [];
    const paths: string[] = [];
    for (const item of parsed) {
      const path = typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object'
          ? String((item as { path?: unknown }).path ?? '').trim()
          : '';
      if (path && !paths.includes(path)) paths.push(path);
    }
    return paths;
  } catch {
    return [];
  }
}

async function allocateOutboundApprovalTicketCode(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | string | null,
  now: Date,
): Promise<string> {
  if (accountId == null) return generateTicketCode();
  const numericAccountId = Number(accountId);
  if (!Number.isSafeInteger(numericAccountId) || numericAccountId <= 0) return generateTicketCode();
  const account = await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id', 'display_name', 'email_address'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', numericAccountId)
    .executeTakeFirst();
  if (!account) return generateTicketCode();
  const defaultSettings = buildDefaultServerAccountMailSettings({
    id: numericAccountId,
    displayName: account.display_name ?? '',
    emailAddress: account.email_address ?? '',
  });
  const defaultPrefix = defaultSettings.ticketPrefix;
  await trx
    .insertInto('email_account_mail_settings')
    .values({
      workspace_id: workspaceId,
      account_source_sqlite_id: Number(account.source_sqlite_id ?? numericAccountId),
      account_id: numericAccountId,
      ticket_prefix: defaultPrefix,
      ticket_next_number: defaultSettings.ticketNextNumber,
      ticket_number_padding: defaultSettings.ticketNumberPadding,
      thread_namespace: defaultSettings.threadNamespace,
      source_row: { source: 'server.compose.outbound_approval' },
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'account_id']).doNothing())
    .execute();
  const settings = await trx
    .selectFrom('email_account_mail_settings')
    .select(['ticket_prefix', 'ticket_next_number', 'ticket_number_padding'])
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', numericAccountId)
    .forUpdate()
    .executeTakeFirst();
  if (!settings) return generateTicketCode({ prefix: defaultPrefix });
  const currentNumber = Number(settings.ticket_next_number);
  const padding = Math.min(12, Math.max(1, Math.floor(Number(settings.ticket_number_padding) || 6)));
  const ticketCode = generateTicketCode({
    prefix: settings.ticket_prefix || defaultPrefix,
    sequence: String(Math.max(1, currentNumber || 1)).padStart(padding, '0'),
  });
  await trx
    .updateTable('email_account_mail_settings')
    .set({ ticket_next_number: Math.max(1, currentNumber || 1) + 1, updated_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', numericAccountId)
    .execute();
  return ticketCode;
}

/** Persist a manual outbound approval after dry-run validation or schedule-time checks. */
export async function persistManualOutboundApproval(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    draftId: number;
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    to: string;
    cc?: string | null;
    bcc?: string | null;
    attachmentPaths?: readonly string[] | null;
    draftSnapshot?: OutboundApprovalDraftSnapshot | null;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const draftRow = input.draftSnapshot ?? await trx
    .selectFrom('email_messages')
    .select([
      'subject',
      'body_text',
      'body_html',
      'to_json',
      'cc_json',
      'bcc_json',
      'draft_attachment_paths_json',
      'ticket_code',
      'account_id',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .executeTakeFirst();

  const cleaned = extractDraftBodyForOutboundBlock(
    {
      body_text: draftRow?.body_text ?? null,
      body_html: draftRow?.body_html ?? null,
    },
    {
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
    },
  );
  const allowedPrefixes = await listWorkspaceTicketPrefixes(trx, input.workspaceId);
  const storedSubject = input.subject.trim() || draftRow?.subject?.trim() || '';
  const existingTicket = draftRow?.ticket_code?.trim()
    || extractWorkspaceTicketFromSubject(storedSubject, allowedPrefixes);
  const ticketCode = existingTicket || await allocateOutboundApprovalTicketCode(
    trx,
    input.workspaceId,
    draftRow?.account_id ?? null,
    now,
  );
  const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);
  const fingerprint = outboundDraftFingerprint({
    subject: finalSubject,
    bodyText: cleaned.plain,
    bodyHtml: cleaned.html,
    to: input.to,
    cc: input.cc ?? addressesFromStoredRecipientJson(draftRow?.cc_json),
    bcc: input.bcc ?? addressesFromStoredRecipientJson(draftRow?.bcc_json),
    attachmentPaths: input.attachmentPaths ?? draftAttachmentPathsFromJson(draftRow?.draft_attachment_paths_json),
  });
  const markerValue = encodeOutboundApprovalMarker(now, fingerprint);

  await trx
    .updateTable('email_messages')
    .set({
      outbound_hold: false,
      outbound_block_reason: null,
      body_text: cleaned.plain,
      body_html: cleaned.html || null,
      subject: finalSubject,
      ticket_code: ticketCode,
      updated_at: now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.draftId)
    .execute();

  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key: outboundReviewApprovedKey(input.draftId),
      value: markerValue,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: markerValue,
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}
