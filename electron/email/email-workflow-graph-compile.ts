import type {
  GraphActionNodeData,
  GraphConditionNodeData,
  WorkflowGraphDocument,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '@shared/email-workflow-graph';
import type { WorkflowCondition, WorkflowDefinitionV1, WorkflowRule, WorkflowThenStep } from './email-workflow-types';

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
    case 'stop':
      return { type: 'stop' };
    default:
      return null;
  }
}

function outgoingEdges(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return edges.filter((e) => e.source === sourceId).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Linear compile: follow first outgoing edge from trigger; collect conditions then actions until no next node.
 */
export function compileGraphToDefinition(doc: WorkflowGraphDocument): WorkflowDefinitionV1 {
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  const trigger = doc.nodes.find((n) => n.type === 'trigger');
  if (!trigger || !isTriggerData(trigger.data)) {
    return { version: 1, rules: [] };
  }

  const conditions: WorkflowCondition[] = [];
  const then: WorkflowThenStep[] = [];

  let currentId: string | undefined = trigger.id;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodesById.get(currentId);
    if (!node) break;

    if (node.type === 'condition' && isConditionData(node.data)) {
      conditions.push({
        field: node.data.field,
        op: node.data.op,
        value: node.data.value,
        caseInsensitive: node.data.caseInsensitive,
      });
    } else if (node.type === 'action' && isActionData(node.data)) {
      const step = mapAction(node.data);
      if (step) {
        then.push(step);
        if (step.type === 'stop') break;
      }
    }

    const outs = outgoingEdges(doc.edges, currentId);
    if (outs.length === 0) break;
    const preferred =
      outs.find((e) => !e.label || e.label.toLowerCase() === 'yes' || e.label.toLowerCase() === 'ja') ?? outs[0];
    currentId = preferred.target;
  }

  const when: WorkflowCondition | { all: WorkflowCondition[] } | null =
    conditions.length === 0 ? null : conditions.length === 1 ? conditions[0]! : { all: conditions };

  const rule: WorkflowRule = { when: when as WorkflowRule['when'], then };
  return { version: 1, rules: then.length > 0 || when != null ? [rule] : [] };
}

export function definitionToJson(def: WorkflowDefinitionV1): string {
  return JSON.stringify(def);
}
