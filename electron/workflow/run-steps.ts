import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOW_RUNS_TABLE, EMAIL_WORKFLOW_RUN_STEPS_TABLE } from '../database-schema';

export function startWorkflowRun(input: {
  workflowId: number;
  messageId: number | null;
  direction: string;
}): number {
  const started = new Date().toISOString();
  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_WORKFLOW_RUNS_TABLE} (workflow_id, message_id, direction, status, log_json, started_at, finished_at)
       VALUES (?, ?, ?, 'running', '[]', ?, NULL)`,
    )
    .run(input.workflowId, input.messageId, input.direction, started);
  return Number(r.lastInsertRowid);
}

export function finishWorkflowRun(
  runId: number,
  input: { status: 'ok' | 'error' | 'blocked'; logJson: string },
): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_WORKFLOW_RUNS_TABLE} SET status = ?, log_json = ?, finished_at = ? WHERE id = ?`,
    )
    .run(input.status, input.logJson, new Date().toISOString(), runId);
}

export function insertWorkflowRunStep(input: {
  runId: number;
  nodeId: string;
  nodeType: string;
  status: 'ok' | 'error' | 'skipped';
  port?: string | null;
  durationMs: number;
  message?: string | null;
  detailJson?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_WORKFLOW_RUN_STEPS_TABLE}
       (run_id, node_id, node_type, status, port, duration_ms, message, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.runId,
      input.nodeId,
      input.nodeType,
      input.status,
      input.port ?? null,
      input.durationMs,
      input.message ?? null,
      input.detailJson ?? null,
      new Date().toISOString(),
    );
}

export function listWorkflowRunSteps(runId: number): {
  id: number;
  run_id: number;
  node_id: string;
  node_type: string;
  status: string;
  port: string | null;
  duration_ms: number;
  message: string | null;
  created_at: string;
}[] {
  return getDb()
    .prepare(
      `SELECT id, run_id, node_id, node_type, status, port, duration_ms, message, created_at
       FROM ${EMAIL_WORKFLOW_RUN_STEPS_TABLE} WHERE run_id = ? ORDER BY id ASC`,
    )
    .all(runId) as {
    id: number;
    run_id: number;
    node_id: string;
    node_type: string;
    status: string;
    port: string | null;
    duration_ms: number;
    message: string | null;
    created_at: string;
  }[];
}

export function listRecentWorkflowRuns(workflowId: number, limit = 20): {
  id: number;
  workflow_id: number;
  message_id: number | null;
  direction: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}[] {
  return getDb()
    .prepare(
      `SELECT id, workflow_id, message_id, direction, status, started_at, finished_at
       FROM ${EMAIL_WORKFLOW_RUNS_TABLE} WHERE workflow_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(workflowId, limit) as {
    id: number;
    workflow_id: number;
    message_id: number | null;
    direction: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
  }[];
}
