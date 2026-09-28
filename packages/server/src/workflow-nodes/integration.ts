/**
 * Plan 043: Integrations-Knoten (Sync, Weiterleitung, DMARC, HTTP).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  type WorkflowGraphDocument,
  type WorkflowGraphNode,
  emailAddressForDelivery,
  isAutoForwardedMessage,
  outgoing,
  pickEdge,
} from '@simplecrm/core';
import { createHash } from 'node:crypto';
import type { WorkspaceTransaction } from '../db/workspace-context';
import {
  boundedContinuationStrings,
  hasSimpleEmailShape,
  inboundChainFieldsFromContext,
  inboundFanOutRunId,
  positiveIntegerVariable,
  resolveResumeNodeAfter,
  stampBranchKey,
  terminalNodeExecutionId,
  workflowContinuationContextError,
  workflowJobProvenance,
  workflowSideEffectExecutionIdentity,
} from './shared';
import type { NodeResult, ServerNodeHandler, ServerNodeHandlerArgs, ServerWorkflowContext } from './types';

/** Knoten sync.run. */
async function handleSyncRun({ trx, context, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await enqueueWorkflowSyncRun(trx, context, now);
}

/** Knoten email.forward_copy, forward_copy. */
async function handleEmailForwardCopy({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await scheduleWorkflowForwardCopyJob(trx, doc, context, node, config, now);
}

/** Knoten email.ingest_dmarc_report. */
async function handleEmailIngestDmarcReport({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await scheduleWorkflowDmarcIngestJob(trx, doc, context, node, config, now);
}

/** Knoten http.request. */
async function handleHttpRequest({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await scheduleWorkflowHttpRequestJob(trx, doc, context, node, config, now);
}

async function scheduleWorkflowHttpRequestJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const url = workflowHttpUrl(config.url);
  if (!url.ok) return { status: 'error', port: 'error', message: url.message };
  if (!url.value) return { status: 'skipped', port: 'default', message: 'leere URL' };
  const method = workflowHttpMethod(config.method);
  if (!method.ok) return { status: 'error', port: 'error', message: method.message };
  const body = workflowHttpBody(config.body);
  if (!body.ok) return { status: 'error', port: 'error', message: body.message };
  const timeoutMs = workflowHttpTimeout(config.timeoutMs);
  if (!timeoutMs.ok) return { status: 'error', port: 'error', message: timeoutMs.message };

  const resumeNodeId = resolveHttpSuccessNodeAfter(doc, node.id);
  const errorResumeNodeId = resolveHttpErrorNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    method: method.value,
    ...workflowJobProvenance(context),
    url: url.value,
    timeoutMs: timeoutMs.value,
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
  };
  if (method.value === 'POST') {
    payload.idempotencyKey = workflowHttpIdempotencyKey(context, node.id);
  }
  if (method.value === 'POST' && body.value !== undefined) payload.body = body.value;
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (resumeNodeId || errorResumeNodeId) {
    payload.workflowId = context.workflowId;
    if (resumeNodeId) payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    if (errorResumeNodeId) payload.errorResumeNodeId = errorResumeNodeId;
    // Terminal (nur Fehlerkante): Identitaet auch auf oberster Ebene, sonst
    // sieht graphileJobKeyForJob sie nicht. Warum sie noetig ist: dort.
    // Fan-out-Lauf statt context.runId (die ist pro Zustellung neu) — warum:
    // terminalChildCompletionKey in workflow-inbound-chain-advance.
    if (!resumeNodeId && errorResumeNodeId) {
      payload.terminalNodeId = `${terminalNodeExecutionId(context, node)}:run:${inboundFanOutRunId(context)}`;
    }
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      ...(resumeNodeId ? { resumeNodeId } : {}),
      ...(errorResumeNodeId ? { errorResumeNodeId } : {}),
      // Enthaelt die runId: die Fortsetzung traegt keine eigene, und die
      // Einmal-Schranke des terminalen Abschlusses darf den Lauf nicht
      // ueberleben (sonst haengt die Barriere eines zweiten Laufs).
      ...(!resumeNodeId && errorResumeNodeId
        ? { completeOnSuccess: true, terminalNodeId: payload.terminalNodeId as string }
        : {}),
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.http_request',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId || errorResumeNodeId),
    deferred: Boolean(resumeNodeId || errorResumeNodeId),
    message: `queued_http_request:${jobId}`,
    variables: {
      'http.status': 'pending',
      'http.job_id': jobId,
    },
  };
}

async function scheduleWorkflowForwardCopyJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const to = workflowForwardCopyRecipient(config.to);
  if (!to.ok) return { status: 'error', port: 'error', message: to.message };
  if (!to.value) return { status: 'skipped', port: 'default', message: 'Empfaenger fehlt' };
  // Anti-Loop: eine zurueckkommende Weiterleitungskopie ist eine neue Nachricht
  // und faellt nicht unter die Dedup-Tabelle (Quellnachricht, Workflow, Ziel).
  if (isAutoForwardedMessage(context.message?.raw_headers)) {
    return { status: 'skipped', port: 'default', message: 'skip:auto_forwarded_source' };
  }

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    to: to.value,
    includeAttachments: config.includeAttachments === true,
    runOutboundReview: config.runOutboundReview === true,
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
  };
  if (resumeNodeId) {
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.forward_copy',
      payload,
      run_after: now,
      max_attempts: 5,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_forward_copy:${jobId}`,
    variables: {
      'forward_copy.status': 'pending',
      'forward_copy.job_id': jobId,
      'forward_copy.to': to.value,
    },
  };
}

async function scheduleWorkflowDmarcIngestJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const attachmentNameFilter = String(config.attachmentNameFilter ?? '').trim();

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  if (resumeNodeId) {
    const continuationContextError = workflowContinuationContextError(context);
    if (continuationContextError) {
      return { status: 'error', port: 'error', message: continuationContextError };
    }
  }
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    ...(attachmentNameFilter ? { attachmentNameFilter } : {}),
  };
  if (resumeNodeId) {
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.dmarc_ingest',
      payload,
      run_after: now,
      max_attempts: 5,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_dmarc_ingest:${jobId}`,
    variables: {
      'dmarc.status': 'pending',
      'dmarc.job_id': jobId,
    },
  };
}

type WorkflowHttpMethodConfig =
  | { ok: true; value: 'GET' | 'POST' }
  | { ok: false; message: string };

type WorkflowForwardCopyRecipientConfig =
  | { ok: true; value: string }
  | { ok: false; message: string };

const MAX_FORWARD_COPY_RECIPIENTS = 10;

/** Parses one or more comma/semicolon-separated forward recipients, validates
 *  each, and returns them as a normalized comma-joined string. */
function workflowForwardCopyRecipient(value: unknown): WorkflowForwardCopyRecipientConfig {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, message: 'Forward-Empfaenger muss Text sein' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: '' };
  if (trimmed.length > 1000) return { ok: false, message: 'Forward-Empfaenger zu lang' };
  const parts = trimmed.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: true, value: '' };
  if (parts.length > MAX_FORWARD_COPY_RECIPIENTS) {
    return { ok: false, message: `Maximal ${MAX_FORWARD_COPY_RECIPIENTS} Forward-Empfaenger` };
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const angleMatch = /<([^<>]+)>\s*$/.exec(part);
    const address = emailAddressForDelivery(angleMatch?.[1] ?? part);
    if (!isSimpleWorkflowEmailAddress(address)) {
      return { ok: false, message: `Forward-Empfaenger ist ungueltig: ${part}` };
    }
    const identity = address.toLowerCase();
    if (!seen.has(identity)) {
      normalized.push(address);
      seen.add(identity);
    }
  }
  return { ok: true, value: normalized.join(',') };
}

function isSimpleWorkflowEmailAddress(value: string): boolean {
  return hasSimpleEmailShape(value, '<>');
}

function workflowHttpMethod(value: unknown): WorkflowHttpMethodConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'GET' };
  if (typeof value !== 'string') return { ok: false, message: 'HTTP-Methode muss GET oder POST sein' };
  const normalized = value.trim().toUpperCase();
  if (normalized === 'GET' || normalized === 'POST') return { ok: true, value: normalized };
  return { ok: false, message: 'HTTP-Methode muss GET oder POST sein' };
}

type WorkflowHttpUrlConfig =
  | { ok: true; value: string }
  | { ok: false; message: string };

function workflowHttpUrl(value: unknown): WorkflowHttpUrlConfig {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, message: 'HTTP-URL muss Text sein' };
  const trimmed = value.trim();
  if (trimmed.length > 2048) return { ok: false, message: 'HTTP-URL zu lang' };
  return { ok: true, value: trimmed };
}

type WorkflowHttpBodyConfig =
  | { ok: true; value: string | undefined }
  | { ok: false; message: string };

function workflowHttpBody(value: unknown): WorkflowHttpBodyConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  if (body.length > 128 * 1024) return { ok: false, message: 'HTTP-Body zu lang' };
  return { ok: true, value: body };
}

type WorkflowHttpTimeoutConfig =
  | { ok: true; value: number }
  | { ok: false; message: string };

function workflowHttpTimeout(value: unknown): WorkflowHttpTimeoutConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 30_000 };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 60_000) {
    return { ok: false, message: 'HTTP-Timeout muss zwischen 1000 und 60000 ms liegen' };
  }
  return { ok: true, value: parsed };
}

function resolveHttpSuccessNodeAfter(doc: WorkflowGraphDocument, nodeId: string): string {
  const outs = outgoing(doc.edges, nodeId);
  const explicit = pickEdge(outs, 'default') ?? pickEdge(outs, 'yes');
  if (explicit) return explicit.target;
  const nonErrorEdges = outs.filter((edge) => !['no', 'nein', 'false', 'error']
    .includes(String(edge.label ?? '').trim().toLowerCase()));
  return nonErrorEdges.length === 1 ? nonErrorEdges[0]!.target : '';
}

function resolveHttpErrorNodeAfter(doc: WorkflowGraphDocument, nodeId: string): string {
  return pickEdge(outgoing(doc.edges, nodeId), 'no')?.target ?? '';
}

async function enqueueWorkflowSyncRun(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
): Promise<NodeResult> {
  const accountId = positiveIntegerVariable(context.variables['email.account_id']);
  if (accountId === null) return { status: 'skipped', port: 'default', message: 'Kein Konto' };

  const account = await trx
    .selectFrom('email_accounts')
    .select(['id', 'protocol'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!account) return { status: 'error', port: 'error', message: 'Konto nicht gefunden' };

  const protocol = String(account.protocol ?? 'imap').trim().toLowerCase() || 'imap';
  const jobType = protocol === 'imap'
    ? 'mail.sync.imap'
    : protocol === 'pop3'
      ? 'mail.sync.pop3'
      : null;
  if (!jobType) {
    return { status: 'error', port: 'error', message: 'Email account protocol wird nicht unterstuetzt' };
  }

  const row = await trx
    .insertInto('job_queue')
    .values({
      type: jobType,
      payload: {
        workspaceId: context.workspaceId,
        accountId,
        ...workflowJobProvenance(context),
      },
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    message: `queued_sync:${jobId}`,
    variables: {
      'sync.queued': true,
      'sync.job_id': jobId,
      'sync.account_id': accountId,
    },
  };
}

function workflowHttpIdempotencyKey(context: ServerWorkflowContext, nodeId: string): string {
  const hash = createHash('sha256')
    .update(context.workspaceId)
    .update('\0')
    .update(String(context.workflowSourceSqliteId))
    .update('\0')
    .update(workflowSideEffectExecutionIdentity(context))
    .update('\0')
    .update(nodeId);
  // Inside logic.loop each iteration is a distinct legitimate request, so the
  // loop position joins the digest. Retries of the same queued job reuse the
  // key stored in the job payload, so retry stability is unaffected.
  const loopIndex = context.variables['loop.index'];
  const loopItem = context.variables['loop.item'];
  if (loopIndex !== undefined || loopItem !== undefined) {
    hash
      .update('\0')
      .update(`loop:${String(loopIndex ?? '')}`)
      .update('\0')
      .update(String(loopItem ?? ''));
  }
  return `simplecrm-workflow-http-${hash.digest('hex')}`;
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const INTEGRATION_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'sync.run': handleSyncRun,
  'email.forward_copy': handleEmailForwardCopy,
  forward_copy: handleEmailForwardCopy,
  'email.ingest_dmarc_report': handleEmailIngestDmarcReport,
  'http.request': handleHttpRequest,
};
