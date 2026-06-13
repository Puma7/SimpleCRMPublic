import type {
  GraphActionNodeData,
  GraphConditionField,
  GraphConditionNodeData,
  GraphConditionOp,
  WorkflowGraphDocument,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from './email-workflow-graph';

export type WorkflowCondition = {
  field: GraphConditionField;
  op: GraphConditionOp;
  value: string;
  caseInsensitive?: boolean;
};

export type WorkflowConditionItem = WorkflowCondition | { not: WorkflowCondition };

export type WorkflowConditionGroup =
  | { all: WorkflowConditionItem[] }
  | { any: WorkflowConditionItem[] };

export type WorkflowRuleWhen = WorkflowCondition | WorkflowConditionGroup | null;

export type WorkflowThenStep =
  | { type: 'tag'; tag: string }
  | { type: 'mark_seen' }
  | { type: 'archive' }
  | { type: 'hold_outbound'; reason: string }
  | { type: 'set_category'; path: string }
  | { type: 'link_customer' }
  | { type: 'forward_copy'; to: string; includeAttachments?: boolean; runOutboundReview?: boolean }
  | { type: 'tag_attachment_meta'; tag: string }
  | { type: 'registry'; nodeType: string; config: Record<string, unknown> }
  | { type: 'ai_review'; promptId: number; blockKeyword?: string }
  | { type: 'stop' };

export type WorkflowRule = {
  when: WorkflowRuleWhen;
  then: WorkflowThenStep[];
};

export type WorkflowDefinitionV1 = {
  version: 1;
  rules: WorkflowRule[];
};

function isTriggerData(d: unknown): d is { kind: string } {
  return Boolean(d && typeof d === 'object' && 'kind' in d);
}

function isConditionData(d: unknown): d is GraphConditionNodeData {
  return Boolean(d && typeof d === 'object' && 'field' in d && 'op' in d && 'value' in d);
}

function isRegistryData(data: unknown): data is { nodeType: string; config?: Record<string, unknown> } {
  return Boolean(data && typeof data === 'object' && 'nodeType' in data);
}

function isActionData(d: unknown): d is GraphActionNodeData {
  return Boolean(d && typeof d === 'object' && 'actionType' in d);
}

function mapAction(data: GraphActionNodeData): WorkflowThenStep | null {
  switch (data.actionType) {
    case 'tag':
      return { type: 'tag', tag: data.tag };
    case 'mark_seen':
      return { type: 'mark_seen' };
    case 'archive':
      return { type: 'archive' };
    case 'hold_outbound':
      return { type: 'hold_outbound', reason: data.reason };
    case 'set_category':
      return { type: 'set_category', path: data.path };
    case 'link_customer':
      return { type: 'link_customer' };
    case 'forward_copy':
      return {
        type: 'forward_copy',
        to: data.to,
        includeAttachments: data.includeAttachments === true,
        runOutboundReview: data.runOutboundReview === true,
      };
    case 'tag_attachment_meta':
      return { type: 'tag_attachment_meta', tag: data.tag };
    case 'ai_review':
      return {
        type: 'ai_review',
        promptId: data.promptId,
        blockKeyword: data.blockKeyword,
      };
    case 'stop':
      return { type: 'stop' };
    default:
      return null;
  }
}

function mapRegistryAction(data: { nodeType: string; config?: Record<string, unknown> }): WorkflowThenStep | null {
  const config = data.config && typeof data.config === 'object' ? data.config : {};
  switch (data.nodeType) {
    case 'email.tag':
      return typeof config.tag === 'string' ? { type: 'tag', tag: config.tag } : null;
    case 'email.mark_seen':
      return { type: 'mark_seen' };
    case 'email.archive':
      return { type: 'archive' };
    case 'email.hold_outbound':
      return { type: 'hold_outbound', reason: String(config.reason ?? '') };
    case 'email.set_category':
      return typeof config.path === 'string' ? { type: 'set_category', path: config.path } : null;
    case 'crm.link_customer':
      return { type: 'link_customer' };
    case 'email.forward_copy':
      return typeof config.to === 'string'
        ? {
          type: 'forward_copy',
          to: config.to,
          includeAttachments: config.includeAttachments === true,
          runOutboundReview: config.runOutboundReview === true,
        }
        : null;
    case 'email.tag_attachment_meta':
      return { type: 'tag_attachment_meta', tag: String(config.tag ?? 'attachment') };
    case 'ai.review':
    case 'ai.outbound_review': {
      const promptId = Number(config.promptId ?? 0);
      return Number.isFinite(promptId) && promptId > 0
        ? { type: 'ai_review', promptId, blockKeyword: typeof config.blockKeyword === 'string' ? config.blockKeyword : undefined }
        : { type: 'registry', nodeType: data.nodeType, config };
    }
    case 'logic.stop':
      return { type: 'stop' };
    default:
      return { type: 'registry', nodeType: data.nodeType, config };
  }
}

function outgoingEdges(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return edges.filter((e) => e.source === sourceId).sort((a, b) => a.id.localeCompare(b.id));
}

function edgeIsYes(e: WorkflowGraphEdge): boolean {
  const label = (e.label ?? '').toLowerCase();
  return !label || label === 'yes' || label === 'ja' || label === 'true';
}

function edgeIsNo(e: WorkflowGraphEdge): boolean {
  const label = (e.label ?? '').toLowerCase();
  return label === 'no' || label === 'nein' || label === 'false';
}

function conditionFromNode(data: GraphConditionNodeData): WorkflowConditionItem {
  const condition: WorkflowCondition = {
    field: data.field,
    op: data.op,
    value: data.value,
    caseInsensitive: data.caseInsensitive,
  };
  return data.negated === true ? { not: condition } : condition;
}

function invertConditionItem(condition: WorkflowConditionItem): WorkflowConditionItem {
  return 'not' in condition ? condition.not : { not: condition };
}

type CompileState = {
  conditions: WorkflowConditionItem[];
  then: WorkflowThenStep[];
};

function walkFrom(
  nodeId: string,
  nodesById: Map<string, WorkflowGraphNode>,
  edges: WorkflowGraphEdge[],
  state: CompileState,
  visited: Set<string>,
  rules: WorkflowRule[],
): void {
  let currentId: string | undefined = nodeId;
  const localVisited = new Set(visited);

  while (currentId && !localVisited.has(currentId)) {
    localVisited.add(currentId);
    const node = nodesById.get(currentId);
    if (!node) break;

    if (node.type === 'condition' && isConditionData(node.data)) {
      const cond = conditionFromNode(node.data);
      const outs = outgoingEdges(edges, currentId);
      let yesEdge = outs.find((e) => edgeIsYes(e));
      let noEdge = outs.find((e) => edgeIsNo(e));
      if (outs.length >= 2 && !noEdge) {
        yesEdge = yesEdge ?? outs[0];
        noEdge = outs.find((e) => e.id !== yesEdge?.id) ?? outs[1];
      }

      if (yesEdge && noEdge && yesEdge.target !== noEdge.target) {
        walkFrom(
          yesEdge.target,
          nodesById,
          edges,
          { conditions: [...state.conditions, cond], then: [] },
          new Set(localVisited),
          rules,
        );
        walkFrom(
          noEdge.target,
          nodesById,
          edges,
          { conditions: [...state.conditions, invertConditionItem(cond)], then: [] },
          new Set(localVisited),
          rules,
        );
        return;
      }

      state.conditions.push(cond);
      const next = yesEdge ?? outs[0];
      currentId = next?.target;
      continue;
    }

    const step = node.type === 'action' && isActionData(node.data)
      ? mapAction(node.data)
      : node.type === 'registry' && isRegistryData(node.data)
        ? mapRegistryAction(node.data)
        : null;
    if (step) {
      state.then.push(step);
      if (step.type === 'stop') {
        flushRule(state, rules);
        return;
      }
    }

    const outs = outgoingEdges(edges, currentId);
    if (outs.length === 0) break;
    currentId = (outs.find((e) => edgeIsYes(e)) ?? outs[0])?.target;
  }

  flushRule(state, rules);
}

function flushRule(state: CompileState, rules: WorkflowRule[]): void {
  if (state.then.length === 0 && state.conditions.length === 0) return;
  if (state.conditions.length === 0) {
    if (state.then.every((step) => step.type === 'registry')) {
      rules.push({ when: null, then: [...state.then] });
    }
    return;
  }
  const when =
    state.conditions.length === 1
      ? state.conditions[0]!
      : { all: state.conditions };
  rules.push({ when: when as WorkflowRule['when'], then: [...state.then] });
}

export function compileGraphToDefinition(doc: WorkflowGraphDocument): WorkflowDefinitionV1 {
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  const trigger = doc.nodes.find((n) => n.type === 'trigger');
  if (!trigger || !isTriggerData(trigger.data)) {
    return { version: 1, rules: [] };
  }

  const outs = outgoingEdges(doc.edges, trigger.id);
  if (outs.length === 0) {
    return { version: 1, rules: [] };
  }

  const rules: WorkflowRule[] = [];
  for (const edge of outs) {
    walkFrom(edge.target, nodesById, doc.edges, { conditions: [], then: [] }, new Set(), rules);
  }

  return { version: 1, rules };
}

export function definitionToJson(def: WorkflowDefinitionV1): string {
  return JSON.stringify(def);
}
