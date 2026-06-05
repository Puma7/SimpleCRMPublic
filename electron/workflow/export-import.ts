import type { EmailWorkflowRow } from '../email/email-workflow-store';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import {
  exportWorkflowBundle as coreExportWorkflowBundle,
  parseWorkflowImport as coreParseWorkflowImport,
  type WorkflowExportBundle as CoreWorkflowExportBundle,
  type WorkflowExportSource,
} from '../../packages/core/src/workflow';

export type WorkflowExportBundle = Omit<CoreWorkflowExportBundle, 'workflow'> & {
  workflow: Omit<CoreWorkflowExportBundle['workflow'], 'graph_json'> & {
    graph_json: WorkflowGraphDocument | null;
  };
};

export function exportWorkflowBundle(row: EmailWorkflowRow): WorkflowExportBundle {
  return coreExportWorkflowBundle(row as WorkflowExportSource) as unknown as WorkflowExportBundle;
}

export function parseWorkflowImport(json: string): WorkflowExportBundle {
  return coreParseWorkflowImport(json) as unknown as WorkflowExportBundle;
}
