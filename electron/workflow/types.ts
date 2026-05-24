import type { EmailMessageRow } from '../email/email-store';
import type { OutboundDraftPayload } from '../email/email-workflow-engine';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

export type WorkflowStringContext = Record<string, string>;

export type WorkflowContext = {
  trigger: WorkflowTriggerKind;
  direction: 'inbound' | 'outbound' | 'draft_created' | 'schedule' | 'manual' | 'crm_event';
  messageId: number | null;
  message: EmailMessageRow | null;
  outbound: OutboundDraftPayload | null;
  workflowId: number;
  runId: number;
  dryRun: boolean;
  variables: Record<string, string | number | boolean | null>;
  strings: WorkflowStringContext;
  ai: { lastResponse?: string };
};

export type NodeExecuteResult = {
  status: 'ok' | 'error' | 'skipped';
  /** Next port for branching nodes */
  /** Branch port; built-in names plus dynamic labels (e.g. logic.switch cases). */
  port?: string;
  stop?: boolean;
  blocked?: boolean;
  blockReason?: string;
  message?: string;
  variables?: Record<string, string | number | boolean | null>;
  ai?: { lastResponse?: string };
};

export type WorkflowNodeExecutor = (
  ctx: WorkflowContext,
  config: Record<string, unknown>,
  nodeId: string,
) => Promise<NodeExecuteResult>;

export type RegisteredWorkflowNode = {
  type: string;
  label: string;
  category: import('../../shared/workflow-types').WorkflowNodeCategory;
  description?: string;
  canvasType: 'trigger' | 'condition' | 'action' | 'registry';
  defaultConfig?: Record<string, unknown>;
  execute: WorkflowNodeExecutor;
};

export type GraphRunResult = {
  log: string[];
  status: 'ok' | 'error' | 'blocked';
  blocked: boolean;
  blockReason: string | null;
};
