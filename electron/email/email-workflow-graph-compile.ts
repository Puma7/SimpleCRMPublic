import type {
  GraphActionNodeData,
  GraphConditionNodeData,
  WorkflowGraphDocument,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '../../shared/email-workflow-graph';
import type {
  WorkflowCondition,
  WorkflowConditionItem,
  WorkflowDefinitionV1,
  WorkflowRule,
  WorkflowThenStep,
} from './email-workflow-types';

function isTriggerData(d: unknown): d is { kind: string } {
  return Boolean(d && typeof d === 'object' && 'kind' in d);
}

function isConditionData(d: unknown): d is GraphConditionNodeData {
  return Boolean(d && typeof d === 'object' && 'field' in d && 'op' in d && 'value' in d);
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
      return { type: 'forward_copy', to: data.to };
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

function outgoingEdges(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return edges.filter((e) => e.source === sourceId).sort((a, b) => a.id.localeCompare(b.id));
}

function edgeIsYes(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return !l || l === 'yes' || l === 'ja' || l === 'true';
}

function edgeIsNo(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false';
}

function conditionFromNode(data: GraphConditionNodeData): WorkflowCondition {
  return {
    field: data.field,
    op: data.op,
    value: data.value,
    caseInsensitive: data.caseInsensitive,
  };
}

type CompileState = {
  conditions: WorkflowConditionItem[];
  then: WorkflowThenStep[];
};

/**
 * Walk the graph from `nodeId`, collecting conditions and actions.
 * At condition nodes with yes/no branches, emits separate rule paths.
 */
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
          { conditions: [...state.conditions, { not: cond }], then: [] },
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

    if (node.type === 'action' && isActionData(node.data)) {
      const step = mapAction(node.data);
      if (step) {
        state.then.push(step);
        if (step.type === 'stop') {
          flushRule(state, rules);
          return;
        }
      }
    }

    const outs = outgoingEdges(edges, currentId);
    if (outs.length === 0) break;
    const preferred =
      outs.find((e) => edgeIsYes(e)) ?? outs[0];
    currentId = preferred.target;
  }

  flushRule(state, rules);
}

function flushRule(state: CompileState, rules: WorkflowRule[]): void {
  if (state.then.length === 0 && state.conditions.length === 0) return;
  // Paths that reach actions without a Bedingung must not become when:null (matches all mail).
  if (state.then.length > 0 && state.conditions.length === 0) return;
  const when =
    state.conditions.length === 0
      ? null
      : state.conditions.length === 1
        ? state.conditions[0]!
        : { all: state.conditions };
  rules.push({ when: when as WorkflowRule['when'], then: [...state.then] });
}

/**
 * Compile React Flow graph to workflow rules with if/else branching support.
 */
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
