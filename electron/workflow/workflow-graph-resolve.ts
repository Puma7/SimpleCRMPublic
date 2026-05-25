import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import type { EmailWorkflowRow } from '../email/email-workflow-store';
import { parseWorkflowDefinition } from '../email/email-workflow-types';
import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOWS_TABLE } from '../database-schema';
import { definitionToGraphDocument } from './definition-to-graph';
import { buildBlankWorkflowGraph, graphHasRunnableNodes } from './graph-presets';
import { parseGraphDocument } from './graph-walk-utils';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';


/** Liefert den Graph für die Laufzeit — migriert Legacy-Regeln einmalig in graph_json. */
export function resolveWorkflowGraph(workflow: EmailWorkflowRow): {
  doc: WorkflowGraphDocument | null;
  source: 'stored' | 'migrated' | 'blank' | 'none';
} {
  const stored = parseGraphDocument(workflow.graph_json);
  if (stored && graphHasRunnableNodes(stored)) {
    return { doc: stored, source: 'stored' };
  }
  if (stored && stored.nodes.some((n) => n.type === 'trigger')) {
    return { doc: stored, source: 'stored' };
  }

  try {
    const def = parseWorkflowDefinition(workflow.definition_json);
    const migrated = definitionToGraphDocument(def, workflow.trigger);
    if (migrated && graphHasRunnableNodes(migrated)) {
      persistWorkflowGraph(workflow.id, migrated);
      return { doc: migrated, source: 'migrated' };
    }
  } catch {
    /* invalid definition */
  }

  const blank = buildBlankWorkflowGraph(workflow.trigger as WorkflowTriggerKind);
  if (!workflow.graph_json?.trim()) {
    persistWorkflowGraph(workflow.id, blank);
  }
  return { doc: blank, source: 'blank' };
}

function persistWorkflowGraph(workflowId: number, doc: WorkflowGraphDocument): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_WORKFLOWS_TABLE} SET graph_json = ?, execution_mode = 'graph', updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(doc), new Date().toISOString(), workflowId);
}

/** Einmalige Migration: Legacy definition_json → graph_json (modularer Interpreter). */
export function migrateLegacyWorkflowsWithoutGraph(): void {
  const rows = getDb()
    .prepare(
      `SELECT * FROM ${EMAIL_WORKFLOWS_TABLE} WHERE graph_json IS NULL OR TRIM(graph_json) = '' OR TRIM(graph_json) = 'null'`,
    )
    .all() as Record<string, unknown>[];
  for (const row of rows) {
    const wf = {
      ...(row as EmailWorkflowRow),
      execution_mode: String(row.execution_mode ?? 'graph'),
      engine_version: Number(row.engine_version ?? 1),
    };
    resolveWorkflowGraph(wf);
  }
}
