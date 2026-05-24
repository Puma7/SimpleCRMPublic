import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { NodeExecuteResult, WorkflowContext } from './types';

export type WorkflowPluginManifest = {
  id: string;
  name: string;
  version: string;
  handlers: { id: string; label: string }[];
};

const loaded = new Map<string, WorkflowPluginManifest>();

export function workflowPluginsDir(): string {
  const dir = path.join(app.getPath('userData'), 'workflow-plugins');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadWorkflowPlugins(): WorkflowPluginManifest[] {
  loaded.clear();
  const dir = workflowPluginsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const manifest = JSON.parse(raw) as WorkflowPluginManifest;
      if (manifest.id) loaded.set(manifest.id, manifest);
    } catch {
      /* skip invalid */
    }
  }
  return [...loaded.values()];
}

export function listPluginManifests(): WorkflowPluginManifest[] {
  if (loaded.size === 0) loadWorkflowPlugins();
  return [...loaded.values()];
}

export async function runPluginNode(
  pluginId: string,
  handler: string,
  ctx: WorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeExecuteResult> {
  const manifest = loaded.get(pluginId) ?? loadWorkflowPlugins().find((p) => p.id === pluginId);
  if (!manifest) return { status: 'error', message: `Plugin ${pluginId} nicht gefunden` };
  if (!manifest.handlers.some((h) => h.id === handler)) {
    return { status: 'error', message: `Handler ${handler} unbekannt` };
  }
  const modPath = path.join(workflowPluginsDir(), pluginId, `${handler}.js`);
  if (!fs.existsSync(modPath)) {
    return { status: 'error', message: `Plugin-Datei fehlt: ${modPath}` };
  }
  const mod = require(modPath) as { run?: (ctx: unknown, config: unknown) => Promise<unknown> };
  if (typeof mod.run !== 'function') {
    return { status: 'error', message: 'Plugin exportiert keine run()-Funktion' };
  }
  const out = await mod.run(
    { strings: ctx.strings, variables: ctx.variables, messageId: ctx.messageId },
    config,
  );
  return { status: 'ok', message: typeof out === 'string' ? out : JSON.stringify(out).slice(0, 500) };
}
