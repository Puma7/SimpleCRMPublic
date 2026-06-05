import type { WorkflowGraphDocument } from './email-workflow-graph';

export type WorkflowExportSource = {
  name: string;
  trigger: string;
  priority: number;
  enabled: boolean | number;
  definition_json: string;
  graph_json: string | WorkflowGraphDocument | null;
  cron_expr: string | null;
  schedule_account_id: number | null;
  execution_mode?: string | null;
  engine_version?: number | null;
};

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

function parseExportGraph(value: WorkflowExportSource['graph_json']): WorkflowGraphDocument | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;

  try {
    const parsed = JSON.parse(value) as WorkflowGraphDocument;
    return parsed.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function exportWorkflowBundle(
  row: WorkflowExportSource,
  exportedAt = new Date(),
): WorkflowExportBundle {
  return {
    version: 1,
    exportedAt: exportedAt.toISOString(),
    workflow: {
      name: row.name,
      trigger: row.trigger,
      priority: row.priority,
      enabled: Boolean(row.enabled),
      definition_json: row.definition_json,
      graph_json: parseExportGraph(row.graph_json),
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
    throw new Error('Ungueltiges Workflow-Exportformat');
  }
  return parsed;
}
