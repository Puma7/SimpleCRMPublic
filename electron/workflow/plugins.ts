import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { app } from 'electron';
import {
  isSafeWorkflowPluginId,
  resolveWorkflowPluginModulePath,
} from '../../shared/workflow-plugin-path';
import type { NodeExecuteResult, WorkflowContext } from './types';

export type WorkflowPluginManifest = {
  id: string;
  name: string;
  version: string;
  handlers: { id: string; label: string }[];
};

const PLUGIN_TIMEOUT_MS = 30_000;
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
      if (!manifest.id || !isSafeWorkflowPluginId(manifest.id)) continue;
      const handlers = (manifest.handlers ?? []).filter((h) =>
        /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(h.id),
      );
      if (handlers.length === 0) continue;
      loaded.set(manifest.id, { ...manifest, handlers });
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

function loadPluginRunFunction(modPath: string): ((ctx: unknown, config: unknown) => Promise<unknown>) | null {
  const code = fs.readFileSync(modPath, 'utf8');
  const sandbox: {
    module: { exports: Record<string, unknown> };
    exports: Record<string, unknown>;
  } = {
    module: { exports: {} },
    exports: {},
  };
  sandbox.exports = sandbox.module.exports;
  try {
    vm.runInNewContext(
      `${code}\n//# sourceURL=${modPath}`,
      sandbox,
      { filename: modPath, timeout: PLUGIN_TIMEOUT_MS, displayErrors: true },
    );
  } catch (e) {
    console.warn('[workflow-plugin] load failed', modPath, e);
    return null;
  }
  const run = sandbox.module.exports.run ?? sandbox.exports.run;
  return typeof run === 'function'
    ? (run as (ctx: unknown, config: unknown) => Promise<unknown>)
    : null;
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
  const modPath = resolveWorkflowPluginModulePath(workflowPluginsDir(), pluginId, handler);
  if (!modPath || !fs.existsSync(modPath)) {
    return { status: 'error', message: `Plugin-Datei fehlt oder ungültiger Pfad` };
  }
  const run = loadPluginRunFunction(modPath);
  if (!run) {
    return { status: 'error', message: 'Plugin exportiert keine run()-Funktion' };
  }
  const out = await run(
    { strings: ctx.strings, variables: ctx.variables, messageId: ctx.messageId },
    config,
  );
  return { status: 'ok', message: typeof out === 'string' ? out : JSON.stringify(out).slice(0, 500) };
}
