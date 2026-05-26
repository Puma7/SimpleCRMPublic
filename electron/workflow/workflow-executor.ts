import type { EmailMessageRow } from '../email/email-store';
import type { OutboundDraftPayload } from '../email/email-workflow-engine';
import { outboundPayloadFromMessage } from '../email/email-workflow-engine';
import {
  getWorkflowById,
  type EmailWorkflowRow,
} from '../email/email-workflow-store';
import { parseWorkflowDefinition } from '../email/email-workflow-types';
import { compileGraphToDefinition } from '../email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import { runWorkflowGraph, runWorkflowGraphFromNode, parseGraphDocument } from './runtime';
// parseGraphDocument used for graph presence check
import { startWorkflowRun, finishWorkflowRun } from './run-steps';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';
import {
  workflowDirectionForTrigger,
  workflowTriggerNeedsMessage,
} from './workflow-trigger-utils';
import { resolveWorkflowGraph } from './workflow-graph-resolve';

/** Execute single workflow — prefers graph runtime when graph_json present */
export async function executeWorkflowForTrigger(input: {
  workflow: EmailWorkflowRow;
  trigger: WorkflowTriggerKind;
  direction: 'inbound' | 'outbound' | 'draft_created' | 'schedule' | 'manual' | 'crm_event';
  message?: EmailMessageRow | null;
  outbound?: OutboundDraftPayload | null;
  dryRun?: boolean;
  eventStrings?: Record<string, string>;
  eventVariables?: Record<string, string | number | boolean | null>;
  initialVariables?: Record<string, string | number | boolean | null>;
  startNodeId?: string;
}): Promise<{
  runId: number;
  status: 'ok' | 'error' | 'blocked';
  log: string[];
  blocked: boolean;
  blockReason: string | null;
}> {
  const runId = startWorkflowRun({
    workflowId: input.workflow.id,
    messageId: input.message?.id ?? input.outbound?.messageId ?? null,
    direction: input.direction,
  });

  const mode = input.workflow.execution_mode ?? 'graph';
  const { doc, source } = resolveWorkflowGraph(input.workflow);

  if (mode !== 'compiled' && doc) {
    const graphInput = {
      workflow: { ...input.workflow, graph_json: JSON.stringify(doc) },
      trigger: input.trigger,
      direction: input.direction,
      runId,
      message: input.message,
      outbound: input.outbound,
      dryRun: input.dryRun,
      eventStrings: input.eventStrings,
      eventVariables: input.eventVariables,
      initialVariables: input.initialVariables,
    };
    const result = input.startNodeId
      ? await runWorkflowGraphFromNode({ ...graphInput, startNodeId: input.startNodeId })
      : await runWorkflowGraph(graphInput);
    const log = [`graph_source:${source}`, ...result.log];
    finishWorkflowRun(runId, {
      status: result.status,
      logJson: JSON.stringify(log),
    });
    return {
      runId,
      status: result.status,
      log,
      blocked: result.blocked,
      blockReason: result.blockReason,
    };
  }

  if (mode === 'compiled') {
    const { runCompiledWorkflow } = await import('./compiled-fallback');
    const result = await runCompiledWorkflow({
      workflow: input.workflow,
      runId,
      message: input.message,
      outbound: input.outbound,
      direction: input.direction,
    });
    finishWorkflowRun(runId, { status: result.status, logJson: JSON.stringify(result.log) });
    return { runId, ...result };
  }

  const log = ['graph_empty:keine ausführbaren Knoten'];
  finishWorkflowRun(runId, { status: 'ok', logJson: JSON.stringify(log) });
  return { runId, status: 'ok', log, blocked: false, blockReason: null };
}

export async function executeWorkflowNow(
  workflowId: number,
  options: { messageId?: number | null; dryRun?: boolean } = {},
): Promise<{
  success: boolean;
  runId?: number;
  status?: 'ok' | 'error' | 'blocked';
  blocked?: boolean;
  blockReason?: string | null;
  log?: string[];
  error?: string;
}> {
  const wf = getWorkflowById(workflowId);
  if (!wf) return { success: false, error: 'Workflow nicht gefunden' };
  if (wf.enabled !== 1) return { success: false, error: 'Workflow ist deaktiviert' };

  const trigger = (wf.trigger as WorkflowTriggerKind) || 'manual';
  const direction = workflowDirectionForTrigger(trigger);
  const dryRun = options.dryRun === true;

  let message: EmailMessageRow | null = null;
  if (options.messageId != null) {
    const { getEmailMessageById } = await import('../email/email-store');
    message = getEmailMessageById(options.messageId) ?? null;
    if (!message) return { success: false, error: 'Nachricht nicht gefunden' };
  } else if (workflowTriggerNeedsMessage(trigger)) {
    return { success: false, error: 'Für diesen Trigger ist eine Nachricht-ID erforderlich' };
  }

  let outbound: OutboundDraftPayload | null = null;
  if (trigger === 'outbound' && message) {
    outbound = outboundPayloadFromMessage(message);
  }

  const r = await executeWorkflowForTrigger({
    workflow: wf,
    trigger,
    direction,
    message,
    outbound,
    dryRun,
  });

  return {
    success: true,
    runId: r.runId,
    status: r.status,
    blocked: r.blocked,
    blockReason: r.blockReason,
    log: r.log,
  };
}

export async function testWorkflowOnMessage(
  workflowId: number,
  messageId: number,
  dryRun = true,
): Promise<{ success: boolean; runId?: number; log?: string[]; error?: string }> {
  const r = await executeWorkflowNow(workflowId, { messageId, dryRun });
  if (!r.success) return { success: false, error: r.error };
  return { success: true, runId: r.runId, log: r.log };
}

export function syncDefinitionFromGraph(workflow: EmailWorkflowRow): string {
  const doc = parseGraphDocument(workflow.graph_json);
  if (!doc) return workflow.definition_json;
  const def = compileGraphToDefinition(doc);
  return JSON.stringify(def);
}

export function ensureGraphFromDefinition(definitionJson: string): string | null {
  try {
    const def = parseWorkflowDefinition(definitionJson);
    if (def.rules.length === 0) return null;
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          data: { kind: 'inbound' },
        },
      ],
      edges: [],
    };
    return JSON.stringify(doc);
  } catch {
    return null;
  }
}
