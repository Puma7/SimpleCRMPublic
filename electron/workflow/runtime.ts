import type { WorkflowGraphDocument, WorkflowGraphEdge, WorkflowGraphNode } from '../../shared/email-workflow-graph';
import {
  evaluateWorkflowWhen,
  type WorkflowCondition,
  type WorkflowConditionItem,
} from '../email/email-workflow-types';
import type { EmailWorkflowRow } from '../email/email-workflow-store';
import { createWorkflowContext } from './context';
import { ensureBuiltinWorkflowNodes, getWorkflowNode, LEGACY_ACTION_MAP } from './registry';
import { insertWorkflowRunStep } from './run-steps';
import type { GraphRunResult, NodeExecuteResult, WorkflowContext } from './types';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

function outgoing(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return edges.filter((e) => e.source === sourceId).sort((a, b) => a.id.localeCompare(b.id));
}

function edgeIsYes(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return !l || l === 'yes' || l === 'ja' || l === 'true' || l === 'success';
}

function edgeIsNo(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false' || l === 'error';
}

function pickEdge(edges: WorkflowGraphEdge[], port: 'yes' | 'no' | 'default'): WorkflowGraphEdge | undefined {
  if (edges.length === 0) return undefined;
  if (port === 'yes') return edges.find((e) => edgeIsYes(e)) ?? edges[0];
  if (port === 'no') return edges.find((e) => edgeIsNo(e)) ?? edges[1] ?? edges[0];
  return edges[0];
}

function conditionFromNodeData(data: Record<string, unknown>): WorkflowCondition {
  return {
    field: data.field as WorkflowCondition['field'],
    op: data.op as WorkflowCondition['op'],
    value: String(data.value ?? ''),
    caseInsensitive: data.caseInsensitive !== false,
  };
}

function configFromActionData(data: Record<string, unknown>): { type: string; config: Record<string, unknown> } {
  if (data.nodeType && typeof data.nodeType === 'string') {
    const cfg =
      data.config && typeof data.config === 'object'
        ? (data.config as Record<string, unknown>)
        : {};
    return { type: data.nodeType, config: cfg };
  }
  const actionType = String(data.actionType ?? '');
  const registryType = LEGACY_ACTION_MAP[actionType];
  if (!registryType) return { type: `unknown.${actionType}`, config: data };
  const config: Record<string, unknown> = { ...data };
  delete config.actionType;
  return { type: registryType, config };
}

async function executeNode(
  ctx: WorkflowContext,
  node: WorkflowGraphNode,
  log: string[],
): Promise<NodeExecuteResult> {
  ensureBuiltinWorkflowNodes();

  if (node.type === 'trigger') {
    return { status: 'ok', port: 'default' };
  }

  if (node.type === 'condition') {
    const data = node.data as Record<string, unknown>;
    const cond = conditionFromNodeData(data);
    const item: WorkflowConditionItem = data.negated ? { not: cond } : cond;
    const when = 'not' in item && item.not ? { not: item.not } : item;
    const match = evaluateWorkflowWhen(when as WorkflowCondition, ctx.strings);
    log.push(match ? `condition:${data.field}:yes` : `condition:${data.field}:no`);
    return { status: 'ok', port: match ? 'yes' : 'no' };
  }

  if (node.type === 'action' || node.type === 'registry') {
    const data = node.data as Record<string, unknown>;
    const { type, config } = configFromActionData(data);
    const def = getWorkflowNode(type);
    if (!def) {
      log.push(`unknown_node:${type}`);
      return { status: 'error', message: `Unbekannter Knoten: ${type}` };
    }
    return def.execute(ctx, config, node.id);
  }

  return { status: 'skipped', message: `Unbekannter Knotentyp ${node.type}` };
}

async function walkGraph(
  ctx: WorkflowContext,
  doc: WorkflowGraphDocument,
  startNodeId: string,
  log: string[],
): Promise<GraphRunResult> {
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  let currentId: string | undefined = startNodeId;
  const visited = new Set<string>();
  let blocked = false;
  let blockReason: string | null = null;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodesById.get(currentId);
    if (!node) break;

    const t0 = Date.now();
    let result: NodeExecuteResult;
    try {
      result = await executeNode(ctx, node, log);
    } catch (e) {
      result = {
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        port: 'error',
      };
    }
    const durationMs = Date.now() - t0;

    insertWorkflowRunStep({
      runId: ctx.runId,
      nodeId: node.id,
      nodeType: node.type === 'action' ? String((node.data as { actionType?: string }).actionType ?? 'action') : node.type,
      status: result.status,
      port: result.port ?? null,
      durationMs,
      message: result.message ?? null,
    });

    if (result.variables) {
      Object.assign(ctx.variables, result.variables);
    }
    if (result.ai?.lastResponse) ctx.ai.lastResponse = result.ai.lastResponse;

    if (result.blocked) {
      blocked = true;
      blockReason = result.blockReason ?? 'Workflow blockiert';
      log.push(`blocked:${blockReason}`);
      return { log, status: 'blocked', blocked: true, blockReason };
    }
    if (result.stop) {
      log.push('stop');
      return { log, status: 'ok', blocked: false, blockReason: null };
    }

    const outs = outgoing(doc.edges, currentId);
    if (outs.length === 0) break;

    let port: 'yes' | 'no' | 'default' = 'default';
    if (node.type === 'condition') {
      port = result.port === 'no' ? 'no' : 'yes';
    } else if (result.port === 'error') {
      port = 'no';
    }

    const nextEdge = pickEdge(outs, port);
    currentId = nextEdge?.target;
  }

  return { log, status: 'ok', blocked: false, blockReason: null };
}

export function parseGraphDocument(json: string | null): WorkflowGraphDocument | null {
  if (!json?.trim()) return null;
  try {
    const doc = JSON.parse(json) as WorkflowGraphDocument;
    if (doc.version !== 1 || !Array.isArray(doc.nodes)) return null;
    return doc;
  } catch {
    return null;
  }
}

export async function runWorkflowGraph(input: {
  workflow: EmailWorkflowRow;
  trigger: WorkflowTriggerKind;
  direction: WorkflowContext['direction'];
  runId: number;
  message?: import('../email/email-store').EmailMessageRow | null;
  outbound?: import('../email/email-workflow-engine').OutboundDraftPayload | null;
  dryRun?: boolean;
}): Promise<GraphRunResult> {
  ensureBuiltinWorkflowNodes();
  const doc = parseGraphDocument(input.workflow.graph_json);
  if (!doc) {
    return {
      log: ['graph_missing'],
      status: 'error',
      blocked: false,
      blockReason: null,
    };
  }

  const triggerNode = doc.nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) {
    return { log: ['no_trigger'], status: 'error', blocked: false, blockReason: null };
  }

  const ctx = createWorkflowContext({
    trigger: input.trigger,
    direction: input.direction,
    workflowId: input.workflow.id,
    runId: input.runId,
    message: input.message ?? null,
    outbound: input.outbound ?? null,
    dryRun: input.dryRun,
  });

  const log: string[] = ['graph_run_start'];
  const outs = outgoing(doc.edges, triggerNode.id);
  if (outs.length === 0) {
    return { log: ['trigger_no_edges'], status: 'ok', blocked: false, blockReason: null };
  }

  let merged: GraphRunResult = { log, status: 'ok', blocked: false, blockReason: null };
  for (const edge of outs) {
    const branchLog = [...log, `branch:${edge.target}`];
    const r = await walkGraph(ctx, doc, edge.target, branchLog);
    merged.log.push(...r.log);
    if (r.blocked) return r;
    if (r.status === 'error') merged.status = 'error';
  }
  return merged;
}
