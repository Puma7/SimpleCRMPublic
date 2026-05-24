import { getDb } from '../sqlite-service';
import {
  EMAIL_WORKFLOWS_TABLE,
  EMAIL_WORKFLOW_RUNS_TABLE,
  EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE,
} from '../database-schema';
import { DEFAULT_INBOUND_WORKFLOW, DEFAULT_OUTBOUND_WORKFLOW } from './email-workflow-defaults';

export type EmailWorkflowRow = {
  id: number;
  name: string;
  trigger: string;
  enabled: number;
  priority: number;
  definition_json: string;
  graph_json: string | null;
  cron_expr: string | null;
  schedule_account_id: number | null;
  execution_mode: string;
  engine_version: number;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function mapWorkflowRow(row: Record<string, unknown>): EmailWorkflowRow {
  return {
    ...(row as EmailWorkflowRow),
    execution_mode: String(row.execution_mode ?? 'graph'),
    engine_version: Number(row.engine_version ?? 1),
  };
}

export function ensureDefaultWorkflowsSeeded(): void {
  const count = getDb()
    .prepare(`SELECT COUNT(*) as c FROM ${EMAIL_WORKFLOWS_TABLE}`)
    .get() as { c: number };
  if (count.c > 0) return;

  const ins = getDb().prepare(
    `INSERT INTO ${EMAIL_WORKFLOWS_TABLE} (name, trigger, enabled, priority, definition_json, graph_json, cron_expr, schedule_account_id, execution_mode, engine_version, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, NULL, NULL, NULL, 'graph', 1, ?, ?)`,
  );
  const t = nowIso();
  ins.run(
    'Eingehend: Amazon & Newsletter',
    'inbound',
    10,
    JSON.stringify(DEFAULT_INBOUND_WORKFLOW),
    t,
    t,
  );
  ins.run(
    'Ausgehend: Sensible Inhalte prüfen',
    'outbound',
    10,
    JSON.stringify(DEFAULT_OUTBOUND_WORKFLOW),
    t,
    t,
  );
}

export function listWorkflowsByTrigger(trigger: string): EmailWorkflowRow[] {
  ensureDefaultWorkflowsSeeded();
  const stmt = getDb().prepare(
    `SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} WHERE trigger = ? AND enabled = 1 ORDER BY priority ASC, id ASC`,
  );
  return (stmt.all(trigger) as Record<string, unknown>[]).map(mapWorkflowRow);
}

export function listWorkflowsWithCron(): EmailWorkflowRow[] {
  ensureDefaultWorkflowsSeeded();
  const rows = getDb()
    .prepare(
      `SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} WHERE cron_expr IS NOT NULL AND TRIM(cron_expr) != '' AND enabled = 1 ORDER BY priority ASC, id ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapWorkflowRow);
}

export function listAllWorkflows(): EmailWorkflowRow[] {
  ensureDefaultWorkflowsSeeded();
  const rows = getDb()
    .prepare(`SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} ORDER BY trigger ASC, priority ASC, id ASC`)
    .all() as Record<string, unknown>[];
  return rows.map(mapWorkflowRow);
}

export function getWorkflowById(id: number): EmailWorkflowRow | undefined {
  const row = getDb().prepare(`SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapWorkflowRow(row) : undefined;
}

export function createWorkflow(input: {
  name: string;
  trigger: string;
  priority?: number;
  definitionJson: string;
  graphJson?: string | null;
  cronExpr?: string | null;
  scheduleAccountId?: number | null;
  executionMode?: string;
  engineVersion?: number;
  enabled?: boolean;
}): number {
  const t = nowIso();
  const result = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_WORKFLOWS_TABLE} (name, trigger, enabled, priority, definition_json, graph_json, cron_expr, schedule_account_id, execution_mode, engine_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.trigger,
      input.enabled === false ? 0 : 1,
      input.priority ?? 100,
      input.definitionJson,
      input.graphJson ?? null,
      input.cronExpr ?? null,
      input.scheduleAccountId ?? null,
      input.executionMode ?? 'graph',
      input.engineVersion ?? 1,
      t,
      t,
    );
  return Number(result.lastInsertRowid);
}

export type WorkflowUpdateInput = Partial<{
  name: string;
  trigger: string;
  priority: number;
  definitionJson: string;
  /** `undefined` = leave unchanged, `null` = clear column */
  graphJson: string | null;
  cronExpr: string | null;
  scheduleAccountId: number | null;
  executionMode: string;
  engineVersion: number;
  enabled: boolean;
}>;

export function updateWorkflow(id: number, input: WorkflowUpdateInput): void {
  const existing = getWorkflowById(id);
  if (!existing) throw new Error('Workflow nicht gefunden');
  const t = nowIso();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    vals.push(input.name);
  }
  if (input.trigger !== undefined) {
    sets.push('trigger = ?');
    vals.push(input.trigger);
  }
  if (input.priority !== undefined) {
    sets.push('priority = ?');
    vals.push(input.priority);
  }
  if (input.definitionJson !== undefined) {
    sets.push('definition_json = ?');
    vals.push(input.definitionJson);
  }
  if (input.graphJson !== undefined) {
    sets.push('graph_json = ?');
    vals.push(input.graphJson);
  }
  if (input.cronExpr !== undefined) {
    sets.push('cron_expr = ?');
    vals.push(input.cronExpr);
  }
  if (input.enabled !== undefined) {
    sets.push('enabled = ?');
    vals.push(input.enabled ? 1 : 0);
  }
  if (input.scheduleAccountId !== undefined) {
    sets.push('schedule_account_id = ?');
    vals.push(input.scheduleAccountId);
  }
  if (input.executionMode !== undefined) {
    sets.push('execution_mode = ?');
    vals.push(input.executionMode);
  }
  if (input.engineVersion !== undefined) {
    sets.push('engine_version = ?');
    vals.push(input.engineVersion);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(t, id);
  getDb()
    .prepare(`UPDATE ${EMAIL_WORKFLOWS_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}

export function deleteWorkflow(id: number): void {
  getDb().prepare(`DELETE FROM ${EMAIL_WORKFLOWS_TABLE} WHERE id = ?`).run(id);
}

export function wasWorkflowAppliedToMessage(messageId: number, workflowId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM ${EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE} WHERE message_id = ? AND workflow_id = ?`,
    )
    .get(messageId, workflowId);
  return Boolean(row);
}

export function markWorkflowAppliedToMessage(messageId: number, workflowId: number): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE} (message_id, workflow_id) VALUES (?, ?)`,
    )
    .run(messageId, workflowId);
}

/** Clears inbound applied flags so backfill can re-run rules after workflow edits. */
export function clearInboundWorkflowAppliedForMessage(messageId: number): void {
  getDb()
    .prepare(
      `DELETE FROM ${EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE}
       WHERE message_id = ? AND workflow_id IN (
         SELECT id FROM ${EMAIL_WORKFLOWS_TABLE} WHERE trigger = 'inbound'
       )`,
    )
    .run(messageId);
}

export function insertWorkflowRun(input: {
  workflowId: number;
  messageId: number | null;
  direction: 'inbound' | 'outbound' | 'schedule' | 'draft_created';
  status: 'ok' | 'error' | 'blocked';
  logJson: string;
}): void {
  const finished = nowIso();
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_WORKFLOW_RUNS_TABLE} (workflow_id, message_id, direction, status, log_json, finished_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.workflowId,
      input.messageId,
      input.direction,
      input.status,
      input.logJson,
      finished,
    );
}
