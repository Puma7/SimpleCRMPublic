import type { WorkflowGraphDocument, WorkflowGraphNode } from '../../shared/email-workflow-graph';
import { outgoing, pickEdge, parseGraphDocument } from './graph-walk-utils';
export { parseGraphDocument, resolveResumeNodeAfter } from './graph-walk-utils';
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

function registryTypeOf(node: WorkflowGraphNode): string | undefined {
  if (node.type !== 'registry' && node.type !== 'action') return undefined;
  const data = node.data as Record<string, unknown>;
  if (data.nodeType) return String(data.nodeType);
  const actionType = String(data.actionType ?? '');
  return LEGACY_ACTION_MAP[actionType];
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

type WalkOptions = {
  allowRevisit?: boolean;
};

async function walkGraph(
  ctx: WorkflowContext,
  doc: WorkflowGraphDocument,
  startNodeId: string,
  log: string[],
  visited?: Set<string>,
  options?: WalkOptions,
): Promise<GraphRunResult> {
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  let currentId: string | undefined = startNodeId;
  const seen = visited ?? new Set<string>();
  let blocked = false;
  let blockReason: string | null = null;

  while (currentId) {
    if (!options?.allowRevisit && seen.has(currentId)) {
      log.push(`cycle:${currentId}`);
      break;
    }
    seen.add(currentId);

    const node = nodesById.get(currentId);
    if (!node) break;

    const regType = registryTypeOf(node);

    if (regType === 'logic.loop') {
      const data = node.data as Record<string, unknown>;
      const config =
        data.config && typeof data.config === 'object'
          ? (data.config as Record<string, unknown>)
          : data;
      const sourceKey = String(config.sourceVariable ?? 'attachment_names');
      const raw =
        String(ctx.strings[sourceKey] ?? '') ||
        String(ctx.variables[sourceKey] ?? '') ||
        String(config.items ?? '');
      const items = raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
      const outs = outgoing(doc.edges, currentId);
      const eachEdge = pickEdge(outs, 'each');
      const doneEdge = pickEdge(outs, 'done');
      if (items.length === 0 || !eachEdge) {
        log.push('loop:empty');
        currentId = doneEdge?.target;
        continue;
      }
      for (let i = 0; i < items.length; i++) {
        ctx.variables['loop.item'] = items[i]!;
        ctx.variables['loop.index'] = i;
        log.push(`loop:${i}:${items[i]}`);
        const branchLog = [...log];
        const r = await walkGraph(ctx, doc, eachEdge.target, branchLog, new Set<string>(), {
          allowRevisit: true,
        });
        log.push(...r.log);
        if (r.blocked) return r;
        if (r.status === 'error') {
          blocked = false;
          blockReason = null;
          return { log, status: 'error', blocked: false, blockReason: null };
        }
      }
      currentId = doneEdge?.target;
      continue;
    }

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
      nodeType:
        node.type === 'action'
          ? String((node.data as { actionType?: string }).actionType ?? 'action')
          : regType ?? node.type,
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
      return {
        log,
        status: 'blocked',
        blocked: true,
        blockReason: result.blockReason ?? 'Workflow blockiert',
      };
    }
    if (result.stop) {
      log.push('stop');
      return { log, status: 'ok', blocked: false, blockReason: null };
    }

    const outs = outgoing(doc.edges, currentId);
    if (outs.length === 0) break;

    let port: string = 'default';
    if (node.type === 'condition') {
      port = result.port === 'no' ? 'no' : 'yes';
    } else if (regType === 'logic.switch') {
      port = String(result.port ?? 'default');
    } else if (result.port === 'error') {
      port = 'no';
    } else if (result.port) {
      port = result.port;
    }

    const nextEdge = pickEdge(outs, port);
    currentId = nextEdge?.target;
  }

  return { log, status: 'ok', blocked: false, blockReason: null };
}

type GraphRunInput = {
  workflow: EmailWorkflowRow;
  trigger: WorkflowTriggerKind;
  direction: WorkflowContext['direction'];
  runId: number;
  message?: import('../email/email-store').EmailMessageRow | null;
  outbound?: import('../email/email-workflow-engine').OutboundDraftPayload | null;
  dryRun?: boolean;
  eventStrings?: Record<string, string>;
  eventVariables?: Record<string, string | number | boolean | null>;
  initialVariables?: Record<string, string | number | boolean | null>;
};

function buildCtx(input: GraphRunInput): WorkflowContext {
  return createWorkflowContext({
    trigger: input.trigger,
    direction: input.direction,
    workflowId: input.workflow.id,
    runId: input.runId,
    message: input.message ?? null,
    outbound: input.outbound ?? null,
    dryRun: input.dryRun,
    eventStrings: input.eventStrings,
    eventVariables: input.eventVariables,
    initialVariables: input.initialVariables,
  });
}

export async function runWorkflowGraph(input: GraphRunInput): Promise<GraphRunResult> {
  ensureBuiltinWorkflowNodes();
  const doc = parseGraphDocument(input.workflow.graph_json);
  if (!doc) {
    return { log: ['graph_missing'], status: 'error', blocked: false, blockReason: null };
  }

  const triggerNode = doc.nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) {
    return { log: ['no_trigger'], status: 'error', blocked: false, blockReason: null };
  }

  const ctx = buildCtx(input);
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

export async function runWorkflowGraphFromNode(
  input: GraphRunInput & { startNodeId: string },
): Promise<GraphRunResult> {
  ensureBuiltinWorkflowNodes();
  const doc = parseGraphDocument(input.workflow.graph_json);
  if (!doc) {
    return { log: ['graph_missing'], status: 'error', blocked: false, blockReason: null };
  }
  const ctx = buildCtx(input);
  const log: string[] = [`graph_resume:${input.startNodeId}`];
  return walkGraph(ctx, doc, input.startNodeId, log);
}

