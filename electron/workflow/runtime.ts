import type { WorkflowGraphDocument, WorkflowGraphNode } from '../../shared/email-workflow-graph';
import { outgoing, pickEdge, parseGraphDocument } from './graph-walk-utils';
export { parseGraphDocument, resolveResumeNodeAfter } from './graph-walk-utils';
import {
  matchConditionItem,
  type WorkflowCondition,
  type WorkflowConditionItem,
} from '../email/email-workflow-types';
import type { EmailWorkflowRow } from '../email/email-workflow-store';
import { createWorkflowContext, interpolateTemplate } from './context';
import { ensureBuiltinWorkflowNodes, getWorkflowNode, LEGACY_ACTION_MAP } from './registry';
import { inboundNodeRequiresConditionGate } from './inbound-gate';
import { insertWorkflowRunStep } from './run-steps';
import type { GraphRunResult, NodeExecuteResult, WorkflowContext } from './types';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';
import { getBuiltinWorkflowNodeCatalogEntry } from '../../packages/core/src/workflow/node-catalog';

/**
 * Zentraler Interpolations-Pre-Pass: Felder, die das Knoten-Schema mit
 * `interpolate: true` markiert, bekommen {{Platzhalter}} VOR dem execute()
 * aufgelöst — einheitlich für alle Knoten, auf einer Kopie (nie persistiert).
 */
function interpolateSchemaFields(
  type: string,
  config: Record<string, unknown>,
  ctx: WorkflowContext,
): Record<string, unknown> {
  const entry = getBuiltinWorkflowNodeCatalogEntry(type);
  const fields = entry?.fields?.filter((f) => f.interpolate === true);
  if (!fields || fields.length === 0) return config;
  let copy: Record<string, unknown> | null = null;
  for (const field of fields) {
    const value = config[field.key];
    if (typeof value !== 'string' || !value.includes('{{')) continue;
    if (!copy) copy = { ...config };
    copy[field.key] = interpolateTemplate(value, ctx);
  }
  return copy ?? config;
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
    const match = matchConditionItem(item, ctx.strings);
    log.push(match ? `condition:${data.field}:yes` : `condition:${data.field}:no`);
    return { status: 'ok', port: match ? 'yes' : 'no' };
  }

  if (node.type === 'action' || node.type === 'registry') {
    const data = node.data as Record<string, unknown>;
    const { type, config } = configFromActionData(data);
    const def = getWorkflowNode(type);
    if (!def) {
      log.push(`unknown_node:${type}`);
      const catalogEntry = getBuiltinWorkflowNodeCatalogEntry(type);
      if (catalogEntry?.runtime === 'server') {
        return {
          status: 'error',
          message: `Knoten "${catalogEntry.label}" (${type}) ist nur in der Server-Edition verfügbar`,
        };
      }
      return { status: 'error', message: `Unbekannter Knoten: ${type}` };
    }
    return def.execute(ctx, interpolateSchemaFields(type, config, ctx), node.id);
  }

  return { status: 'skipped', message: `Unbekannter Knotentyp ${node.type}` };
}

type WalkOptions = {
  allowRevisit?: boolean;
};

type InboundBranchGate = {
  /** True after a Bedingung node matched on the ja branch in this trigger branch. */
  conditionOk: boolean;
};

function cloneWorkflowContext(ctx: WorkflowContext): WorkflowContext {
  return {
    ...ctx,
    variables: { ...ctx.variables },
    strings: { ...ctx.strings },
    ai: { ...ctx.ai },
  };
}

async function walkGraph(
  ctx: WorkflowContext,
  doc: WorkflowGraphDocument,
  startNodeId: string,
  log: string[],
  visited?: Set<string>,
  options?: WalkOptions,
  inboundGate?: InboundBranchGate,
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
    const gate = inboundGate;
    if (
      gate &&
      ctx.direction === 'inbound' &&
      inboundNodeRequiresConditionGate(node) &&
      !gate.conditionOk
    ) {
      log.push(`skip:${node.id}:no_prior_condition`);
      insertWorkflowRunStep({
        runId: ctx.runId,
        nodeId: node.id,
        nodeType: regType ?? node.type,
        status: 'skipped',
        port: null,
        durationMs: 0,
        message: 'skip:no_prior_condition',
      });
      break;
    }

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
      const requestedMaxItems = Number(config.maxItems ?? 50);
      const maxItems = Number.isFinite(requestedMaxItems)
        ? Math.min(500, Math.max(1, Math.trunc(requestedMaxItems)))
        : 50;
      const allItems = raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const items = allItems.slice(0, maxItems);
      if (allItems.length > maxItems) {
        log.push(`loop:limit:${maxItems}`);
      }
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
        const r = await walkGraph(
          ctx,
          doc,
          eachEdge.target,
          branchLog,
          new Set<string>(),
          { allowRevisit: true },
          gate,
        );
        log.push(...r.log);
        if (r.blocked) return r;
        if (r.deferred) return r;
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
    if (result.status === 'error') {
      return {
        log,
        status: 'error',
        blocked: false,
        blockReason: result.message ?? null,
      };
    }
    if (result.stop) {
      log.push('stop');
      return {
        log,
        status: 'ok',
        blocked: false,
        blockReason: null,
        deferred: result.deferred === true,
      };
    }

    const outs = outgoing(doc.edges, currentId);
    if (outs.length === 0) break;

    let port: string = 'default';
    if (node.type === 'condition') {
      port = result.port === 'no' ? 'no' : 'yes';
    } else if (regType === 'logic.switch') {
      port = String(result.port ?? 'default');
    } else if (regType === 'logic.threshold') {
      port = result.port === 'no' ? 'no' : 'yes';
    } else if (regType === 'email.sender_filter') {
      port = String(result.port ?? 'default');
    } else if (regType === 'email.auto_reply') {
      port = String(result.port ?? 'blocked');
    } else if (result.port === 'error') {
      port = 'no';
    } else if (result.port) {
      port = result.port;
    }

    if (gate) {
      const tripped =
        (node.type === 'condition' && port === 'yes') ||
        (regType === 'email.auto_reply' && port === 'approved') ||
        (regType === 'logic.threshold' && port === 'yes') ||
        (regType === 'logic.switch' && port !== 'default');
      if (tripped) {
        gate.conditionOk = true;
        ctx.variables.__inbound_condition_ok = true;
      }
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
  previewOutbound?: boolean;
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
    previewOutbound: input.previewOutbound,
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
    const branchCtx = cloneWorkflowContext(ctx);
    const branchGate: InboundBranchGate = { conditionOk: false };
    const r = await walkGraph(branchCtx, doc, edge.target, branchLog, undefined, undefined, branchGate);
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
  const inboundOk =
    input.initialVariables?.__inbound_condition_ok === true ||
    input.initialVariables?.__inbound_condition_ok === 1;
  const gate =
    input.direction === 'inbound' ? { conditionOk: inboundOk } : undefined;
  return walkGraph(ctx, doc, input.startNodeId, log, undefined, undefined, gate);
}
