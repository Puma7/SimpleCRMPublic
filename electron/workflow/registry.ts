import type { RegisteredWorkflowNode } from './types';
import type { WorkflowNodeCatalogEntry } from '../../shared/workflow-types';
import { getBuiltinWorkflowNodeCatalogEntry } from '../../packages/core/src/workflow/node-catalog';

const nodes = new Map<string, RegisteredWorkflowNode>();

export function registerWorkflowNode(def: RegisteredWorkflowNode): void {
  if (nodes.has(def.type)) {
    throw new Error(`Workflow-Knoten doppelt registriert: ${def.type}`);
  }
  nodes.set(def.type, def);
}

export function getWorkflowNode(type: string): RegisteredWorkflowNode | undefined {
  return nodes.get(type);
}

// Der Core-Katalog pflegt die reichhaltigen deutschen Beschreibungen/Defaults;
// Registrierungen liefern nur, was dort fehlt oder abweicht.
export function listWorkflowNodeCatalog(): WorkflowNodeCatalogEntry[] {
  return [...nodes.values()]
    .map((n) => {
      const core = getBuiltinWorkflowNodeCatalogEntry(n.type);
      return {
        type: n.type,
        label: n.label,
        category: n.category,
        description: n.description ?? core?.description,
        canvasType: n.canvasType,
        defaultConfig:
          core?.defaultConfig || n.defaultConfig
            ? { ...core?.defaultConfig, ...n.defaultConfig }
            : undefined,
        ...(core?.runtime === undefined ? {} : { runtime: core.runtime }),
        ...(core?.fields === undefined ? {} : { fields: core.fields }),
        ...(core?.ports === undefined ? {} : { ports: core.ports }),
        ...(core?.outputs === undefined ? {} : { outputs: core.outputs }),
        ...(core?.docs === undefined ? {} : { docs: core.docs }),
        ...(core?.customWidget === undefined ? {} : { customWidget: core.customWidget }),
      };
    })
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
