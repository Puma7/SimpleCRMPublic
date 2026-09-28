/**
 * Plan 043: Logik-Knoten (Stopp, Variablen, Verzögerung, Schwelle, Weiche, Subflow).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import { type WorkflowGraphNode, messageIsSpamOrReviewForInboundWorkflow } from '@simplecrm/core';
import type { WorkspaceTransaction } from '../db/workspace-context';
import { dryRunSideEffectResult } from './dry-run';
import {
  RESERVED_WORKFLOW_VARIABLES,
  SUBFLOW_DEPTH_VARIABLE,
  booleanConfig,
  boundedContinuationStrings,
  inboundChainFieldsFromContext,
  loadWorkflow,
  normalizeWorkflowTrigger,
  optionalPositiveIntegerConfig,
  resolveResumeNodeAfter,
  serverCreatedSourceSqliteId,
  serverWorkerSourceRow,
  workflowContinuationContextError,
  workflowJobProvenance,
} from './shared';
import type { NodeResult, ServerNodeHandler, ServerNodeHandlerArgs, ServerWorkflowContext } from './types';

/** Hard cap on chained workflow.subflow depth (cycle / runaway fan-out guard). */
const MAX_SUBFLOW_DEPTH = 8;

const WORKFLOW_SPAM_SCORE_THRESHOLD_KEY = 'workflow_spam_score_threshold';

/** Knoten logic.stop, stop (vor dem Dry-Run-Schutz). */
async function handleLogicStop(_args: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return { status: 'ok', port: 'default', stop: true };
}

/** Knoten logic.stop_after_spam (vor dem Dry-Run-Schutz). */
async function handleLogicStopAfterSpam({ context }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const message = context.message;
  const spamStatus = String(context.variables['spam.status'] ?? message?.spam_status ?? '').toLowerCase();
  const spamLabel = String(
    context.variables['spam.label']
    ?? context.variables['spam.score_label']
    ?? message?.spam_score_label
    ?? '',
  ).toLowerCase();
  const isSpam =
    context.variables['email.is_spam'] === true
    || messageIsSpamOrReviewForInboundWorkflow({
      is_spam: message?.is_spam,
      spam_status: spamStatus || message?.spam_status,
      spam_score_label: spamLabel || message?.spam_score_label,
    });
  if (isSpam) {
    return {
      status: 'ok',
      port: 'default',
      stop: true,
      inboundChainStop: true,
      message: 'stop_after_spam',
    };
  }
  return { status: 'ok', port: 'default', message: 'not_spam:continue' };
}

/** Knoten logic.merge, logic.loop (vor dem Dry-Run-Schutz). */
async function handleLogicMerge(_args: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return { status: 'ok', port: 'default' };
}

/** Knoten logic.set_variable (vor dem Dry-Run-Schutz). */
async function handleLogicSetVariable({ config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const name = String(config.name ?? 'var').trim() || 'var';
  if (RESERVED_WORKFLOW_VARIABLES.includes(name)) {
    return { status: 'error', port: 'error', message: `Variable ${name} ist reserviert` };
  }
  const value = config.value;
  return {
    status: 'ok',
    port: 'default',
    variables: {
      [name]: typeof value === 'boolean' || typeof value === 'number' ? value : String(value ?? ''),
    },
  };
}

/** Knoten logic.delay (vor dem Dry-Run-Schutz). */
async function handleLogicDelay({ trx, doc, context, node, config, log, now, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  // Accept either delaySeconds (what the UI writes) or legacy minutes. When
  // both are present, delaySeconds wins; when neither is set, fall back to 5
  // minutes as before. boundedDelayMs caps the total delay.
  const totalMs = config.delaySeconds !== undefined
    ? boundedDelayMs(Number(config.delaySeconds ?? 60) * 1000)
    : boundedDelayMinutes(config.minutes) * 60_000;
  const resumeNodeId = String(config.resumeNodeId ?? '').trim()
    || resolveResumeNodeAfter(doc, node.id);
  if (!resumeNodeId) {
    return { status: 'error', port: 'error', message: 'Kein Folgeknoten fuer Resume' };
  }
  const executeAt = new Date(now.getTime() + totalMs);
  if (dryRun) {
    return dryRunSideEffectResult('logic.delay', log, {
      stop: true,
      deferred: true,
      message: `delayed_until:${executeAt.toISOString()}`,
      variables: { 'workflow.delayed_until': executeAt.toISOString() },
    });
  }
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const delayedJobId = await scheduleWorkflowDelay(trx, context, {
    resumeNodeId,
    executeAt,
    now,
  });
  return {
    status: 'ok',
    port: 'default',
    stop: true,
    deferred: true,
    message: `delayed_until:${executeAt.toISOString()}`,
    variables: { 'workflow.delayed_job.id': delayedJobId, 'workflow.delayed_until': executeAt.toISOString() },
  };
}

/** Knoten logic.threshold (vor dem Dry-Run-Schutz). */
async function handleLogicThreshold({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const field = String(config.variable ?? 'ai.spam_score');
  const raw = context.variables[field];
  const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  if (!Number.isFinite(num)) {
    return { status: 'error', port: 'error', message: `Variable ${field} ist keine Zahl` };
  }
  const useGlobalThreshold = booleanConfig(config.useGlobalThreshold, 'useGlobalThreshold', false);
  if (!useGlobalThreshold.ok) return { status: 'error', port: 'error', message: useGlobalThreshold.message };
  const threshold = useGlobalThreshold.value
    ? await loadWorkflowSpamScoreThreshold(trx, context.workspaceId)
    : Number(config.value ?? 70);
  if (!Number.isFinite(threshold)) {
    return { status: 'error', port: 'error', message: 'Schwellwert ungueltig' };
  }
  const op = String(config.operator ?? 'gte') === 'lte' ? 'lte' : 'gte';
  const matched = op === 'gte' ? num >= threshold : num <= threshold;
  return { status: 'ok', port: matched ? 'yes' : 'no', variables: { 'threshold.matched': matched } };
}

/** Knoten logic.switch (vor dem Dry-Run-Schutz). */
async function handleLogicSwitch({ context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const field = String(config.field ?? 'ai.class');
  const raw = context.variables[field] != null
    ? String(context.variables[field])
    : context.strings[field] ?? '';
  const value = raw.trim().toLowerCase();
  const cases = String(config.cases ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return { status: 'ok', port: cases.includes(value) ? value : 'default' };
}

/** Knoten workflow.subflow. */
async function handleWorkflowSubflow({ trx, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await enqueueWorkflowSubflow(trx, context, node, config, now);
}

async function scheduleWorkflowDelay(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  input: { resumeNodeId: string; executeAt: Date; now: Date },
): Promise<number> {
  const delayedContext = workflowDelayContext(context, input.resumeNodeId);
  const delayedRow = await trx
    .insertInto('workflow_delayed_jobs')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'workflow_delayed_jobs',
        context.workspaceId,
        String(context.workflowSourceSqliteId),
        String(context.messageSourceSqliteId ?? context.messageId ?? 'none'),
        input.resumeNodeId,
        input.executeAt.toISOString(),
      ),
      workflow_source_sqlite_id: context.workflowSourceSqliteId,
      message_source_sqlite_id: context.messageSourceSqliteId,
      workflow_id: context.workflowId,
      message_id: context.messageId,
      resume_node_id: input.resumeNodeId,
      execute_at: input.executeAt,
      context_json: delayedContext,
      status: 'pending',
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: input.now,
      updated_at: input.now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const delayedJobId = Number(delayedRow.id);

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        ...workflowJobProvenance(context),
        ...(context.messageId === null ? {} : { messageId: context.messageId }),
        delayedJobId,
        triggerName: context.trigger,
        context: delayedContext,
      },
      run_after: input.executeAt,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: input.now,
    })
    .execute();

  return delayedJobId;
}

async function loadWorkflowSpamScoreThreshold(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', WORKFLOW_SPAM_SCORE_THRESHOLD_KEY)
    .executeTakeFirst();
  return boundedWorkflowSpamScoreThreshold(row?.value);
}

function boundedWorkflowSpamScoreThreshold(value: unknown): number {
  const parsed = Number(value ?? 70);
  if (!Number.isFinite(parsed)) return 70;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function workflowDelayContext(
  context: ServerWorkflowContext,
  resumeNodeId: string,
): Record<string, unknown> {
  return {
    resumeNodeId,
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
    ...inboundChainFieldsFromContext(context),
  };
}

function boundedDelayMinutes(value: unknown): number {
  const parsed = Number(value ?? 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(60 * 24 * 7, Math.trunc(parsed)));
}

/** Total delay cap: 7 days in milliseconds; floor: 1 second so sub-second
 *  configurations don't collapse to 0 and break scheduling. */
function boundedDelayMs(value: unknown): number {
  const parsed = Number(value ?? 60_000);
  if (!Number.isFinite(parsed)) return 60_000;
  return Math.max(1_000, Math.min(7 * 24 * 60 * 60_000, Math.trunc(parsed)));
}

async function enqueueWorkflowSubflow(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const configuredWorkflowId = optionalPositiveIntegerConfig(config.workflowId, 'workflowId');
  if (!configuredWorkflowId.ok) return { status: 'error', port: 'error', message: configuredWorkflowId.message };
  const workflowId = configuredWorkflowId.value;
  if (!workflowId || workflowId === context.workflowId) {
    return { status: 'error', port: 'error', message: 'Ungueltige Subflow-ID' };
  }

  // Depth guard: the direct self-reference check above does not stop an indirect
  // cycle (A → B → A). For message-less / non-inbound subflows there is no
  // applied-marker to break the loop, so without a depth cap the pair would
  // enqueue each other forever and exhaust the job queue. Carry the depth in a
  // reserved variable that rides along in eventVariables into each child run.
  const rawDepth = context.variables[SUBFLOW_DEPTH_VARIABLE];
  const subflowDepth = typeof rawDepth === 'number'
    && Number.isInteger(rawDepth)
    && rawDepth >= 0
    ? rawDepth
    : 0;
  if (subflowDepth >= MAX_SUBFLOW_DEPTH) {
    return {
      status: 'error',
      port: 'error',
      message: `Subflow-Tiefe ${MAX_SUBFLOW_DEPTH} überschritten (mögliche Rekursion) — Subflow nicht eingereiht`,
    };
  }

  const subflow = await loadWorkflow(trx, context.workspaceId, workflowId);
  if (!subflow?.enabled) {
    return { status: 'error', port: 'error', message: 'Subflow nicht gefunden oder inaktiv' };
  }

  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    workflowId,
    ...workflowJobProvenance(context),
    triggerName: normalizeWorkflowTrigger(subflow.trigger_name),
    context: {
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: { ...context.variables, [SUBFLOW_DEPTH_VARIABLE]: subflowDepth + 1 },
      subflowParent: {
        workflowId: context.workflowId,
        runId: context.runId,
        nodeId: node.id,
      },
    },
  };
  if (context.messageId !== null) payload.messageId = context.messageId;

  const row = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload,
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
    message: `queued_subflow:${jobId}`,
    variables: {
      'subflow.status': 'queued',
      'subflow.job_id': jobId,
      'subflow.workflow_id': workflowId,
    },
  };
}

/** Knoten dieser Kategorie vor dem Dry-Run-Schutz. */
export const LOGIC_PRE_GUARD_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'logic.stop': handleLogicStop,
  stop: handleLogicStop,
  'logic.stop_after_spam': handleLogicStopAfterSpam,
  'logic.merge': handleLogicMerge,
  'logic.loop': handleLogicMerge,
  'logic.set_variable': handleLogicSetVariable,
  'logic.delay': handleLogicDelay,
  'logic.threshold': handleLogicThreshold,
  'logic.switch': handleLogicSwitch,
};

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const LOGIC_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'workflow.subflow': handleWorkflowSubflow,
};
