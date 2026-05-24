import type { EmailMessageRow } from '../email/email-store';
import type { OutboundDraftPayload } from '../email/email-workflow-engine';
import {
  getWorkflowById,
  type EmailWorkflowRow,
} from '../email/email-workflow-store';
import { parseWorkflowDefinition } from '../email/email-workflow-types';
import { compileGraphToDefinition } from '../email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import { runWorkflowGraph, parseGraphDocument } from './runtime';
// parseGraphDocument used for graph presence check
import { startWorkflowRun, finishWorkflowRun } from './run-steps';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

/** Execute single workflow — prefers graph runtime when graph_json present */
export async function executeWorkflowForTrigger(input: {
  workflow: EmailWorkflowRow;
  trigger: WorkflowTriggerKind;
  direction: 'inbound' | 'outbound' | 'draft_created' | 'schedule' | 'manual';
  message?: EmailMessageRow | null;
  outbound?: OutboundDraftPayload | null;
  dryRun?: boolean;
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

  const useGraph =
    (input.workflow.execution_mode ?? 'graph') === 'graph' &&
    Boolean(input.workflow.graph_json?.trim());

  if (useGraph) {
    const doc = parseGraphDocument(input.workflow.graph_json);
    if (doc) {
      const result = await runWorkflowGraph({
        workflow: input.workflow,
        trigger: input.trigger,
        direction: input.direction,
        runId,
        message: input.message,
        outbound: input.outbound,
        dryRun: input.dryRun,
      });
      finishWorkflowRun(runId, {
        status: result.status,
        logJson: JSON.stringify(result.log),
      });
      return {
        runId,
        status: result.status,
        log: result.log,
        blocked: result.blocked,
        blockReason: result.blockReason,
      };
    }
  }

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

export async function testWorkflowOnMessage(
  workflowId: number,
  messageId: number,
  dryRun = true,
): Promise<{ success: boolean; runId?: number; log?: string[]; error?: string }> {
  const wf = getWorkflowById(workflowId);
  if (!wf) return { success: false, error: 'Workflow nicht gefunden' };
  const { getEmailMessageById } = await import('../email/email-store');
  const msg = getEmailMessageById(messageId);
  if (!msg) return { success: false, error: 'Nachricht nicht gefunden' };
  const trigger = (wf.trigger as WorkflowTriggerKind) || 'inbound';
  const r = await executeWorkflowForTrigger({
    workflow: wf,
    trigger,
    direction: trigger === 'outbound' ? 'outbound' : 'inbound',
    message: msg,
    dryRun,
  });
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
