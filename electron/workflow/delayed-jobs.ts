import { getDb } from '../sqlite-service';
import { WORKFLOW_DELAYED_JOBS_TABLE } from '../database-schema';
import { getWorkflowById } from '../email/email-workflow-store';
import { getEmailMessageById } from '../email/email-store';
import { parseGraphDocument } from './runtime';
import { executeWorkflowForTrigger } from './workflow-executor';
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

export function scheduleDelayedJob(input: {
  workflowId: number;
  messageId: number | null;
  resumeNodeId: string;
  executeAt: string;
  contextJson: string;
}): number {
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

function markJob(id: number, status: 'running' | 'done' | 'failed' | 'cancelled', note?: string): void {
  if (note) {
    console.warn(`[workflow] delayed job ${id} ${status}: ${note}`);
  }
  getDb()
    .prepare(`UPDATE ${WORKFLOW_DELAYED_JOBS_TABLE} SET status = ? WHERE id = ?`)
    .run(status, id);
}

export async function processDueDelayedJobs(
  logger: Pick<typeof console, 'warn' | 'debug'>,
): Promise<number> {
  const due = listDueDelayedJobs();
  let processed = 0;
  for (const job of due) {
    if (PROCESSING.has(job.id)) continue;
    PROCESSING.add(job.id);
    try {
      markJob(job.id, 'running');
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
      const doc = parseGraphDocument(wf.graph_json);
      if (!doc) {
        markJob(job.id, 'failed', 'missing_graph');
        continue;
      }
      const message = job.message_id != null ? getEmailMessageById(job.message_id) ?? null : null;
      let variables: Record<string, string | number | boolean | null> = {};
      if (job.context_json) {
        try {
          const parsed = JSON.parse(job.context_json) as { variables?: Record<string, unknown> };
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
      const trigger = (wf.trigger as WorkflowTriggerKind) || 'inbound';
      const direction =
        trigger === 'outbound'
          ? 'outbound'
          : trigger === 'draft_created'
            ? 'draft_created'
            : trigger === 'schedule'
              ? 'schedule'
              : trigger.startsWith('crm.') || trigger === 'task.due' || trigger === 'calendar.event_start'
                ? 'crm_event'
                : 'inbound';

      const result = await executeWorkflowForTrigger({
        workflow: wf,
        trigger,
        direction,
        message,
        startNodeId: resumeId,
        initialVariables: variables,
        dryRun: false,
      });
      if (result.status === 'error') {
        markJob(job.id, 'failed', result.log.join(';').slice(0, 500));
      } else {
        markJob(job.id, 'done');
      }
      processed += 1;
    } catch (e) {
      logger.warn('[workflow] delayed job failed', job.id, e);
      markJob(job.id, 'failed', e instanceof Error ? e.message : String(e));
    } finally {
      PROCESSING.delete(job.id);
    }
  }
  return processed;
}
