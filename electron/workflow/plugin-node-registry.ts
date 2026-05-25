import { getWorkflowNode, registerWorkflowNode } from './registry';
import { loadWorkflowPlugins, runPluginNode } from './plugins';
import type { RegisteredWorkflowNode } from './types';

let pluginsRegistered = false;

/** Registriert jeden Plugin-Handler als eigenen modularen Knotentyp `plugin.<id>.<handler>`. */
export function registerPluginWorkflowNodes(): void {
  if (pluginsRegistered) return;
  pluginsRegistered = true;

  let manifests: ReturnType<typeof loadWorkflowPlugins> = [];
  try {
    manifests = loadWorkflowPlugins();
  } catch {
    return;
  }

  for (const manifest of manifests) {
    for (const handler of manifest.handlers) {
      const type = `plugin.${manifest.id}.${handler.id}`;
      if (getWorkflowNode(type)) continue;
      const def: RegisteredWorkflowNode = {
        type,
        label: `${manifest.name}: ${handler.label}`,
        category: 'code',
        canvasType: 'registry',
        description: `Plugin ${manifest.id} v${manifest.version}`,
        defaultConfig: { pluginId: manifest.id, handler: handler.id },
        execute: async (ctx, config) =>
          runPluginNode(
            String(config.pluginId ?? manifest.id),
            String(config.handler ?? handler.id),
            ctx,
            config,
          ),
      };
      registerWorkflowNode(def);
    }
  }
}
