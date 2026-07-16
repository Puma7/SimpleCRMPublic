/** Shared workflow runtime types (main + renderer metadata). */

import type { WorkflowNodeSchemaExtension } from './workflow-node-schema';

export type WorkflowExecutionMode = 'compiled' | 'graph';

export type WorkflowTriggerKind =
  | 'inbound'
  | 'outbound'
  | 'draft_created'
  | 'schedule'
  | 'manual'
  /** Server-only: SMTP-Relay-Follow-up (nach erfolgreichem Relay-Versand). */
  | 'relay'
  | 'crm.deal_stage_changed'
  | 'task.due'
  | 'calendar.event_start'
  | 'webhook.incoming'
  | 'crm.customer_created';

export type WorkflowNodeCategory =
  | 'trigger'
  | 'logic'
  | 'email'
  | 'crm'
  | 'ai'
  | 'integration'
  | 'code';

export type WorkflowPortId = 'default' | 'yes' | 'no' | 'error' | 'success';

export type WorkflowNodeCatalogEntry = WorkflowNodeSchemaExtension & {
  type: string;
  label: string;
  category: WorkflowNodeCategory;
  description?: string;
  /** Canvas node type: legacy action uses `action` + actionType mapping */
  canvasType: 'trigger' | 'condition' | 'action' | 'registry';
  defaultConfig?: Record<string, unknown>;
  /** Wo der Knoten ausführbar ist (fehlend = überall). Spiegel von packages/core node-catalog. */
  runtime?: 'both' | 'desktop' | 'server';
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

/** Minimum minutes between workflow cron fires (UI + server). */
export const WORKFLOW_CRON_MIN_INTERVAL_MINUTES = 15;
