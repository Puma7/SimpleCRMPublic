/**
 * Plan 043: ERP-/Retouren-Knoten (JTL, MSSQL, Retouren).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import type { Selectable } from 'kysely';
import type { ReturnItemCondition, ReturnItemsTable, ReturnOutcome, ReturnStatus, ReturnsTable } from '../db';
import { ilikeContainsPattern } from '../db/sql-ilike';
import type { WorkspaceTransaction } from '../db/workspace-context';
import { type MssqlSettingsPort, validateReadOnlyMssqlQuery } from '../mssql-settings';
import {
  extractWorkflowEmailAddress,
  optionalPositiveIntegerConfig,
  positiveIntegerVariable,
} from './shared';
import type {
  NodeResult,
  ServerNodeHandler,
  ServerNodeHandlerArgs,
  ServerWorkflowContext,
  WorkflowVariableContext,
} from './types';

const MAX_WORKFLOW_JTL_LOOKUP_LIMIT = 50;

const WORKFLOW_JTL_LOOKUP_RESULT_LIMIT = 8_000;

/** Knoten jtl.lookup. */
async function handleJtlLookup({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await executeWorkflowJtlLookup(trx, context, config);
}

/** Knoten mssql.query. */
async function handleMssqlQuery({ context, config, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await executeWorkflowMssqlQuery(context, config, ports.mssql);
}

/** Knoten jtl.order_context. */
async function handleJtlOrderContext({ context, config, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await executeWorkflowJtlOrderContext(context, config, ports.mssql);
}

/** Knoten jtl.prepare_action. */
async function handleJtlPrepareAction({ context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return executeWorkflowJtlPrepareAction(context, config);
}

/** Knoten returns.evaluate. */
async function handleReturnsEvaluate({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await evaluateWorkflowReturn(trx, context, config);
}

/** Knoten returns.offer_exchange. */
async function handleReturnsOfferExchange({ trx, context, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await applyWorkflowReturnOutcome(trx, context, config, 'exchange', now);
}

/** Knoten returns.offer_credit. */
async function handleReturnsOfferCredit({ trx, context, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await applyWorkflowReturnOutcome(trx, context, config, 'credit', now);
}

type WorkflowJtlEntity = 'firmen' | 'warenlager' | 'zahlungsarten' | 'versandarten';

type WorkflowJtlTableName = 'jtl_firmen' | 'jtl_warenlager' | 'jtl_zahlungsarten' | 'jtl_versandarten';

const WORKFLOW_JTL_TABLE_BY_ENTITY: Record<WorkflowJtlEntity, WorkflowJtlTableName> = {
  firmen: 'jtl_firmen',
  warenlager: 'jtl_warenlager',
  zahlungsarten: 'jtl_zahlungsarten',
  versandarten: 'jtl_versandarten',
};

const WORKFLOW_JTL_SELECT_COLUMNS = ['source_sqlite_id', 'name'] as const;

type WorkflowJtlLookupEntityConfig =
  | { ok: true; value: WorkflowJtlEntity }
  | { ok: false; message: string };

async function executeWorkflowJtlLookup(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const entity = workflowJtlLookupEntityConfig(config.entity);
  if (!entity.ok) return { status: 'error', port: 'error', message: entity.message };
  const sourceSqliteId = optionalSafeIntegerConfig(config.sourceSqliteId, 'sourceSqliteId');
  if (!sourceSqliteId.ok) return { status: 'error', port: 'error', message: sourceSqliteId.message };
  const limit = workflowJtlLookupLimit(config.limit);
  const search = String(config.search ?? config.query ?? '').trim();
  const tableName = WORKFLOW_JTL_TABLE_BY_ENTITY[entity.value];

  let query = trx
    .selectFrom(tableName)
    .select(WORKFLOW_JTL_SELECT_COLUMNS)
    .where('workspace_id', '=', context.workspaceId)
    .orderBy('source_sqlite_id', 'asc')
    .limit(limit);

  if (sourceSqliteId.value !== undefined) query = query.where('source_sqlite_id', '=', sourceSqliteId.value);
  if (search) query = query.where('name', 'ilike', ilikeContainsPattern(search));

  const rows = await query.execute();
  const items = rows.map((row) => ({
    sourceSqliteId: Number(row.source_sqlite_id),
    name: row.name === null || row.name === undefined ? null : String(row.name),
  }));

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'jtl.entity': entity.value,
      'jtl.row_count': items.length,
      'jtl.data': JSON.stringify(items).slice(0, WORKFLOW_JTL_LOOKUP_RESULT_LIMIT),
    },
  };
}

async function executeWorkflowMssqlQuery(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  mssql: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'> | undefined,
): Promise<NodeResult> {
  const query = String(config.sql ?? config.query ?? '').trim();
  if (!query) return { status: 'skipped', port: 'default', message: 'SQL leer' };
  const validation = validateReadOnlyMssqlQuery(query);
  if (!validation.ok) return { status: 'error', port: 'error', message: validation.error };
  if (!mssql) return { status: 'error', port: 'error', message: 'MSSQL-Port nicht konfiguriert' };

  const result = await mssql.executeReadOnlyQuery({
    workspaceId: context.workspaceId,
    query: validation.query,
  });
  if (!result.success) {
    return { status: 'error', port: 'error', message: result.error ?? 'MSSQL-Fehler' };
  }

  const rows = result.rows ?? [];
  return {
    status: 'ok',
    port: 'default',
    variables: {
      'mssql.rows': JSON.stringify(rows).slice(0, 8_000),
      'mssql.row_count': result.rowCount ?? rows.length,
    },
  };
}

const JTL_CONTEXT_EMAIL_RE = /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/;

const JTL_CONTEXT_ORDER_NO_RE = /^[A-Za-z0-9._\-/]{1,64}$/;

/**
 * Convenience node that fetches a JTL/Wawi order context for the message sender.
 * The operator supplies a read-only query with {{email}} / {{orderNo}} placeholders
 * (bound from the sender address / a variable, strictly validated + SQL-escaped);
 * the first result row's columns are exposed as `jtl.<column>` variables for the
 * downstream KI nodes. No customer-specific schema is hard-coded — the SQL is
 * configured per deployment.
 */
async function executeWorkflowJtlOrderContext(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  mssql: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'> | undefined,
): Promise<NodeResult> {
  const template = String(config.query ?? config.sql ?? '').trim();
  if (!template) return { status: 'skipped', port: 'default', message: 'Keine JTL-Query konfiguriert' };
  if (!mssql) return { status: 'error', port: 'error', message: 'MSSQL-Port nicht konfiguriert' };

  const email = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
  const orderNo = String(
    context.variables['jtl.order_no'] ?? context.strings.order_no ?? config.orderNo ?? '',
  ).trim();

  const bound = bindJtlContextPlaceholders(template, email, orderNo);
  if (!bound.ok) {
    return { status: 'skipped', port: 'no_match', message: bound.reason, variables: { 'jtl.context_found': false } };
  }
  const validation = validateReadOnlyMssqlQuery(bound.query);
  if (!validation.ok) return { status: 'error', port: 'error', message: validation.error };

  const result = await mssql.executeReadOnlyQuery({ workspaceId: context.workspaceId, query: validation.query });
  if (!result.success) return { status: 'error', port: 'error', message: result.error ?? 'MSSQL-Fehler' };

  const rows = result.rows ?? [];
  const first = rows[0];
  if (!first || typeof first !== 'object') {
    return { status: 'ok', port: 'no_match', message: 'Keine JTL-Daten gefunden', variables: { 'jtl.context_found': false } };
  }

  const mapping = parseJtlContextMapping(config.mapping);
  const variables: WorkflowVariableContext = { 'jtl.context_found': true };
  for (const [column, value] of Object.entries(first as Record<string, unknown>)) {
    const key = column.toLowerCase();
    variables[mapping[key] ?? `jtl.${key}`] = jtlContextScalar(value);
  }
  return { status: 'ok', port: 'default', variables };
}

function bindJtlContextPlaceholders(
  template: string,
  email: string,
  orderNo: string,
): { ok: true; query: string } | { ok: false; reason: string } {
  let query = template;
  if (query.includes('{{email}}')) {
    if (!email || !JTL_CONTEXT_EMAIL_RE.test(email)) {
      return { ok: false, reason: 'Keine gueltige Absender-E-Mail fuer {{email}}' };
    }
    query = query.replace(/\{\{email\}\}/g, sqlStringLiteral(email));
  }
  if (query.includes('{{orderNo}}')) {
    if (!orderNo || !JTL_CONTEXT_ORDER_NO_RE.test(orderNo)) {
      return { ok: false, reason: 'Keine gueltige Bestellnummer fuer {{orderNo}}' };
    }
    query = query.replace(/\{\{orderNo\}\}/g, sqlStringLiteral(orderNo));
  }
  return { ok: true, query };
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const JTL_ACTION_KINDS = new Set(['resend_invoice', 'create_return', 'send_tracking', 'refund_status', 'custom']);

/**
 * P2-11 (base): prepares a controlled JTL action proposal from the order context
 * WITHOUT executing it. It assembles an action descriptor (kind + payload from
 * the `jtl.*` context variables) and exposes it as `jtl.action.*` variables, then
 * routes to `needs_review` (default — human approval) or `approved`. Actually
 * performing the write in JTL (resend invoice / create return) is the documented
 * next step, gated behind approval + allowlist + rate-limit.
 */
function executeWorkflowJtlPrepareAction(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): NodeResult {
  const kind = String(config.kind ?? '').trim().toLowerCase();
  if (!kind || !JTL_ACTION_KINDS.has(kind)) {
    return { status: 'error', port: 'error', message: `Unbekannte JTL-Aktion: ${kind || '(leer)'}` };
  }
  const email = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
  const orderNo = String(context.variables['jtl.order_no'] ?? config.orderNo ?? '').trim();
  const tracking = String(context.variables['jtl.tracking'] ?? context.variables['jtl.tracking_number'] ?? '').trim();
  const payload = {
    kind,
    email: email || null,
    orderNo: orderNo || null,
    tracking: tracking || null,
    note: typeof config.note === 'string' ? config.note.slice(0, 500) : null,
  };
  const requireApproval = config.requireApproval !== false;
  return {
    status: 'ok',
    port: requireApproval ? 'needs_review' : 'approved',
    message: `jtl_action:prepared:${kind}`,
    variables: {
      'jtl.action.kind': kind,
      'jtl.action.payload': JSON.stringify(payload),
      'jtl.action.prepared': true,
    },
  };
}

// ---------------------------------------------------------------------------
// Returns / RMA workflow nodes (Phase 3)
//
// These operate on the workspace's OWN returns table — JTL is never written.
// A run resolves "its" return via (in order): config.returnId → the
// `returns.id` variable set by a prior node → the return linked to the
// triggering email (returns.email_message_id = context.messageId). When none
// is found the nodes route to the `no_return` port instead of failing, so a
// returns workflow placed on a generic inbox simply no-ops on unrelated mail.
// ---------------------------------------------------------------------------

type WorkflowReturnRow = Selectable<ReturnsTable>;

type WorkflowReturnItemRow = Selectable<ReturnItemsTable>;

const RETURN_OUTCOME_PORTS = new Set(['refund', 'exchange', 'credit', 'keep', 'needs_review']);

const RETURN_STATUS_VALUES = new Set<ReturnStatus>([
  'pending',
  'approved',
  'received',
  'refunded',
  'exchanged',
  'credited',
  'rejected',
  'cancelled',
]);

function resolveWorkflowReturnId(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): { ok: true; returnId: number | null } | { ok: false; message: string } {
  const configured = optionalPositiveIntegerConfig(config.returnId, 'returnId');
  if (!configured.ok) return { ok: false, message: configured.message };
  if (configured.value !== undefined) return { ok: true, returnId: configured.value };
  const fromVar = positiveIntegerVariable(context.variables['returns.id']);
  return { ok: true, returnId: fromVar };
}

async function loadWorkflowReturn(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<
  | { ok: true; row: WorkflowReturnRow; items: WorkflowReturnItemRow[] }
  | { ok: true; row: null }
  | { ok: false; message: string }
> {
  const resolved = resolveWorkflowReturnId(context, config);
  if (!resolved.ok) return resolved;

  let row: WorkflowReturnRow | undefined;
  if (resolved.returnId !== null) {
    row = await trx
      .selectFrom('returns')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', resolved.returnId)
      .executeTakeFirst();
  } else if (context.messageId !== null) {
    row = await trx
      .selectFrom('returns')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('email_message_id', '=', context.messageId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }
  if (!row) return { ok: true, row: null };

  const items = await trx
    .selectFrom('return_items')
    .selectAll()
    .where('workspace_id', '=', context.workspaceId)
    .where('return_id', '=', Number(row.id))
    .orderBy('id', 'asc')
    .execute();
  return { ok: true, row, items };
}

function returnCsvSet(value: unknown, fallback: readonly string[]): Set<string> {
  if (typeof value !== 'string' || !value.trim()) return new Set(fallback);
  return new Set(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeReturnOutcomePort(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  return RETURN_OUTCOME_PORTS.has(normalized) ? normalized : fallback;
}

function normalizeReturnStatusConfig(value: unknown): ReturnStatus | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  return RETURN_STATUS_VALUES.has(normalized as ReturnStatus) ? (normalized as ReturnStatus) : null;
}

/**
 * Pure decision rules for `returns.evaluate`, factored out so the policy can be
 * unit-tested without a database. Precedence (fixed for safety):
 *   1. needs_review — any item condition in `reviewConditions` (default: damaged)
 *   2. exchange     — any item reason code in `exchangeReasonCodes`
 *                     (default: size_wrong, wrong_item)
 *   3. credit       — any item reason code in `creditReasonCodes` (default: none)
 *   4. default      — `defaultOutcome` (default: refund)
 * Conditions and reason codes are matched case-insensitively.
 */
export function decideWorkflowReturnOutcomePort(input: {
  itemConditions: readonly string[];
  itemReasonCodes: readonly string[];
  config: Record<string, unknown>;
}): string {
  const reviewConditions = returnCsvSet(input.config.reviewConditions, ['damaged']);
  const exchangeReasonCodes = returnCsvSet(input.config.exchangeReasonCodes, ['size_wrong', 'wrong_item']);
  const creditReasonCodes = returnCsvSet(input.config.creditReasonCodes, []);
  const defaultOutcome = normalizeReturnOutcomePort(input.config.defaultOutcome, 'refund');

  const conditions = input.itemConditions.map((cond) => cond.toLowerCase());
  const reasonCodes = input.itemReasonCodes.map((code) => code.toLowerCase());

  if (conditions.some((cond) => reviewConditions.has(cond))) return 'needs_review';
  if (reasonCodes.some((code) => exchangeReasonCodes.has(code))) return 'exchange';
  if (reasonCodes.some((code) => creditReasonCodes.has(code))) return 'credit';
  return defaultOutcome;
}

/**
 * returns.evaluate — read-only decision node. Suggests an outcome from the
 * return's items and routes to one of refund/exchange/credit/needs_review
 * (or no_return when no return is found). Wire each port to the matching
 * follow-up node. Rule precedence is fixed for safety:
 *   1. needs_review  — any item condition in `reviewConditions` (default: damaged)
 *   2. exchange      — any item reason code in `exchangeReasonCodes`
 *                      (default: size_wrong, wrong_item)
 *   3. credit        — any item reason code in `creditReasonCodes` (default: none)
 *   4. default       — `defaultOutcome` (default: refund)
 */
export async function evaluateWorkflowReturn(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const loaded = await loadWorkflowReturn(trx, context, config);
  if (!loaded.ok) return { status: 'error', port: 'error', message: loaded.message };
  if (loaded.row === null) {
    return {
      status: 'ok',
      port: 'no_return',
      message: 'Keine Retoure fuer diesen Lauf gefunden',
      variables: { 'returns.found': false },
    };
  }
  const { row, items } = loaded;

  const reasonIds = [...new Set(items.map((it) => it.reason_id).filter((id): id is number => id !== null))];
  const reasonCodeById = new Map<number, string>();
  if (reasonIds.length > 0) {
    const reasons = await trx
      .selectFrom('return_reasons')
      .select(['id', 'code'])
      .where('workspace_id', '=', context.workspaceId)
      .where('id', 'in', reasonIds)
      .execute();
    for (const reason of reasons) reasonCodeById.set(Number(reason.id), String(reason.code).toLowerCase());
  }
  const itemReasonCodes = new Set(
    items
      .map((it) => (it.reason_id !== null ? reasonCodeById.get(it.reason_id) : undefined))
      .filter((code): code is string => Boolean(code)),
  );
  const itemConditions = new Set(
    items
      .map((it) => it.condition)
      .filter((cond): cond is ReturnItemCondition => cond !== null)
      .map((cond) => cond.toLowerCase()),
  );

  const port = decideWorkflowReturnOutcomePort({
    itemConditions: [...itemConditions],
    itemReasonCodes: [...itemReasonCodes],
    config,
  });

  return {
    status: 'ok',
    port,
    message: `returns_evaluated:${row.return_number}:${port}`,
    variables: {
      'returns.found': true,
      'returns.id': Number(row.id),
      'returns.number': String(row.return_number),
      'returns.item_count': items.length,
      'returns.status': String(row.status),
      'returns.suggested_outcome': port,
    },
  };
}

/**
 * returns.offer_exchange / returns.offer_credit — set the linked return's
 * outcome (and optionally its status via config.status). Idempotent: a return
 * already at the target outcome/status is left untouched. Writes only to the
 * workspace's own returns table.
 */
export async function applyWorkflowReturnOutcome(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  outcome: Extract<ReturnOutcome, 'exchange' | 'credit'>,
  now: Date,
): Promise<NodeResult> {
  const loaded = await loadWorkflowReturn(trx, context, config);
  if (!loaded.ok) return { status: 'error', port: 'error', message: loaded.message };
  if (loaded.row === null) {
    return {
      status: 'skipped',
      port: 'no_return',
      message: 'Keine Retoure fuer diesen Lauf gefunden',
      variables: { 'returns.found': false },
    };
  }
  const { row } = loaded;
  const returnId = Number(row.id);

  if (config.status !== undefined && config.status !== '' && normalizeReturnStatusConfig(config.status) === null) {
    return { status: 'error', port: 'error', message: 'status ungueltig' };
  }
  const status = normalizeReturnStatusConfig(config.status);

  if (row.outcome === outcome && (status === null || row.status === status)) {
    return {
      status: 'ok',
      port: 'default',
      message: `returns_outcome_unchanged:${row.return_number}:${outcome}`,
      variables: { 'returns.found': true, 'returns.id': returnId, 'returns.outcome': outcome },
    };
  }

  const patch: { outcome: ReturnOutcome; updated_at: Date; status?: ReturnStatus } = {
    outcome,
    updated_at: now,
  };
  if (status !== null) patch.status = status;

  await trx
    .updateTable('returns')
    .set(patch)
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', returnId)
    .execute();

  return {
    status: 'ok',
    port: 'default',
    message: `returns_outcome:${row.return_number}:${outcome}`,
    variables: {
      'returns.found': true,
      'returns.id': returnId,
      'returns.number': String(row.return_number),
      'returns.outcome': outcome,
      ...(status !== null ? { 'returns.status': status } : {}),
    },
  };
}

function parseJtlContextMapping(value: unknown): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (typeof value !== 'string' || !value.trim()) return mapping;
  for (const pair of value.split(',')) {
    const [column, target] = pair.split(':').map((part) => part.trim());
    if (column && target) mapping[column.toLowerCase()] = target;
  }
  return mapping;
}

function jtlContextScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, 2_000);
}

function workflowJtlLookupEntityConfig(value: unknown): WorkflowJtlLookupEntityConfig {
  const normalized = String(value ?? 'firmen').trim().toLowerCase();
  if (normalized === 'firma' || normalized === 'firmen' || normalized === 'jtl_firmen') {
    return { ok: true, value: 'firmen' };
  }
  if (normalized === 'warenlager' || normalized === 'lager' || normalized === 'jtl_warenlager') {
    return { ok: true, value: 'warenlager' };
  }
  if (normalized === 'zahlungsart' || normalized === 'zahlungsarten' || normalized === 'jtl_zahlungsarten') {
    return { ok: true, value: 'zahlungsarten' };
  }
  if (normalized === 'versandart' || normalized === 'versandarten' || normalized === 'jtl_versandarten') {
    return { ok: true, value: 'versandarten' };
  }
  return { ok: false, message: 'JTL-Entity muss firmen, warenlager, zahlungsarten oder versandarten sein' };
}

function workflowJtlLookupLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 20;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(parsed)) return 20;
  return Math.max(1, Math.min(MAX_WORKFLOW_JTL_LOOKUP_LIMIT, parsed));
}

type OptionalSafeIntegerConfig =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

function optionalSafeIntegerConfig(value: unknown, field: string): OptionalSafeIntegerConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { ok: false, message: `${field} ungueltig` };
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed === 0) {
    return { ok: false, message: `${field} ungueltig` };
  }
  return { ok: true, value: parsed };
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const ERP_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'jtl.lookup': handleJtlLookup,
  'mssql.query': handleMssqlQuery,
  'jtl.order_context': handleJtlOrderContext,
  'jtl.prepare_action': handleJtlPrepareAction,
  'returns.evaluate': handleReturnsEvaluate,
  'returns.offer_exchange': handleReturnsOfferExchange,
  'returns.offer_credit': handleReturnsOfferCredit,
};
