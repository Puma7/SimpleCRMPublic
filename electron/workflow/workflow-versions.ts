import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOW_VERSIONS_TABLE } from '../database-schema';
import { getWorkflowById } from '../email/email-workflow-store';

export type WorkflowVersionRow = {
  id: number;
  workflow_id: number;
  label: string;
  graph_json: string;
  definition_json: string;
  created_at: string;
};

export function saveWorkflowVersion(workflowId: number, label?: string): number {
  const wf = getWorkflowById(workflowId);
  if (!wf) throw new Error('Workflow nicht gefunden');
  const t = new Date().toISOString();
  const versionLabel =
    label?.trim() ||
    `v ${t.slice(0, 16).replace('T', ' ')}`;
  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_WORKFLOW_VERSIONS_TABLE}
       (workflow_id, label, graph_json, definition_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      workflowId,
      versionLabel,
      wf.graph_json ?? '',
      wf.definition_json,
      t,
    );
  return Number(r.lastInsertRowid);
}

export function listWorkflowVersions(workflowId: number): WorkflowVersionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM ${EMAIL_WORKFLOW_VERSIONS_TABLE}
       WHERE workflow_id = ? ORDER BY id DESC LIMIT 50`,
    )
    .all(workflowId) as WorkflowVersionRow[];
}

export function getWorkflowVersion(id: number): WorkflowVersionRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_WORKFLOW_VERSIONS_TABLE} WHERE id = ?`)
    .get(id) as WorkflowVersionRow | undefined;
}

export function pruneWorkflowVersions(workflowId: number, keep = 30): void {
  getDb()
    .prepare(
      `DELETE FROM ${EMAIL_WORKFLOW_VERSIONS_TABLE}
       WHERE workflow_id = ? AND id NOT IN (
         SELECT id FROM ${EMAIL_WORKFLOW_VERSIONS_TABLE}
         WHERE workflow_id = ?
         ORDER BY id DESC LIMIT ?
       )`,
    )
    .run(workflowId, workflowId, keep);
}
