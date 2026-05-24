import type { WorkflowNodeCategory } from './workflow-types';

export const WORKFLOW_CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  trigger: 'Trigger',
  logic: 'Logik',
  email: 'E-Mail',
  crm: 'CRM',
  ai: 'KI',
  integration: 'Integration',
  code: 'Code',
};

/** Display order for registry nodes in the workflow palette. */
export const WORKFLOW_REGISTRY_CATEGORY_ORDER: WorkflowNodeCategory[] = [
  'logic',
  'email',
  'crm',
  'ai',
  'code',
  'integration',
];

export const WORKFLOW_ACTION_LABELS: Record<string, string> = {
  tag: 'Tag setzen',
  mark_seen: 'Als gelesen markieren',
  archive: 'Archivieren',
  hold_outbound: 'Versand sperren',
  set_category: 'Kategorie setzen',
  link_customer: 'Kunde verknüpfen',
  forward_copy: 'Kopie weiterleiten',
  tag_attachment_meta: 'Tag bei Anhang',
  ai_review: 'KI-Prüfung',
  stop: 'Stopp',
};

export function resolveRegistryNodeLabel(
  nodeType: string | undefined,
  labelByType: Map<string, string>,
  storedLabel?: string,
): string {
  if (storedLabel?.trim()) return storedLabel.trim();
  if (!nodeType) return 'Erweiterter Knoten';
  return labelByType.get(nodeType) ?? nodeType;
}

export function resolveRunStepNodeLabel(input: {
  nodeId: string;
  nodeType: string;
  labelByType: Map<string, string>;
  graphNodes: { id: string; type?: string; data?: Record<string, unknown> }[];
}): { title: string; subtitle: string | null } {
  const graphNode = input.graphNodes.find((n) => n.id === input.nodeId);
  if (graphNode?.type === 'registry') {
    const d = graphNode.data ?? {};
    const nodeType = typeof d.nodeType === 'string' ? d.nodeType : input.nodeType;
    const storedLabel = typeof d.label === 'string' ? d.label : undefined;
    return {
      title: resolveRegistryNodeLabel(nodeType, input.labelByType, storedLabel),
      subtitle: null,
    };
  }
  if (graphNode?.type === 'action') {
    const actionType =
      typeof graphNode.data?.actionType === 'string' ? graphNode.data.actionType : input.nodeType;
    return {
      title: WORKFLOW_ACTION_LABELS[actionType] ?? actionType,
      subtitle: null,
    };
  }
  if (graphNode?.type === 'condition') {
    return { title: 'Bedingung', subtitle: null };
  }
  if (graphNode?.type === 'trigger') {
    return { title: 'Trigger', subtitle: null };
  }
  const fromCatalog = input.labelByType.get(input.nodeType);
  if (fromCatalog) {
    return { title: fromCatalog, subtitle: null };
  }
  return {
    title: input.nodeType,
    subtitle: input.nodeId.length > 12 ? input.nodeId : null,
  };
}
