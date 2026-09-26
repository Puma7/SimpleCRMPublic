import type {
  GraphActionNodeData,
  GraphConditionField,
  GraphConditionNodeData,
  GraphConditionOp,
  WorkflowGraphDocument,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from './graph-types';
import { outgoing as coreOutgoing, pickEdge } from './graph-walk-utils';

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

function isTriggerData(data: unknown): data is { kind: string } {
  return Boolean(data && typeof data === 'object' && 'kind' in data);
}

function isConditionData(data: unknown): data is GraphConditionNodeData {
  return Boolean(data && typeof data === 'object' && 'field' in data && 'op' in data && 'value' in data);
}

function isRegistryData(data: unknown): data is { nodeType: string; config?: Record<string, unknown> } {
  return Boolean(data && typeof data === 'object' && 'nodeType' in data);
}

function isActionData(data: unknown): data is GraphActionNodeData {
  return Boolean(data && typeof data === 'object' && 'actionType' in data);
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
  return coreOutgoing(edges, sourceId);
}

/**
 * Jeder Pfad durch eine Bedingung mit getrennten Ja-/Nein-Zielen wird eine
 * eigene Regel. Laufen die Zweige wieder zusammen, ergeben n Bedingungen 2^n
 * Regeln (20 Ebenen: rund 1 Mio. Regeln und Sekunden im Event-Loop, C-A82).
 * Das Budget bricht solche Graphen mit einem klaren Fehler ab; die
 * mitgelieferten Vorlagen brauchen hoechstens zwei Regeln.
 */
const MAX_COMPILED_RULES = 2000;
const MAX_COMPILE_WALK_STEPS = 200_000;
const GRAPH_TOO_COMPLEX_MESSAGE =
  `Workflow-Graph zu komplex: zu viele Verzweigungspfade (höchstens ${MAX_COMPILED_RULES} Regeln). `
  + 'Bitte Bedingungen zusammenfassen oder den Workflow aufteilen.';

type CompileWalk = {
  outgoing: (sourceId: string) => WorkflowGraphEdge[];
  steps: number;
};

/** Kanten einmal je Quelle gruppiert, damit ein Schritt nicht alle Kanten durchsucht. */
function createCompileWalk(edges: WorkflowGraphEdge[]): CompileWalk {
  const bySource = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) {
    const list = bySource.get(edge.source);
    if (list) list.push(edge);
    else bySource.set(edge.source, [edge]);
  }
  const cache = new Map<string, WorkflowGraphEdge[]>();
  return {
    steps: 0,
    outgoing: (sourceId) => {
      let outs = cache.get(sourceId);
      if (!outs) {
        outs = outgoingEdges(bySource.get(sourceId) ?? [], sourceId);
        cache.set(sourceId, outs);
      }
      return outs;
    },
  };
}

function spendCompileSteps(walk: CompileWalk, steps: number): void {
  walk.steps += steps;
  if (walk.steps > MAX_COMPILE_WALK_STEPS) throw new Error(GRAPH_TOO_COMPLEX_MESSAGE);
}

function edgeIsYes(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return !label || label === 'yes' || label === 'ja' || label === 'true';
}

function edgeIsNo(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
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
  walk: CompileWalk,
  state: CompileState,
  visited: Set<string>,
  rules: WorkflowRule[],
): void {
  let currentId: string | undefined = nodeId;
  // Jeder Zweig kopiert die Pfadmenge; das zaehlt mit ins Budget.
  spendCompileSteps(walk, visited.size + 1);
  const localVisited = new Set(visited);

  while (currentId && !localVisited.has(currentId)) {
    localVisited.add(currentId);
    const node = nodesById.get(currentId);
    if (!node) break;

    if (node.type === 'condition' && isConditionData(node.data)) {
      const condition = conditionFromNode(node.data);
      const outs = walk.outgoing(currentId);
      spendCompileSteps(walk, 1 + outs.length);
      let yesEdge = outs.find((edge) => edgeIsYes(edge));
      let noEdge = outs.find((edge) => edgeIsNo(edge));
      if (outs.length >= 2 && !noEdge) {
        yesEdge = yesEdge ?? outs[0];
        noEdge = outs.find((edge) => edge.id !== yesEdge?.id) ?? outs[1];
      }

      if (yesEdge && noEdge && yesEdge.target !== noEdge.target) {
        walkFrom(
          yesEdge.target,
          nodesById,
          walk,
          { conditions: [...state.conditions, condition], then: [] },
          new Set(localVisited),
          rules,
        );
        walkFrom(
          noEdge.target,
          nodesById,
          walk,
          { conditions: [...state.conditions, invertConditionItem(condition)], then: [] },
          new Set(localVisited),
          rules,
        );
        return;
      }

      state.conditions.push(condition);
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

    const outs = walk.outgoing(currentId);
    spendCompileSteps(walk, 1 + outs.length);
    if (outs.length === 0) break;
    currentId = pickEdge(outs, 'ok')?.target
      ?? (outs.find((edge) => edgeIsYes(edge)) ?? outs[0])?.target;
  }

  flushRule(state, rules);
}

function flushRule(state: CompileState, rules: WorkflowRule[]): void {
  if (state.then.length === 0 && state.conditions.length === 0) return;
  if (state.conditions.length === 0) {
    pushRule(rules, { when: null, then: [...state.then] });
    return;
  }
  const when =
    state.conditions.length === 1
        ? state.conditions[0]!
        : { all: state.conditions };
  pushRule(rules, { when: when as WorkflowRule['when'], then: [...state.then] });
}

function pushRule(rules: WorkflowRule[], rule: WorkflowRule): void {
  if (rules.length >= MAX_COMPILED_RULES) throw new Error(GRAPH_TOO_COMPLEX_MESSAGE);
  rules.push(rule);
}

export function compileGraphToDefinition(document: WorkflowGraphDocument): WorkflowDefinitionV1 {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const trigger = document.nodes.find((node) => node.type === 'trigger');
  if (!trigger || !isTriggerData(trigger.data)) {
    return { version: 1, rules: [] };
  }

  const outs = outgoingEdges(document.edges, trigger.id);
  if (outs.length === 0) {
    return { version: 1, rules: [] };
  }

  const rules: WorkflowRule[] = [];
  const walk = createCompileWalk(document.edges);
  for (const edge of outs) {
    walkFrom(edge.target, nodesById, walk, { conditions: [], then: [] }, new Set(), rules);
  }

  return { version: 1, rules };
}

export function definitionToJson(definition: WorkflowDefinitionV1): string {
  return JSON.stringify(definition);
}
