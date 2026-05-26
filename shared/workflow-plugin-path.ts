import path from 'path';

/** Safe plugin folder / handler names (no path segments). */
export const WORKFLOW_PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
export const WORKFLOW_PLUGIN_HANDLER_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isSafeWorkflowPluginId(id: string): boolean {
  return WORKFLOW_PLUGIN_ID_RE.test(id);
}

export function isSafeWorkflowPluginHandler(handler: string): boolean {
  return WORKFLOW_PLUGIN_HANDLER_RE.test(handler);
}

/** Resolve plugin handler path; returns null if id/handler unsafe or escapes plugins root. */
export function resolveWorkflowPluginModulePath(
  pluginsRoot: string,
  pluginId: string,
  handler: string,
): string | null {
  if (!isSafeWorkflowPluginId(pluginId) || !isSafeWorkflowPluginHandler(handler)) {
    return null;
  }
  const base = path.resolve(pluginsRoot);
  const modPath = path.resolve(base, pluginId, `${handler}.js`);
  const rel = path.relative(base, modPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return modPath;
}
