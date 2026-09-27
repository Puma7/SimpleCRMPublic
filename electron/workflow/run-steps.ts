import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOWS_TABLE, EMAIL_WORKFLOW_RUNS_TABLE, EMAIL_WORKFLOW_RUN_STEPS_TABLE } from '../database-schema';
import {
  MESSAGE_WORKFLOW_RUNS_LIMIT,
  summarizeRunSteps,
  type MessageWorkflowRunSummary,
} from '../../shared/workflow-run-message-history';
import {
  parseWorkflowStepDetail,
  WORKFLOW_STEP_DETAIL_RETENTION_DAYS,
  type WorkflowStepDetail,
} from '../../packages/core/src/workflow/run-step-detail';

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

export type WorkflowRunStepListRow = {
  id: number;
  run_id: number;
  node_id: string;
  node_type: string;
  status: string;
  port: string | null;
  duration_ms: number;
  message: string | null;
  /** Eingang/Ausgang für die Lauf-Historie (null bei alten oder bereinigten Schritten). */
  detail: WorkflowStepDetail | null;
  created_at: string;
};

export function listWorkflowRunSteps(runId: number): WorkflowRunStepListRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, run_id, node_id, node_type, status, port, duration_ms, message, detail_json, created_at
       FROM ${EMAIL_WORKFLOW_RUN_STEPS_TABLE} WHERE run_id = ? ORDER BY id ASC`,
    )
    .all(runId) as (Omit<WorkflowRunStepListRow, 'detail'> & { detail_json: string | null })[];
  return rows.map(({ detail_json: detailJson, ...row }) => ({
    ...row,
    detail: parseWorkflowStepDetail(detailJson),
  }));
}

/**
 * Leert Eingang/Ausgang älterer Schritte (Aufbewahrung, Standard 30 Tage);
 * die Schrittzeile selbst bleibt für die Lauf-Übersicht. Gibt die Zahl der
 * geleerten Schritte zurück.
 */
export function pruneWorkflowRunStepDetails(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - WORKFLOW_STEP_DETAIL_RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
  const result = getDb()
    .prepare(
      `UPDATE ${EMAIL_WORKFLOW_RUN_STEPS_TABLE} SET detail_json = NULL
       WHERE detail_json IS NOT NULL AND created_at < ?`,
    )
    .run(cutoff);
  return Number(result.changes ?? 0);
}

export function getLatestWorkflowRunForMessage(messageId: number): {
  id: number;
  workflow_id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
} | null {
  const row = getDb()
    .prepare(
      `SELECT id, workflow_id, status, started_at, finished_at
       FROM ${EMAIL_WORKFLOW_RUNS_TABLE}
       WHERE message_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(messageId) as
    | {
        id: number;
        workflow_id: number;
        status: string;
        started_at: string | null;
        finished_at: string | null;
      }
    | undefined;
  return row ?? null;
}

/**
 * Alle Automatik-Läufe einer Mail (neueste zuerst) mit Zusammenfassung für das
 * Lesefenster. Zwei Abfragen (Läufe, dann ihre Schritte), kein N+1.
 */
export function listWorkflowRunsForMessage(
  messageId: number,
  limit = MESSAGE_WORKFLOW_RUNS_LIMIT,
): MessageWorkflowRunSummary[] {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.direction, r.status, r.started_at, r.finished_at
       FROM ${EMAIL_WORKFLOW_RUNS_TABLE} r
       LEFT JOIN ${EMAIL_WORKFLOWS_TABLE} w ON w.id = r.workflow_id
       WHERE r.message_id = ?
       ORDER BY r.id DESC
       LIMIT ?`,
    )
    .all(messageId, limit) as Array<{
      id: number;
      workflow_id: number | null;
      workflow_name: string | null;
      direction: string;
      status: string;
      started_at: string | null;
      finished_at: string | null;
    }>;
  if (runs.length === 0) return [];
  const steps = db
    .prepare(
      `SELECT run_id, node_type, status, port, message, detail_json
       FROM ${EMAIL_WORKFLOW_RUN_STEPS_TABLE}
       WHERE run_id IN (${runs.map(() => '?').join(', ')})
       ORDER BY id ASC`,
    )
    .all(...runs.map((run) => run.id)) as Array<{
      run_id: number;
      node_type: string;
      status: string;
      port: string | null;
      message: string | null;
      detail_json: string | null;
    }>;
  const stepsByRun = new Map<number, typeof steps>();
  for (const step of steps) {
    const list = stepsByRun.get(step.run_id) ?? [];
    list.push(step);
    stepsByRun.set(step.run_id, list);
  }
  return runs.map((run) => ({
    id: run.id,
    server_id: run.id,
    workflow_id: run.workflow_id,
    workflow_name: run.workflow_name?.trim() || `Workflow #${run.workflow_id ?? run.id}`,
    direction: run.direction,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    ...summarizeRunSteps((stepsByRun.get(run.id) ?? []).map((step) => ({
      node_type: step.node_type,
      status: step.status,
      port: step.port,
      message: step.message,
      detail: step.detail_json,
    }))),
  }));
}

function parseWorkflowRunLog(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [value];
    } catch {
      return [value];
    }
  }
  return [String(value)];
}

/** `undefined` = unknown run; `message_id` is null for runs without a message (cron, webhook). */
export function getWorkflowRunMessageId(runId: number): { message_id: number | null } | undefined {
  return getDb()
    .prepare(`SELECT message_id FROM ${EMAIL_WORKFLOW_RUNS_TABLE} WHERE id = ?`)
    .get(runId) as { message_id: number | null } | undefined;
}

export function getWorkflowRunLog(runId: number): string[] {
  const row = getDb()
    .prepare(
      `SELECT log_json FROM ${EMAIL_WORKFLOW_RUNS_TABLE} WHERE id = ?`,
    )
    .get(runId) as { log_json: string | null } | undefined;
  if (!row?.log_json) return [];
  return parseWorkflowRunLog(row.log_json);
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

const STEP_DETAIL_PRUNE_INTERVAL_MS = 24 * 60 * 60_000;
let lastStepDetailPruneAt = 0;

/** Höchstens einmal am Tag aus dem globalen Cron: alte Schritt-Details leeren. */
export function pruneWorkflowRunStepDetailsIfDue(
  logger: Pick<typeof console, 'warn' | 'debug'>,
  now: number = Date.now(),
): void {
  if (now - lastStepDetailPruneAt < STEP_DETAIL_PRUNE_INTERVAL_MS) return;
  lastStepDetailPruneAt = now;
  try {
    const cleared = pruneWorkflowRunStepDetails(new Date(now));
    if (cleared > 0) logger.debug(`[workflow] Eingang/Ausgang von ${cleared} alten Lauf-Schritten geleert`);
  } catch (error) {
    logger.warn('[workflow] Aufräumen der Lauf-Details fehlgeschlagen', error);
  }
}
