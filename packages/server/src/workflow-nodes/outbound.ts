/**
 * Plan 043: Ausgangs-Knoten (anhalten, freigeben, senden, Entwurf, Auto-Antwort).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  addressesFromRecipientJson,
  encodeOutboundApprovalMarker,
  ensureTicketInSubject,
  extractDraftBodyForOutboundBlock,
  generateTicketCode,
  isUnsafeAutoReplyTarget,
  normalizeEmailAddress,
  outboundApprovalFingerprint,
  outboundHoldReasonOrFallback,
} from '@simplecrm/core';
import { sql } from 'kysely';
import { createPostgresComposeDraftInTransaction } from '../db/postgres-mail-read-ports';
import type { WorkspaceTransaction } from '../db/workspace-context';
import { TRUSTED_SERVICE_JOB_MARKER_VALUE } from '../jobs/policy';
import { autoSubmittedDraftKey, outboundReviewApprovedKey } from '../mail-compose-send';
import { READ_RECEIPT_REVIEW_ROUND_VARIABLE } from '../mail-read-receipt-responder';
import { markDraftOrigin } from '../mail-sent-provenance';
import { extractWorkspaceTicketFromSubject, listWorkspaceTicketPrefixes } from '../mail-ticket-prefixes';
import {
  fingerprintReviewedDraft,
  firstReplyAddress,
  setDraftApprovalPending,
} from '../workflow-ai-draft-nodes';
import { isInboundSiblingAborted } from '../workflow-inbound-chain-advance';
import { dryRunSideEffectResult } from './dry-run';
import {
  extractWorkflowEmailAddress,
  firstWorkflowRecipientAddress,
  hasSimpleEmailShape,
  inboundFanOutRunId,
  positiveIntegerVariable,
  serverWorkerSourceRow,
} from './shared';
import type { NodeResult, ServerNodeHandler, ServerNodeHandlerArgs, ServerWorkflowContext } from './types';

const AUTO_REPLY_ENABLED_KEY = 'auto_reply_enabled';

const AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY = 'auto_reply_max_per_sender_per_day';

const AUTO_REPLY_MAX_PER_SENDER_DEFAULT = 1;

// Anti-loop (RFC 3834 spirit): never auto-reply to automated/no-reply senders.
const AUTO_REPLY_NOREPLY_RE = /(^|[._+-])(no[._-]?reply|do[._-]?not[._-]?reply|mailer[._-]?daemon|postmaster|bounce|notifications?|automated)([._+-]|@)/i;

/** Knoten email.hold_outbound, hold_outbound. */
async function handleEmailHoldOutbound({ node, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const reason = outboundHoldReasonOrFallback(String(config.reason ?? node.data.reason ?? ''));
  return {
    status: 'ok',
    port: 'blocked',
    blocked: true,
    blockReason: reason,
    message: reason,
  };
}

/** Knoten email.release_outbound. */
async function handleEmailReleaseOutbound({ trx, context, config, log, now, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (dryRun) {
    return dryRunSideEffectResult('email.release_outbound', log, {
      message: 'dry_run:email.release_outbound',
    });
  }
  if (
    context.direction === 'inbound'
    && context.messageId !== null
    && await isInboundSiblingAborted(trx, {
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      workflowId: context.workflowId,
      chain: context.inboundWorkflowChain ?? null,
      fanOutRunId: inboundFanOutRunId(context),
    })
  ) {
    return {
      status: 'skipped',
      port: 'default',
      message: 'skip:sibling_terminal_abort',
    };
  }
  return await releaseWorkflowOutboundHold(trx, context, config, now);
}

/** Knoten email.send_draft. */
async function handleEmailSendDraft({ trx, context, config, log, now, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (dryRun) {
    return dryRunSideEffectResult('email.send_draft', log, { message: 'dry_run:email.send_draft' });
  }
  // Wie bei release_outbound: der Einstieg der Fortsetzung hat den Marker
  // schon gelesen, ein Geschwisterzweig kann die Kette seitdem gestoppt haben.
  if (
    context.direction === 'inbound'
    && context.messageId !== null
    && await isInboundSiblingAborted(trx, {
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      workflowId: context.workflowId,
      chain: context.inboundWorkflowChain ?? null,
      fanOutRunId: inboundFanOutRunId(context),
    })
  ) {
    return {
      status: 'skipped',
      port: 'default',
      message: 'skip:sibling_terminal_abort',
    };
  }
  return await sendWorkflowDraft(trx, context, config, now);
}

/** Knoten email.auto_reply. */
async function handleEmailAutoReply({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await evaluateWorkflowAutoReply(trx, context, config);
}

/** Knoten email.create_draft. */
async function handleEmailCreateDraft({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await createWorkflowComposeDraft(trx, context, config);
}

// Provenance columns for a workflow-armed scheduled send. When the run has an
// initiating user (compose-originated), attribute the send to THAT user so the
// scheduled-send ticker re-verifies their CURRENT mail.send at send time — a
// delegate who lost mail.send after the workflow was queued is then denied
// (fail-closed) instead of the send going out under the system principal. Only
// automatic/inbound runs with no actor keep trusted-service (system) provenance.
function scheduledSendProvenanceColumns(context: ServerWorkflowContext): {
  scheduled_send_actor_user_id: string | null;
  scheduled_send_trusted_service_principal: string | null;
} {
  return context.actorUserId
    ? { scheduled_send_actor_user_id: context.actorUserId, scheduled_send_trusted_service_principal: null }
    : { scheduled_send_actor_user_id: null, scheduled_send_trusted_service_principal: TRUSTED_SERVICE_JOB_MARKER_VALUE };
}

async function createWorkflowComposeDraft(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const accountId = positiveIntegerVariable(context.variables['email.account_id']);
  if (accountId === null) {
    return { status: 'error', port: 'error', message: 'Kein Konto fuer Entwurf' };
  }
  const prefix = typeof config.bodyPrefix === 'string' ? config.bodyPrefix : '';
  const body = [
    prefix.trim(),
    '---',
    context.strings.combined_text ?? '',
  ].filter((part) => part.length > 0).join('\n\n');
  // Antwort an Reply-To bzw. Absender der aktuellen Nachricht, verknuepft wie
  // bei ai.agent/ai.draft_reply — sonst kann email.send_draft den Entwurf nie
  // verschicken (kein Empfaenger) und er haengt an keinem Verlauf.
  const replyTo = context.message ? firstReplyAddress(context.message) : null;
  const draft = await createPostgresComposeDraftInTransaction(trx, {
    workspaceId: context.workspaceId,
    accountId,
    values: {
      accountId,
      subject: replySubject(context.strings.subject),
      bodyText: body,
      ...(replyTo ? { toJson: { value: [{ address: replyTo }] } } : {}),
    },
  });
  if (!draft.ok) {
    return { status: 'error', port: 'error', message: `Entwurf konnte nicht erstellt werden: ${draft.reason}` };
  }
  // TA-P3: Workflow-Entwurf (Kennzeichnung „gesendet von“).
  await markDraftOrigin(trx, {
    workspaceId: context.workspaceId,
    draftId: Number(draft.message.id),
    kind: 'workflow',
    workflowId: context.workflowId,
  });
  if (context.messageId !== null) {
    await trx
      .updateTable('email_messages')
      .set({ reply_parent_message_id: context.messageId })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', Number(draft.message.id))
      .execute();
  }
  return {
    status: 'ok',
    port: 'default',
    variables: { 'draft.id': draft.message.id },
  };
}

async function loadAutoReplyEnabled(trx: WorkspaceTransaction, workspaceId: string): Promise<boolean> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', AUTO_REPLY_ENABLED_KEY)
    .executeTakeFirst();
  const value = String(row?.value ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

async function loadAutoReplyMaxPerSenderPerDay(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY)
    .executeTakeFirst();
  const parsed = Number(row?.value ?? '');
  if (!Number.isFinite(parsed) || parsed < 1) return AUTO_REPLY_MAX_PER_SENDER_DEFAULT;
  return Math.min(50, Math.floor(parsed));
}

/**
 * P1-4 auto-reply policy gate. Decides whether a message MAY be answered
 * automatically — all guards must pass: the workspace-level auto-reply switch is
 * on, the configured confidence variable meets the threshold, and the sender is
 * not an automated/no-reply address (anti-loop). It exposes the decision on the
 * `approved`/`blocked` ports and as `auto_reply.*` variables. It intentionally
 * does NOT send yet — wiring the actual SMTP send (behind a separate live flag +
 * rate-limit) is the documented next step, so enabling guards can never cause an
 * accidental send.
 */
async function evaluateWorkflowAutoReply(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const confidenceVar = String(config.confidenceVar ?? 'ai.class_confidence').trim() || 'ai.class_confidence';
  const minConfidence = Math.max(0, Math.min(100, Number(config.minConfidence ?? 70) || 70));
  const rawConfidence = context.variables[confidenceVar];
  const confidence = typeof rawConfidence === 'number' ? rawConfidence : Number.parseFloat(String(rawConfidence ?? ''));
  const confidenceValue = Number.isFinite(confidence) ? confidence : 0;
  const sender = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';

  const block = (reason: string): NodeResult => ({
    status: 'ok',
    port: 'blocked',
    message: `auto_reply:blocked:${reason}`,
    variables: { 'auto_reply.decision': 'blocked', 'auto_reply.blocked_reason': reason, 'auto_reply.confidence': confidenceValue },
  });

  if (!context.message) return block('no_message');
  if (!(await loadAutoReplyEnabled(trx, context.workspaceId))) return block('disabled');
  if (!sender || AUTO_REPLY_NOREPLY_RE.test(sender)) return block('noreply_sender');
  // Anti-Loop wie im Desktop-Gate: automatisch erzeugte Mails (RFC 3834:
  // Auto-Submitted/X-Auto-Response-Suppress/Precedence) und Newsletter
  // (List-Header) nie automatisch beantworten. Das atomare Tageslimit wird
  // erst beim Einplanen in email.send_draft reserviert, um TOCTOU-Races zu vermeiden.
  if (isUnsafeAutoReplyTarget(context.message.raw_headers)) return block('automated_sender');
  if (confidenceValue < minConfidence) return block('low_confidence');

  return {
    status: 'ok',
    port: 'approved',
    message: 'auto_reply:approved',
    variables: { 'auto_reply.decision': 'approved', 'auto_reply.confidence': confidenceValue },
  };
}

/** Best-effort flatten of stored to_json/cc_json/bcc_json into a comma-joined
 *  address list, for the outbound-approval fingerprint (which compares against
 *  the same shape on the review side). addressesFromRecipientJson expects a
 *  JSON *string*, not a parsed object — jsonb columns typically come back as
 *  objects from kysely, so we re-stringify when needed. Passing a parsed object
 *  through caused JSON.parse to throw inside the helper, which then returned
 *  '' and broke the outbound auto-send approval marker (fingerprint mismatch). */
function addressesFromStoredRecipientJson(value: unknown): string {
  if (!value) return '';
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value);
    return addressesFromRecipientJson(asString);
  } catch {
    return '';
  }
}

/** Pull the attachment-paths list out of draft_attachment_paths_json (a stored
 *  string[] or null). Returns [] on any parse trouble. */
function draftAttachmentPathsFromJson(value: unknown): readonly string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

function replySubject(subject: string | null | undefined): string {
  const value = String(subject ?? '').trim();
  if (!value) return 'Re:';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

/**
 * Lifts an outbound hold (sets outbound_hold=false + clears the reason) on the
 * current message. Counterpart to email.hold_outbound; intended for the OK path
 * after ai.outbound_review approved a draft — without it an approved review
 * could never actually release the draft. Outbound-only.
 *
 * With config.autoSend=true it also (a) writes an approval marker into sync_info
 * so reviewOutbound.review bypasses the review on the *next* send call (avoiding
 * a re-entry loop from the scheduled-send cron) and (b) sets scheduled_send_at
 * = now so the scheduled-send job picks the draft up immediately.
 */

async function allocateWorkflowTicketCode(
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
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', numericAccountId)
    .executeTakeFirst();
  if (!account) return generateTicketCode();
  const defaultPrefix = `ACC${numericAccountId}`.slice(0, 12);
  await trx
    .insertInto('email_account_mail_settings')
    .values({
      workspace_id: workspaceId,
      account_source_sqlite_id: Number(account.source_sqlite_id ?? numericAccountId),
      account_id: numericAccountId,
      ticket_prefix: defaultPrefix,
      ticket_next_number: 1,
      ticket_number_padding: 6,
      thread_namespace: `account-${numericAccountId}`,
      source_row: { source: 'server.workflow.ticket' },
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

async function releaseWorkflowOutboundHold(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.direction !== 'outbound') {
    return { status: 'skipped', port: 'default', message: 'Nur fuer ausgehende Nachrichten' };
  }
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  // Pruefrunde einer Lesebestaetigung: die Nachricht ist die eingegangene Mail,
  // kein Entwurf. Die Freigabe gilt nur der Lesebestaetigung (SEND); Betreff,
  // Text und Versandzeit der Mail bleiben unberuehrt.
  if (typeof context.variables[READ_RECEIPT_REVIEW_ROUND_VARIABLE] === 'string') {
    return { status: 'ok', port: 'default', message: 'read_receipt_review:send' };
  }
  const autoSend = config.autoSend === true;

  if (!autoSend) {
    await trx
      .updateTable('email_messages')
      .set({ outbound_hold: false, outbound_block_reason: null, updated_at: now })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', context.messageId)
      .execute();
    return {
      status: 'ok',
      port: 'default',
      message: 'outbound_hold_released',
      variables: { 'email.outbound_hold': false, 'email.auto_send_scheduled': false },
    };
  }

  // autoSend path:
  // (1) review.review wrote the "AUSGANGSPRUEFUNG — VERSAND BLOCKIERT" banner
  //     into body_text/body_html when it held the draft. If we don't strip it
  //     here, the customer receives the internal banner in the sent mail.
  // (2) review.review on the scheduled-send retry will receive a subject that
  //     has been ticket-code-prefixed by prepareDraftForSend, so the marker
  //     fingerprint must be computed against the SAME prefixed subject —
  //     otherwise hash mismatches every retry and bypass is denied.
  const draftRow = await trx
    .selectFrom('email_messages')
    .select(['subject', 'body_text', 'body_html', 'to_json', 'cc_json', 'bcc_json', 'draft_attachment_paths_json', 'ticket_code', 'account_id'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();

  const cleaned = extractDraftBodyForOutboundBlock({
    body_text: draftRow?.body_text ?? null,
    body_html: draftRow?.body_html ?? null,
  });
  const cleanedBodyText = cleaned.plain;
  const cleanedBodyHtml = cleaned.html;

  // Reconcile subject with the ticket code that prepareDraftForSend will
  // add when scheduled-send finally calls composeSender.send. The marker must
  // be valid against that final subject so the retry bypasses the review.
  const storedSubject = draftRow?.subject?.trim() || '';
  const allowedPrefixes = await listWorkspaceTicketPrefixes(trx, context.workspaceId);
  const existingTicket = draftRow?.ticket_code?.trim()
    || extractWorkspaceTicketFromSubject(draftRow?.subject ?? null, allowedPrefixes);
  const ticketCode = existingTicket || await allocateWorkflowTicketCode(trx, context.workspaceId, draftRow?.account_id ?? null, now);
  const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);

  await trx
    .updateTable('email_messages')
    .set({
      outbound_hold: false,
      outbound_block_reason: null,
      scheduled_send_at: now,
      ...scheduledSendProvenanceColumns(context),
      // Persist the cleaned body so the customer does not see the internal
      // review banner, and the persisted ticket-prefixed subject so the
      // fingerprint matches at send time.
      body_text: cleanedBodyText,
      body_html: cleanedBodyHtml || null,
      subject: finalSubject,
      ticket_code: ticketCode,
      updated_at: now,
    })
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();
  if (!context.actorUserId) {
    // TA-P3: Workflow-Versand ohne Menschen — Herkunft festhalten, falls leer.
    // Gibt ein Ausgangs-Workflow die Mail eines Menschen frei, bleibt sie dessen Mail.
    await markDraftOrigin(trx, {
      workspaceId: context.workspaceId,
      draftId: context.messageId,
      kind: 'workflow',
      workflowId: context.workflowId,
      onlyIfUnset: true,
    });
  }

  // Multi-outbound-workflow safety: if there are OTHER outbound runs against
  // this draft still queued/running, the user has multiple parallel quality
  // checks (e.g. language + compliance). Setting the bypass marker now would
  // let scheduled-send race them. Skip the marker (cron still picks up the
  // draft via scheduled_send_at and re-enters reviewOutbound.review, which
  // re-holds until the other workflows finish — they'll set their own marker
  // once they all approve).
  const otherOpenOutboundRuns = await trx
    .selectFrom('email_workflow_runs')
    .select('id')
    .where('message_id', '=', context.messageId)
    .where('direction', '=', 'outbound')
    .where('status', 'in', ['queued', 'running'])
    .where('id', '!=', context.runId)
    .where('dry_run', '=', false)
    .limit(1)
    .execute();
  if (otherOpenOutboundRuns.length > 0) {
    return {
      status: 'ok',
      port: 'default',
      message: 'outbound_hold_released_auto_send_pending_peers',
      variables: { 'email.outbound_hold': false, 'email.auto_send_scheduled': true, 'email.pending_outbound_peers': true },
    };
  }

  const fingerprint = outboundApprovalFingerprint({
    subject: finalSubject,
    bodyText: cleanedBodyText,
    bodyHtml: cleanedBodyHtml,
    to: addressesFromStoredRecipientJson(draftRow?.to_json),
    cc: addressesFromStoredRecipientJson(draftRow?.cc_json),
    bcc: addressesFromStoredRecipientJson(draftRow?.bcc_json),
    attachmentPaths: draftAttachmentPathsFromJson(draftRow?.draft_attachment_paths_json),
    accountId: draftRow?.account_id ?? null,
  });
  const key = outboundReviewApprovedKey(context.messageId);
  const markerValue = encodeOutboundApprovalMarker(now, fingerprint);
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: context.workspaceId,
      key,
      value: markerValue,
      last_updated: now,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'key'])
      .doUpdateSet({ value: markerValue, last_updated: now, updated_at: now }))
    .execute();

  return {
    status: 'ok',
    port: 'default',
    message: 'outbound_hold_released_auto_send',
    variables: { 'email.outbound_hold': false, 'email.auto_send_scheduled': true },
  };
}

/**
 * Triggers the actual SMTP send of a (previously created) draft message —
 * the missing link for fully automated reply chains.
 *
 *   ai.reply_suggestion / ai.agent / email.create_draft   →   sets draft.id
 *                                                              ↓
 *                                          email.auto_reply (approved gate)
 *                                                              ↓
 *                                          email.send_draft  ← THIS
 *                                                              ↓
 *                                   (scheduled-send cron + composeSender.send)
 *
 * Config:
 *   - draftIdVariable (string, default 'draft.id'): which workflow variable to
 *     read the draft message id from.
 *   - runOutboundReview (bool, default false): when false, sets the approval
 *     marker so the send bypasses the outbound review (the workflow has just
 *     curated this draft, KI-on-KI review is the trigger workflow's choice).
 *     When true, no marker is set → composeSender.send runs reviewOutbound on
 *     the new draft and outbound workflows can hold/approve as for any mail.
 *
 * Idempotent: re-running on a draft already marked for send is a no-op.
 */
async function sendWorkflowDraft(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const draftIdVar = String(config.draftIdVariable ?? 'draft.id').trim() || 'draft.id';
  const rawId = config.draftId ?? context.variables[draftIdVar];
  const draftId = Number(rawId);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return {
      status: 'error',
      port: 'error',
      message: `Keine gueltige Entwurfs-ID unter ${draftIdVar} oder config.draftId`,
    };
  }

  // Belt-and-braces safety net for ALL inbound chains: the workspace auto-
  // reply switch must be on, and the original sender must not look like a
  // no-reply / bounce / automation address. This runs regardless of
  // runOutboundReview, because runOutboundReview=true only helps when
  // outbound workflows actually exist — if none are configured, the send
  // would otherwise go out unguarded. Outbound-direction sends are not
  // affected (a manual workflow is the operator's explicit choice).
  if (context.direction === 'inbound') {
    if (!(await loadAutoReplyEnabled(trx, context.workspaceId))) {
      return { status: 'skipped', port: 'default', message: 'auto_reply_disabled' };
    }
    const sender = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
    if (!sender || AUTO_REPLY_NOREPLY_RE.test(sender)) {
      return { status: 'skipped', port: 'default', message: 'noreply_sender_blocked' };
    }
    // Anti-Loop wie im Desktop-send_draft: auch ein Workflow OHNE
    // email.auto_reply-Gate davor darf Automaten/Newslettern nie antworten.
    if (isUnsafeAutoReplyTarget(context.message?.raw_headers)) {
      return { status: 'skipped', port: 'default', message: 'automated_sender_blocked' };
    }
  }
  const draftRow = await trx
    .selectFrom('email_messages')
    .select(['id', 'uid', 'folder_kind', 'subject', 'body_text', 'body_html', 'to_json', 'cc_json', 'bcc_json', 'draft_attachment_paths_json', 'ticket_code', 'account_id', 'scheduled_send_at'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', draftId)
    // Sperrt gegen ein paralleles Speichern (PATCH compose-draft), damit der
    // Abgleich mit der geprueften Fassung unten bis zum Commit gilt.
    .forUpdate()
    .executeTakeFirst();
  if (!draftRow) {
    return { status: 'error', port: 'error', message: `Entwurf ${draftId} nicht gefunden` };
  }
  if (draftRow.folder_kind !== 'draft' || (draftRow.uid as number) >= 0) {
    return { status: 'error', port: 'error', message: `Nachricht ${draftId} ist kein Entwurf` };
  }

  // Nach einem SEND der KI-Gegenpruefung laeuft dieser Knoten als eigener,
  // spaeterer Job. Wurde der Entwurf dazwischen geaendert, ist die neue Fassung
  // ungeprueft: nicht senden, sondern wie die Gegenpruefung selbst zur
  // manuellen Freigabe zurueckstellen. Vor der Auto-Antwort-Reservierung, damit
  // der zurueckgestellte Entwurf keinen Tages-Slot verbraucht.
  // Ein noch eingeplanter Entwurf ist seitdem unveraendert (jedes Speichern
  // nimmt die Planung zurueck): so bleibt die erneute Zustellung dieser
  // Fortsetzung, deren erster Lauf Betreff und Text selbst angepasst hat, ein No-op.
  const reviewedFingerprint = context.variables['ai.review.fingerprint'];
  if (
    typeof reviewedFingerprint === 'string'
    && Number(context.variables['ai.review.draft_id']) === draftId
    && draftRow.scheduled_send_at == null
    && fingerprintReviewedDraft(draftRow) !== reviewedFingerprint
  ) {
    await setDraftApprovalPending(
      trx,
      context.workspaceId,
      draftId,
      'Entwurf wurde nach der KI-Prüfung geändert — bitte manuell freigeben',
    );
    return { status: 'skipped', port: 'default', message: 'send_draft_changed_after_review' };
  }

  if (context.direction === 'inbound') {
    const accountId = Number(draftRow.account_id);
    const recipient = normalizeEmailAddress(firstWorkflowRecipientAddress(draftRow.to_json));
    const sourceMessageId = Number(context.messageId);
    if (!Number.isInteger(accountId) || accountId <= 0 || !isAutoReplyRecipient(recipient)) {
      return { status: 'skipped', port: 'default', message: 'auto_reply_recipient_invalid' };
    }
    if (!Number.isInteger(sourceMessageId) || sourceMessageId <= 0) {
      return { status: 'skipped', port: 'default', message: 'auto_reply_source_missing' };
    }
    const reservation = await reserveServerAutoReplySlot(trx, {
      workspaceId: context.workspaceId,
      sourceMessageId,
      draftMessageId: draftId,
      accountId,
      recipient,
      replyDay: now.toISOString().slice(0, 10),
      limit: await loadAutoReplyMaxPerSenderPerDay(trx, context.workspaceId),
      now,
    });
    if (reservation === 'duplicate') {
      return { status: 'skipped', port: 'default', message: 'auto_reply_duplicate' };
    }
    if (reservation === 'rate_limited') {
      return { status: 'skipped', port: 'default', message: 'auto_reply_rate_limited' };
    }
  }

  const runOutboundReview = config.runOutboundReview === true;

  // For runOutboundReview=false we have to reconcile the persisted body and
  // subject with what scheduled-send / composeSender.send will use at SMTP
  // time, otherwise the approval marker we stamp now won't match:
  //  - strip any "AUSGANGSPRUEFUNG"-banner left over from an earlier
  //    reviewOutbound hold (it would otherwise be sent to the customer);
  //  - bake in the ticket-code-prefixed subject that prepareDraftForSend will
  //    enforce, so the fingerprint stays valid on the retry.
  if (!runOutboundReview) {
    const cleaned = extractDraftBodyForOutboundBlock({
      body_text: draftRow.body_text ?? null,
      body_html: draftRow.body_html ?? null,
    });
    const storedSubject = draftRow.subject?.trim() || '';
    const allowedPrefixes = await listWorkspaceTicketPrefixes(trx, context.workspaceId);
    const existingTicket = draftRow.ticket_code?.trim()
      || extractWorkspaceTicketFromSubject(draftRow.subject ?? null, allowedPrefixes);
    const ticketCode = existingTicket || await allocateWorkflowTicketCode(trx, context.workspaceId, draftRow.account_id ?? null, now);
    const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);

    await trx
      .updateTable('email_messages')
      .set({
        outbound_hold: false,
        outbound_block_reason: null,
        scheduled_send_at: now,
        ...scheduledSendProvenanceColumns(context),
        body_text: cleaned.plain,
        body_html: cleaned.html || null,
        subject: finalSubject,
        ticket_code: ticketCode,
        updated_at: now,
      })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', draftId)
      .execute();

    const fingerprint = outboundApprovalFingerprint({
      subject: finalSubject,
      bodyText: cleaned.plain,
      bodyHtml: cleaned.html,
      to: addressesFromStoredRecipientJson(draftRow.to_json),
      cc: addressesFromStoredRecipientJson(draftRow.cc_json),
      bcc: addressesFromStoredRecipientJson(draftRow.bcc_json),
      attachmentPaths: draftAttachmentPathsFromJson(draftRow.draft_attachment_paths_json),
      accountId: draftRow.account_id,
    });
    const markerValue = encodeOutboundApprovalMarker(now, fingerprint);
    await trx
      .insertInto('sync_info')
      .values({
        workspace_id: context.workspaceId,
        key: outboundReviewApprovedKey(draftId),
        value: markerValue,
        last_updated: now,
        source_row: serverWorkerSourceRow(),
        imported_in_run_id: null,
        updated_at: now,
      })
      .onConflict((oc) => oc
        .columns(['workspace_id', 'key'])
        .doUpdateSet({ value: markerValue, last_updated: now, updated_at: now }))
      .execute();
  } else {
    // runOutboundReview=true: outbound workflows guard the send via the
    // existing pipeline; just prime scheduled_send_at + clear the hold.
    await trx
      .updateTable('email_messages')
      .set({
        outbound_hold: false,
        outbound_block_reason: null,
        scheduled_send_at: now,
        ...scheduledSendProvenanceColumns(context),
        updated_at: now,
      })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', draftId)
      .execute();
  }

  // TA-P3: Workflow-Versand — Herkunft festhalten, falls der Entwurf noch keine hat.
  await markDraftOrigin(trx, {
    workspaceId: context.workspaceId,
    draftId,
    kind: 'workflow',
    workflowId: context.workflowId,
    onlyIfUnset: true,
  });

  if (context.direction === 'inbound') {
    await trx
      .insertInto('sync_info')
      .values({
        workspace_id: context.workspaceId,
        key: autoSubmittedDraftKey(draftId),
        value: '1',
        last_updated: now,
        source_row: serverWorkerSourceRow(),
        imported_in_run_id: null,
        updated_at: now,
      })
      .onConflict((oc) => oc
        .columns(['workspace_id', 'key'])
        .doUpdateSet({ value: '1', last_updated: now, updated_at: now }))
      .execute();
  }

  return {
    status: 'ok',
    port: 'default',
    message: runOutboundReview ? 'send_draft_queued_with_review' : 'send_draft_queued_auto',
    variables: {
      'send_draft.draft_id': draftId,
      'send_draft.with_review': runOutboundReview,
    },
  };
}

async function reserveServerAutoReplySlot(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    sourceMessageId: number;
    draftMessageId: number;
    accountId: number;
    recipient: string;
    replyDay: string;
    limit: number;
    now: Date;
  },
): Promise<'reserved' | 'duplicate' | 'rate_limited'> {
  const reservation = await trx
    .insertInto('email_auto_reply_reservations')
    .values({
      workspace_id: input.workspaceId,
      source_message_id: input.sourceMessageId,
      draft_message_id: input.draftMessageId,
      account_id: input.accountId,
      recipient: input.recipient,
      reply_day: input.replyDay,
      created_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'source_message_id']).doNothing())
    .returning('source_message_id')
    .executeTakeFirst();
  if (!reservation) return 'duplicate';

  await trx
    .insertInto('email_auto_reply_daily_counters')
    .values({
      workspace_id: input.workspaceId,
      account_id: input.accountId,
      recipient: input.recipient,
      reply_day: input.replyDay,
      reply_count: 0,
      last_source_message_id: null,
      last_draft_message_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'account_id', 'recipient', 'reply_day'])
      .doNothing())
    .execute();

  const counter = await trx
    .updateTable('email_auto_reply_daily_counters')
    .set({
      reply_count: sql<number>`reply_count + 1`,
      last_source_message_id: input.sourceMessageId,
      last_draft_message_id: input.draftMessageId,
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('account_id', '=', input.accountId)
    .where('recipient', '=', input.recipient)
    .where('reply_day', '=', input.replyDay)
    .where('reply_count', '<', input.limit)
    .returning('reply_count')
    .executeTakeFirst();
  if (counter) return 'reserved';

  await trx
    .deleteFrom('email_auto_reply_reservations')
    .where('workspace_id', '=', input.workspaceId)
    .where('source_message_id', '=', input.sourceMessageId)
    .execute();
  return 'rate_limited';
}

function isAutoReplyRecipient(value: string): boolean {
  return value.length <= 320 && hasSimpleEmailShape(value);
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const OUTBOUND_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'email.hold_outbound': handleEmailHoldOutbound,
  hold_outbound: handleEmailHoldOutbound,
  'email.release_outbound': handleEmailReleaseOutbound,
  'email.send_draft': handleEmailSendDraft,
  'email.auto_reply': handleEmailAutoReply,
  'email.create_draft': handleEmailCreateDraft,
};
