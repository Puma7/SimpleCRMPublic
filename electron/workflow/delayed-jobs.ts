import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import { WORKFLOW_DELAYED_JOBS_TABLE } from '../database-schema';
import { getWorkflowById } from '../email/email-workflow-store';
import { getEmailMessageById } from '../email/email-store';
import { parseGraphDocument } from './runtime';
import { executeWorkflowForTrigger } from './workflow-executor';
import { workflowDirectionForTrigger } from './workflow-trigger-utils';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

export type DelayedJobRow = {
  id: number;
  workflow_id: number;
  message_id: number | null;
  resume_node_id: string | null;
  execute_at: string;
  context_json: string | null;
  status: string;
  created_at: string;
};

const PROCESSING = new Set<number>();
const MAX_DELAYED_JOB_RETRIES = 3;
const NON_RETRYABLE_FAILURES = [
  'workflow_disabled',
  'missing_resume_node',
  'delay_requires_graph_mode',
  'missing_graph',
];

/** Reset jobs stuck in `running` after a crash (call on app boot). */
export function recoverStaleDelayedJobs(): void {
  getDb()
    .prepare(
      `UPDATE ${WORKFLOW_DELAYED_JOBS_TABLE}
       SET status = 'pending'
       WHERE status = 'running'`,
    )
    .run();
}

export function scheduleDelayedJob(input: {
  workflowId: number;
  messageId: number | null;
  resumeNodeId: string;
  executeAt: string;
  contextJson: string;
}): number {
  const existing = getDb()
    .prepare(
      `SELECT id FROM ${WORKFLOW_DELAYED_JOBS_TABLE}
       WHERE workflow_id = ? AND resume_node_id = ?
         AND ((message_id IS NULL AND ? IS NULL) OR message_id = ?)
         AND status IN ('pending', 'running')
       LIMIT 1`,
    )
    .get(input.workflowId, input.resumeNodeId, input.messageId, input.messageId) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  const r = getDb()
    .prepare(
      `INSERT INTO ${WORKFLOW_DELAYED_JOBS_TABLE}
       (workflow_id, message_id, resume_node_id, execute_at, context_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      input.workflowId,
      input.messageId,
      input.resumeNodeId,
      input.executeAt,
      input.contextJson,
      new Date().toISOString(),
    );
  return Number(r.lastInsertRowid);
}

export function listDueDelayedJobs(limit = 20): DelayedJobRow[] {
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      `SELECT * FROM ${WORKFLOW_DELAYED_JOBS_TABLE}
       WHERE status = 'pending' AND execute_at <= ?
       ORDER BY execute_at ASC
       LIMIT ?`,
    )
    .all(now, limit) as DelayedJobRow[];
}

function tryClaimDelayedJob(id: number): boolean {
  const r = getDb()
    .prepare(
      `UPDATE ${WORKFLOW_DELAYED_JOBS_TABLE} SET status = 'running' WHERE id = ? AND status = 'pending'`,
    )
    .run(id);
  return r.changes === 1;
}

function delayedJobRetryKey(id: number): string {
  return `delayed_job_retry:${id}`;
}

function markJob(id: number, status: 'running' | 'done' | 'failed' | 'cancelled', note?: string): void {
  if (note) {
    console.warn(`[workflow] delayed job ${id} ${status}: ${note}`);
  }
  getDb()
    .prepare(`UPDATE ${WORKFLOW_DELAYED_JOBS_TABLE} SET status = ? WHERE id = ?`)
    .run(status, id);
}

function maybeRequeueFailedJob(id: number, note?: string): void {
  if (note && NON_RETRYABLE_FAILURES.some((f) => note.includes(f))) {
    markJob(id, 'failed', note);
    return;
  }
  const key = delayedJobRetryKey(id);
  const tries = parseInt(getSyncInfo(key) ?? '0', 10) + 1;
  if (tries >= MAX_DELAYED_JOB_RETRIES) {
    markJob(id, 'failed', note);
    setSyncInfo(key, '0');
    return;
  }
  setSyncInfo(key, String(tries));
  const retryAt = new Date(Date.now() + tries * 5 * 60_000).toISOString();
  getDb()
    .prepare(
      `UPDATE ${WORKFLOW_DELAYED_JOBS_TABLE}
       SET status = 'pending', execute_at = ?
       WHERE id = ?`,
    )
    .run(retryAt, id);
  console.warn(`[workflow] delayed job ${id} requeued (${tries}/${MAX_DELAYED_JOB_RETRIES})`);
}

export async function processDueDelayedJobs(
  logger: Pick<typeof console, 'warn' | 'debug'>,
): Promise<number> {
  const due = listDueDelayedJobs();
  let processed = 0;
  for (const job of due) {
    if (PROCESSING.has(job.id)) continue;
    if (!tryClaimDelayedJob(job.id)) continue;
    PROCESSING.add(job.id);
    try {
      const wf = getWorkflowById(job.workflow_id);
      if (!wf?.enabled) {
        markJob(job.id, 'cancelled', 'workflow_disabled');
        continue;
      }
      const resumeId = (job.resume_node_id ?? '').trim();
      if (!resumeId) {
        markJob(job.id, 'failed', 'missing_resume_node');
        continue;
      }
      const mode = wf.execution_mode ?? 'graph';
      if (mode === 'compiled') {
        markJob(job.id, 'failed', 'delay_requires_graph_mode');
        continue;
      }
      const doc = parseGraphDocument(wf.graph_json);
      if (!doc) {
        markJob(job.id, 'failed', 'missing_graph');
        continue;
      }
      const message = job.message_id != null ? getEmailMessageById(job.message_id) ?? null : null;
      let variables: Record<string, string | number | boolean | null> = {};
      let inboundConditionOk = false;
      let eventStrings: Record<string, string> | undefined;
      if (job.context_json) {
        try {
          const parsed = JSON.parse(job.context_json) as {
            variables?: Record<string, unknown>;
            inboundConditionOk?: boolean;
            eventStrings?: Record<string, string>;
          };
          if (parsed.inboundConditionOk) inboundConditionOk = true;
          if (parsed.eventStrings && typeof parsed.eventStrings === 'object') {
            eventStrings = parsed.eventStrings;
          }
          if (parsed.variables && typeof parsed.variables === 'object') {
            for (const [k, v] of Object.entries(parsed.variables)) {
              if (
                typeof v === 'string' ||
                typeof v === 'number' ||
                typeof v === 'boolean' ||
                v === null
              ) {
                variables[k] = v;
              }
            }
          }
        } catch {
          /* ignore corrupt context */
        }
      }
      if (inboundConditionOk) {
        variables.__inbound_condition_ok = true;
      }
      const trigger = (wf.trigger as WorkflowTriggerKind) || 'inbound';
      const direction = workflowDirectionForTrigger(trigger);

      const result = await executeWorkflowForTrigger({
        workflow: wf,
        trigger,
        direction,
        message,
        startNodeId: resumeId,
        initialVariables: variables,
        eventStrings,
        dryRun: false,
      });
      if (result.status === 'blocked') {
        markJob(job.id, 'cancelled', result.log.join(';').slice(0, 500));
      } else if (result.status === 'error') {
        maybeRequeueFailedJob(job.id, result.log.join(';').slice(0, 500));
      } else {
        markJob(job.id, 'done');
        setSyncInfo(delayedJobRetryKey(job.id), '0');
      }
      processed += 1;
    } catch (e) {
      logger.warn('[workflow] delayed job failed', job.id, e);
      maybeRequeueFailedJob(job.id, e instanceof Error ? e.message : String(e));
    } finally {
      PROCESSING.delete(job.id);
    }
  }
  return processed;
}
