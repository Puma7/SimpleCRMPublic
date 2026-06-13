import type {
  WorkflowGraphDocument,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphTriggerKind,
} from '../../shared/email-workflow-graph';
import type {
  WorkflowCondition,
  WorkflowConditionItem,
  WorkflowDefinitionV1,
  WorkflowThenStep,
} from '../email/email-workflow-types';

function flattenWhen(
  when: WorkflowDefinitionV1['rules'][0]['when'],
): { cond: WorkflowCondition; negated?: boolean }[] {
  if (when == null) return [];
  if ('not' in when && when.not) return [{ cond: when.not as WorkflowCondition, negated: true }];
  if ('all' in when && when.all) {
    return when.all.map((c) => ({ cond: c as WorkflowCondition }));
  }
  return [{ cond: when as WorkflowCondition }];
}

function stepToActionData(step: WorkflowThenStep): Record<string, unknown> | null {
  switch (step.type) {
    case 'tag':
      return { actionType: 'tag', tag: step.tag };
    case 'mark_seen':
      return { actionType: 'mark_seen' };
    case 'archive':
      return { actionType: 'archive' };
    case 'hold_outbound':
      return { actionType: 'hold_outbound', reason: step.reason };
    case 'set_category':
      return { actionType: 'set_category', path: step.path };
    case 'link_customer':
      return { actionType: 'link_customer' };
    case 'forward_copy':
      return {
        actionType: 'forward_copy',
        to: step.to,
        includeAttachments: step.includeAttachments === true,
        runOutboundReview: step.runOutboundReview === true,
      };
    case 'tag_attachment_meta':
      return { actionType: 'tag_attachment_meta', tag: step.tag };
    case 'ai_review':
      return {
        actionType: 'ai_review',
        promptId: step.promptId,
        blockKeyword: step.blockKeyword,
      };
    case 'registry':
      return { nodeType: step.nodeType, config: step.config };
    case 'stop':
      return { actionType: 'stop' };
    default:
      return null;
  }
}

/**
 * Migriert Legacy-Regeln (definition_json) in einen Graph für den modularen Interpreter.
 * Registry-Knoten sind nur im gespeicherten graph_json enthalten — nicht in definition_json.
 */
export function definitionToGraphDocument(
  def: WorkflowDefinitionV1,
  trigger: string,
): WorkflowGraphDocument | null {
  if (!def.rules.length) return null;

  const nodes: WorkflowGraphNode[] = [
    {
      id: 'trigger-1',
      type: 'trigger',
      data: { kind: trigger as WorkflowGraphTriggerKind },
    },
  ];
  const edges: WorkflowGraphEdge[] = [];
  let edgeSeq = 0;

  def.rules.forEach((rule, ruleIdx) => {
    let prev = 'trigger-1';
    const conds = flattenWhen(rule.when);
    conds.forEach((item, ci) => {
      const cid = `cond-${ruleIdx}-${ci}`;
      nodes.push({
        id: cid,
        type: 'condition',
        data: {
          field: item.cond.field,
          op: item.cond.op,
          value: item.cond.value,
          caseInsensitive: item.cond.caseInsensitive,
          ...(item.negated ? { negated: true } : {}),
        },
      });
      edges.push({
        id: `e-${edgeSeq++}`,
        source: prev,
        target: cid,
        ...(prev === 'trigger-1' ? {} : { label: 'ja' }),
      });
      prev = cid;
    });

    rule.then.forEach((step, si) => {
      const data = stepToActionData(step);
      if (!data) return;
      const aid = `act-${ruleIdx}-${si}`;
      const type = step.type === 'registry' ? 'registry' : 'action';
      nodes.push({ id: aid, type, data: data as WorkflowGraphNode['data'] });
      edges.push({
        id: `e-${edgeSeq++}`,
        source: prev,
        target: aid,
        label: conds.length > 0 ? 'ja' : undefined,
      });
      prev = aid;
    });
  });

  return { version: 1, nodes, edges };
}
