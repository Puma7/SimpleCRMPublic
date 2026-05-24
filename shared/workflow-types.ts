/** Shared workflow runtime types (main + renderer metadata). */

export type WorkflowExecutionMode = 'compiled' | 'graph';

export type WorkflowTriggerKind =
  | 'inbound'
  | 'outbound'
  | 'draft_created'
  | 'schedule'
  | 'manual';

export type WorkflowNodeCategory =
  | 'trigger'
  | 'logic'
  | 'email'
  | 'crm'
  | 'ai'
  | 'integration'
  | 'code';

export type WorkflowPortId = 'default' | 'yes' | 'no' | 'error' | 'success';

export type WorkflowNodeCatalogEntry = {
  type: string;
  label: string;
  category: WorkflowNodeCategory;
  description?: string;
  /** Canvas node type: legacy action uses `action` + actionType mapping */
  canvasType: 'trigger' | 'condition' | 'action' | 'registry';
  defaultConfig?: Record<string, unknown>;
};

export type WorkflowRunStepDto = {
  id: number;
  runId: number;
  nodeId: string;
  nodeType: string;
  status: 'ok' | 'error' | 'skipped';
  port: string | null;
  durationMs: number;
  message: string | null;
  createdAt: string;
};

export type WorkflowTemplateDto = {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTriggerKind;
  graph: import('./email-workflow-graph').WorkflowGraphDocument;
};
