import type { RegisteredWorkflowNode } from './types';
import type { WorkflowNodeCatalogEntry } from '../../shared/workflow-types';

const nodes = new Map<string, RegisteredWorkflowNode>();

export function registerWorkflowNode(def: RegisteredWorkflowNode): void {
  nodes.set(def.type, def);
}

export function getWorkflowNode(type: string): RegisteredWorkflowNode | undefined {
  return nodes.get(type);
}

export function listWorkflowNodeCatalog(): WorkflowNodeCatalogEntry[] {
  return [...nodes.values()]
    .map((n) => ({
      type: n.type,
      label: n.label,
      category: n.category,
      description: n.description,
      canvasType: n.canvasType,
      defaultConfig: n.defaultConfig,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/** Maps legacy graph actionType to registry type id */
export const LEGACY_ACTION_MAP: Record<string, string> = {
  tag: 'email.tag',
  mark_seen: 'email.mark_seen',
  archive: 'email.archive',
  hold_outbound: 'email.hold_outbound',
  set_category: 'email.set_category',
  link_customer: 'crm.link_customer',
  forward_copy: 'email.forward_copy',
  tag_attachment_meta: 'email.tag_attachment_meta',
  ai_review: 'ai.review',
  stop: 'logic.stop',
};

let builtinsLoaded = false;

export function ensureBuiltinWorkflowNodes(): void {
  if (builtinsLoaded) return;
  require('./register-builtin-nodes');
  const { registerPluginWorkflowNodes } = require('./plugin-node-registry') as typeof import('./plugin-node-registry');
  registerPluginWorkflowNodes();
  builtinsLoaded = true;
}
