import type { EmailWorkflowRow } from '../email/email-workflow-store';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

export type WorkflowExportBundle = {
  version: 1;
  exportedAt: string;
  workflow: {
    name: string;
    trigger: string;
    priority: number;
    enabled: boolean;
    definition_json: string;
    graph_json: WorkflowGraphDocument | null;
    cron_expr: string | null;
    schedule_account_id: number | null;
    execution_mode: string;
    engine_version: number;
  };
};

export function exportWorkflowBundle(row: EmailWorkflowRow): WorkflowExportBundle {
  let graph: WorkflowGraphDocument | null = null;
  if (row.graph_json) {
    try {
      graph = JSON.parse(row.graph_json) as WorkflowGraphDocument;
    } catch {
      graph = null;
    }
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workflow: {
      name: row.name,
      trigger: row.trigger,
      priority: row.priority,
      enabled: Boolean(row.enabled),
      definition_json: row.definition_json,
      graph_json: graph,
      cron_expr: row.cron_expr,
      schedule_account_id: row.schedule_account_id,
      execution_mode: row.execution_mode ?? 'graph',
      engine_version: row.engine_version ?? 1,
    },
  };
}

export function parseWorkflowImport(json: string): WorkflowExportBundle {
  const parsed = JSON.parse(json) as WorkflowExportBundle;
  if (parsed.version !== 1 || !parsed.workflow?.name) {
    throw new Error('Ungültiges Workflow-Exportformat');
  }
  return parsed;
}
