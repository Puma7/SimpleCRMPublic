/**
 * Plan 043: Hilfsfunktionen, die Engine und mehrere Knoten-Kategorien nutzen.
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  type WorkflowGraphDocument,
  type WorkflowGraphNode,
  type WorkflowTriggerKind,
  isTrashMailboxName,
  normalizeEmailAddress,
  normalizeMailboxName,
  outgoing,
  pickEdge,
} from '@simplecrm/core';
import type { WorkspaceTransaction } from '../db/workspace-context';
import { MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD, buildTrustedServiceJobPayload } from '../jobs/policy';
import { READ_RECEIPT_REVIEW_ROUND_VARIABLE } from '../mail-read-receipt-responder';
import type { ServerWorkflowImapActionResult } from '../workflow-imap-actions';
import { inboundChainFieldsFromRecord } from '../workflow-inbound-chain-context';
import type {
  BooleanConfig,
  MessageRow,
  NodeResult,
  OptionalPositiveIntegerConfig,
  ServerNodeHandler,
  ServerNodeHandlerMap,
  ServerWorkflowContext,
  ServerWorkflowRuntimePorts,
  WorkflowMessagePatch,
  WorkflowRow,
  WorkflowStringContext,
} from './types';

/** Reserved variable carrying the current subflow chain depth across child runs. */
export const SUBFLOW_DEPTH_VARIABLE = '__subflow_depth';

/** Reserved variable counting the continuations of this lineage (rides in eventVariables). */
export const CONTINUATION_HOPS_VARIABLE = '__continuation_hops';

/** Variables only the executor may set; nodes can neither write nor overwrite them. */
export const RESERVED_WORKFLOW_VARIABLES = [
  SUBFLOW_DEPTH_VARIABLE,
  READ_RECEIPT_REVIEW_ROUND_VARIABLE,
  CONTINUATION_HOPS_VARIABLE,
];

export const SERVER_CREATED_SOURCE_ID_OFFSET = 1_000_000_000_000n;

export const SERVER_CREATED_SOURCE_ID_SPAN = 7_000_000_000_000_000n;

export class PreviewAiPendingSignal extends Error {}

export async function loadWorkflow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflowId: number,
): Promise<WorkflowRow | null> {
  const row = await trx
    .selectFrom('email_workflows')
    .select([
      'id',
      'source_sqlite_id',
      'account_id',
      'trigger_name',
      'enabled',
      'definition_json',
      'graph_json',
      'execution_mode',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', workflowId)
    .executeTakeFirst();
  return row ?? null;
}

/** Ohne Prototyp: ein Knotentyp wie `constructor` findet keinen Handler. */
export function serverNodeHandlerMap(entries: Record<string, ServerNodeHandler>): ServerNodeHandlerMap {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, ServerNodeHandler>, entries));
}

export function serverNodeHandlerFor(map: ServerNodeHandlerMap, type: string): ServerNodeHandler | undefined {
  return Object.prototype.hasOwnProperty.call(map, type) ? map[type] : undefined;
}

export function unsupportedWorkflowNodeResult(type: string, log: string[]): NodeResult {
  const reason = `server_workflow_node_unsupported:${type}`;
  log.push(reason);
  return {
    status: 'skipped',
    port: 'blocked',
    blocked: true,
    blockReason: reason,
    message: reason,
  };
}

export async function runWorkflowImapMoveAction(
  context: ServerWorkflowContext,
  targetFolderPath: string,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
  unsupportedType: string,
  now: Date,
): Promise<
  | { ok: true; value: ServerWorkflowImapActionResult & { ok: true } }
  | { ok: false; node: NodeResult }
> {
  if (context.messageId === null) {
    return { ok: false, node: { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' } };
  }
  if (!ports.workflowImapActions) {
    return { ok: false, node: unsupportedWorkflowNodeResult(unsupportedType, log) };
  }
  if (ports.deferredImapEffects) {
    ports.deferredImapEffects.push({
      kind: 'move',
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      targetFolderPath,
      context,
      now,
    });
    return {
      ok: true,
      value: {
        ok: true,
        sourceFolderPath: '',
        targetFolderPath,
      },
    };
  }
  const result = await ports.workflowImapActions.move({
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    targetFolderPath,
  });
  if (!result.ok) return { ok: false, node: { status: 'error', port: 'error', message: result.error } };
  return { ok: true, value: result };
}

export async function applyWorkflowImapMoveLocalState(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  targetFolderPath: string,
  now: Date,
): Promise<NodeResult | null> {
  const normalized = normalizeMailboxName(targetFolderPath);
  if (new Set(['spam', 'junk', 'bulk', 'unwanted', 'ungewollt']).has(normalized)) {
    return updateWorkflowMessage(trx, context, workflowSpamStatusPatch('spam', 'inbox', now));
  }
  if (new Set(['archive', 'archives', 'archiv', 'all mail', 'all']).has(normalized)) {
    return updateWorkflowMessage(trx, context, {
      soft_deleted: false,
      archived: true,
      is_spam: false,
      spam_status: 'clean',
      done_local: true,
      trash_prev_archived: null,
      trash_prev_is_spam: null,
      trash_prev_folder_kind: null,
      updated_at: now,
    });
  }
  if (normalized === 'inbox' || normalized === 'posteingang') {
    return updateWorkflowMessage(trx, context, {
      soft_deleted: false,
      archived: false,
      is_spam: false,
      spam_status: 'clean',
      done_local: false,
      folder_kind: 'inbox',
      trash_prev_archived: null,
      trash_prev_is_spam: null,
      trash_prev_folder_kind: null,
      updated_at: now,
    });
  }
  if (isTrashMailboxName(targetFolderPath)) {
    return softDeleteWorkflowMessage(trx, context, now);
  }
  return updateWorkflowMessage(trx, context, { updated_at: now });
}

export function workflowJobProvenance(context: ServerWorkflowContext): Record<string, unknown> {
  if (context.actorUserId) {
    // Propagate the manual-admin marker onto this run's delayed continuations and
    // side-effect children so the worker keeps re-verifying owner/admin across the
    // whole chain (a demoted admin must not complete a run they queued while admin).
    return {
      actorUserId: context.actorUserId,
      ...(context.manualAdminExecute ? { [MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]: true } : {}),
    };
  }
  return context.trustedService ? buildTrustedServiceJobPayload({}) : {};
}

/**
 * Identitaet EINER Ausfuehrung eines terminalen Knotens.
 *
 * Zwei Trigger-Zweige koennen auf denselben Knoten zusammenlaufen; jeder Zweig
 * laeuft mit eigenem `seen`-Set und plant den Kindjob erneut ein. Ohne den
 * Zweigschluessel traegen beide Jobs dieselbe Identitaet: der Graphile-Job-Key
 * kollidiert (jobKeyMode 'replace' verschluckt einen) und die Einmal-Schranke
 * verwirft den zweiten Abschluss — die mit zwei Zweigen initialisierte
 * Join-Barriere faellt dann nie auf null.
 */
export function terminalNodeExecutionId(context: ServerWorkflowContext, node: WorkflowGraphNode): string {
  return context.branchKey ? `${node.id}#${context.branchKey}` : node.id;
}

/**
 * Zweig-Identitaet auf oberster Payload-Ebene eines deferierten Kindjobs.
 *
 * `graphileJobKeyForJob` sieht nur die Payload-Oberflaeche, nicht die
 * Continuation. Ohne diesen Stempel teilten sich zwei auf denselben Knoten
 * konvergierende Trigger-Zweige Workflow, Nachricht, Lauf UND Resume-Knoten;
 * jobKeyMode 'replace' verschluckte einen der beiden Kindjobs, waehrend der
 * Elternlauf die Join-Barriere mit zwei Zweigen initialisiert hat — sie bliebe
 * dauerhaft bei pending = 1.
 */
export function stampBranchKey(payload: Record<string, unknown>, context: ServerWorkflowContext): void {
  if (context.branchKey) payload.branchKey = context.branchKey;
}

export function extractWorkflowEmailAddress(value: unknown): string {
  const candidate = extractWorkflowEmailAddressCandidate(value);
  if (!candidate) return '';
  const inner = firstAngleBracketContent(candidate);
  return normalizeEmailAddress(inner ?? candidate);
}

/**
 * Wie `/<([^>]+)>/` (erster Treffer, Gruppe 1), aber linear: das Regex liest
 * bei vielen `<` ohne `>` ab jedem `<` bis zum Textende (quadratisch, CodeQL).
 */
export function firstAngleBracketContent(value: string): string | null {
  let open = value.indexOf('<');
  while (open >= 0) {
    const close = value.indexOf('>', open + 1);
    if (close < 0) return null;
    if (close > open + 1) return value.slice(open + 1, close);
    open = value.indexOf('<', open + 1);
  }
  return null;
}

/**
 * Wie `^[^\s@X]+@[^\s@X]+\.[^\s@X]+$` (X = `forbiddenChars`), aber linear:
 * im Regex überlappen sich Domain-Teil und `\.` und laufen bei vielen Punkten
 * ohne passendes Ende polynomial (CodeQL).
 */
export function hasSimpleEmailShape(value: string, forbiddenChars = ''): boolean {
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  for (const char of value) {
    if (char !== '@' && (forbiddenChars.includes(char) || /\s/.test(char))) return false;
  }
  const domain = value.slice(at + 1);
  return domain.length >= 3 && domain.slice(1, -1).includes('.');
}

export function extractWorkflowEmailAddressCandidate(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return extractWorkflowEmailAddressCandidate(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) return extractWorkflowEmailAddressCandidate(value[0]);
  const record = value as Record<string, unknown>;
  if (typeof record.address === 'string') return record.address;
  if (Array.isArray(record.value)) return extractWorkflowEmailAddressCandidate(record.value[0]);
  return '';
}

export function positiveIntegerVariable(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function optionalPositiveIntegerConfig(value: unknown, field: string): OptionalPositiveIntegerConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { ok: false, message: `${field} ungueltig` };
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (parsed === 0) return { ok: true, value: undefined };
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, message: `${field} ungueltig` };
  }
  return { ok: true, value: parsed };
}

export function booleanConfig(value: unknown, field: string, fallback: boolean): BooleanConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: fallback };
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return { ok: true, value: true };
    if (normalized === 'false' || normalized === '0') return { ok: true, value: false };
  }
  return { ok: false, message: `${field} muss boolean sein` };
}

/**
 * Lauf, der den aktuellen Trigger-Fan-out gestartet hat.
 *
 * In der ersten Ausfuehrung ist das der eigene Lauf; in jeder Fortsetzung der
 * mitgereichte Ursprungslauf. Eltern (Barriere anlegen) und Kinder (Barriere
 * abbauen) muessen denselben Wert benutzen, sonst zeigen sie auf verschiedene
 * sync_info-Zeilen.
 */
export function inboundFanOutRunId(context: ServerWorkflowContext): number {
  return context.inboundFanOutRunId ?? context.runId;
}

export function inboundChainFieldsFromContext(context: ServerWorkflowContext): ReturnType<typeof inboundChainFieldsFromRecord> {
  // Continuations (AI/HTTP/delay) must keep the priority chain, but must NOT
  // re-stamp skipIfMessageSpamOrReview — that guard is one-shot for the initial
  // post-process enqueue. Re-applying it after mark_spam with stopFurther=false
  // would abort the remaining graph on resume.
  return inboundChainFieldsFromRecord({
    ...(context.inboundWorkflowChain
      ? { inboundWorkflowChain: context.inboundWorkflowChain }
      : {}),
    // Der Fan-out-Lauf dagegen MUSS mitreisen — er skopiert die kettenlose
    // Join-Barriere auf genau diese Ausfuehrung.
    inboundFanOutRunId: inboundFanOutRunId(context),
    // Genauso der Zweig: nur mit ihm bleibt die Knotenausfuehrung auch hinter
    // deferierten Kindjobs eindeutig (siehe workflow-inbound-chain-context).
    ...(context.branchKey ? { branchKey: context.branchKey } : {}),
  });
}

export function resolveResumeNodeAfter(doc: WorkflowGraphDocument, nodeId: string): string {
  const outs = outgoing(doc.edges, nodeId);
  return pickEdge(outs, 'ok')?.target ?? pickEdge(outs, 'default')?.target ?? outs[0]?.target ?? '';
}

export async function updateWorkflowMessage(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  patch: WorkflowMessagePatch,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  await trx
    .updateTable('email_messages')
    .set(patch)
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();
  return null;
}

export async function softDeleteWorkflowMessage(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const current = await trx
    .selectFrom('email_messages')
    .select(['id', 'archived', 'is_spam', 'folder_kind'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (!current) return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };

  await trx
    .updateTable('email_messages')
    .set({
      soft_deleted: true,
      done_local: true,
      trash_prev_archived: Boolean(current.archived),
      trash_prev_is_spam: Boolean(current.is_spam),
      trash_prev_folder_kind: current.folder_kind == null ? null : String(current.folder_kind),
      updated_at: now,
    })
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();
  return null;
}

export async function addWorkflowMessageTag(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  tag: string,
  now: Date,
  ports?: ServerWorkflowRuntimePorts,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const messageSourceSqliteId = context.messageSourceSqliteId
    ?? await resolveMessageSourceSqliteId(trx, context.workspaceId, context.messageId);
  if (messageSourceSqliteId === null) {
    return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  }

  const normalized = tag.trim();
  const existing = await trx
    .selectFrom('email_message_tags')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .where('tag', '=', normalized)
    .executeTakeFirst();
  if (existing) return null;

  // Ein neuer Tag kann die Sichtbarkeit fuer jeden kippen, dessen Binding genau
  // diesen Tag als Filter fuehrt. Nach dem Commit invalidiert execute() sie.
  ports?.visibilityInvalidation?.tags.add(normalized);

  await trx
    .insertInto('email_message_tags')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'email_message_tags',
        context.workspaceId,
        String(messageSourceSqliteId),
        normalized.toLowerCase(),
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      message_id: context.messageId,
      tag: normalized,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return null;
}

export function spamStatusConfig(value: unknown): 'clean' | 'review' | 'spam' {
  const raw = String(value ?? 'review').trim().toLowerCase();
  return raw === 'clean' || raw === 'review' || raw === 'spam' ? raw : 'review';
}

export function workflowSpamStatusPatch(
  status: 'clean' | 'review' | 'spam',
  currentFolderKind: string,
  now: Date,
): WorkflowMessagePatch {
  if (status === 'spam') {
    return {
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
      spam_decided_at: now,
      updated_at: now,
    };
  }
  if (status === 'review') {
    return {
      is_spam: false,
      spam_status: 'review',
      soft_deleted: false,
      archived: false,
      done_local: false,
      seen_local: false,
      folder_kind: 'inbox',
      spam_decided_at: now,
      updated_at: now,
    };
  }
  return {
    is_spam: false,
    spam_status: 'clean',
    soft_deleted: false,
    archived: false,
    done_local: false,
    folder_kind: currentFolderKind === 'sent' || currentFolderKind === 'draft' ? currentFolderKind : 'inbox',
    spam_decided_at: now,
    updated_at: now,
  };
}

export async function resolveMessageSourceSqliteId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<number | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select('source_sqlite_id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ? Number(row.source_sqlite_id) : null;
}

export function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeWorkflowTrigger(value: string | undefined): WorkflowTriggerKind {
  switch (value) {
    case 'inbound':
    case 'outbound':
    case 'draft_created':
    case 'schedule':
    case 'manual':
    case 'relay':
    case 'crm.deal_stage_changed':
    case 'task.due':
    case 'calendar.event_start':
    case 'webhook.incoming':
    case 'crm.customer_created':
      return value;
    default:
      return 'manual';
  }
}

export function firstWorkflowRecipientAddress(value: unknown): string {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const recipients = (parsed as { value?: unknown }).value;
  if (!Array.isArray(recipients)) return '';
  const first = recipients[0];
  if (!first || typeof first !== 'object') return '';
  const address = (first as { address?: unknown }).address;
  return typeof address === 'string' ? address.trim() : '';
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function messageIsSpamOrReview(
  message: Pick<MessageRow, 'is_spam' | 'spam_status' | 'spam_score_label'>,
): boolean {
  const status = String(message.spam_status ?? '').toLowerCase();
  const label = String(message.spam_score_label ?? '').toLowerCase();
  return (
    message.is_spam === true
    || status === 'spam'
    || status === 'review'
    || label === 'spam'
    || label === 'review'
  );
}

export function serverWorkerSourceRow() {
  return { origin: 'server_worker' };
}

export const MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH = 128 * 1024;

export const MAX_CONTINUATION_BODY_TEXT_LENGTH = 48_000;

/**
 * Mailtext fuer Job-Payloads und Fortsetzungen kuerzen. body_text steht dort
 * zweimal (auch in combined_text); ungekuerzt scheiterte jeder deferierte
 * Knoten ab etwa 64 KB an der Kontextgrenze. Die KI-Jobs kuerzen fuer den
 * Prompt ohnehin weiter; der synchrone Teil des Laufs behaelt den vollen Text.
 * Nur Knoten nach der Fortsetzung sehen den gekuerzten Text (body_truncated).
 */
export function boundedContinuationStrings(strings: WorkflowStringContext): WorkflowStringContext {
  const body = strings.body_text ?? '';
  if (body.length <= MAX_CONTINUATION_BODY_TEXT_LENGTH) return strings;
  let cut = MAX_CONTINUATION_BODY_TEXT_LENGTH;
  // Kein halbes Surrogatpaar stehen lassen: jsonb lehnt ein einzelnes \ud83d ab.
  const last = body.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  const boundedBody = body.slice(0, cut);
  // combined_text aus denselben Teilen neu bauen, nur mit gekuerztem Body.
  const combined = strings.combined_text ?? '';
  const bodyAt = combined.indexOf(body);
  return {
    ...strings,
    body_text: boundedBody,
    combined_text: bodyAt < 0
      ? combined
      : `${combined.slice(0, bodyAt)}${boundedBody}${combined.slice(bodyAt + body.length)}`,
    body_truncated: 'true',
  };
}

export function workflowContinuationContextError(context: ServerWorkflowContext): string | null {
  if (
    JSON.stringify(boundedContinuationStrings(context.strings)).length > MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH
    || JSON.stringify(context.variables).length > MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH
  ) {
    return `Continuation-Kontext ueberschreitet ${MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH} JSON-Zeichen`;
  }
  return null;
}

export function workflowSideEffectExecutionIdentity(context: ServerWorkflowContext): string {
  const messageIdentity = context.messageSourceSqliteId ?? context.messageId;
  return messageIdentity === null
    ? `run:${context.runSourceSqliteId}`
    : `message:${messageIdentity}`;
}

export function serverCreatedSourceSqliteId(kind: string, ...parts: string[]): number {
  const value = [kind, ...parts].join('\u001f');
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return -Number(SERVER_CREATED_SOURCE_ID_OFFSET + (hash % SERVER_CREATED_SOURCE_ID_SPAN));
}
