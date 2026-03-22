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
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function ensureDefaultWorkflowsSeeded(): void {
  const count = getDb()
    .prepare(`SELECT COUNT(*) as c FROM ${EMAIL_WORKFLOWS_TABLE}`)
    .get() as { c: number };
  if (count.c > 0) return;

  const ins = getDb().prepare(
    `INSERT INTO ${EMAIL_WORKFLOWS_TABLE} (name, trigger, enabled, priority, definition_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)`,
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

export function listWorkflowsByTrigger(trigger: 'inbound' | 'outbound'): EmailWorkflowRow[] {
  ensureDefaultWorkflowsSeeded();
  const stmt = getDb().prepare(
    `SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} WHERE trigger = ? AND enabled = 1 ORDER BY priority ASC, id ASC`,
  );
  return stmt.all(trigger) as EmailWorkflowRow[];
}

export function listAllWorkflows(): EmailWorkflowRow[] {
  ensureDefaultWorkflowsSeeded();
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} ORDER BY trigger ASC, priority ASC, id ASC`)
    .all() as EmailWorkflowRow[];
}

export function getWorkflowById(id: number): EmailWorkflowRow | undefined {
  return getDb().prepare(`SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} WHERE id = ?`).get(id) as
    | EmailWorkflowRow
    | undefined;
}

export function createWorkflow(input: {
  name: string;
  trigger: 'inbound' | 'outbound';
  priority?: number;
  definitionJson: string;
  enabled?: boolean;
}): number {
  const t = nowIso();
  const result = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_WORKFLOWS_TABLE} (name, trigger, enabled, priority, definition_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.trigger,
      input.enabled === false ? 0 : 1,
      input.priority ?? 100,
      input.definitionJson,
      t,
      t,
    );
  return Number(result.lastInsertRowid);
}

export function updateWorkflow(
  id: number,
  input: Partial<{ name: string; trigger: 'inbound' | 'outbound'; priority: number; definitionJson: string; enabled: boolean }>,
): void {
  const existing = getWorkflowById(id);
  if (!existing) throw new Error('Workflow nicht gefunden');
  const t = nowIso();
  getDb()
    .prepare(
      `UPDATE ${EMAIL_WORKFLOWS_TABLE} SET
        name = COALESCE(?, name),
        trigger = COALESCE(?, trigger),
        priority = COALESCE(?, priority),
        definition_json = COALESCE(?, definition_json),
        enabled = COALESCE(?, enabled),
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      input.name ?? null,
      input.trigger ?? null,
      input.priority ?? null,
      input.definitionJson ?? null,
      input.enabled === undefined ? null : input.enabled ? 1 : 0,
      t,
      id,
    );
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

export function insertWorkflowRun(input: {
  workflowId: number;
  messageId: number | null;
  direction: 'inbound' | 'outbound';
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
