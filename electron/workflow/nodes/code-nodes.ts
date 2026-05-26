import vm from 'vm';
import type { RegisteredWorkflowNode, WorkflowContext } from '../types';
import { loadWorkflowPlugins, runPluginNode } from '../plugins';

type Reg = (def: RegisteredWorkflowNode) => void;

const CODE_TIMEOUT_MS = 30_000;

function runJavaScriptSnippet(
  code: string,
  ctx: WorkflowContext,
): { ok: boolean; variables?: Record<string, unknown>; error?: string } {
  const sandbox = {
    ctx: {
      strings: { ...ctx.strings },
      variables: { ...ctx.variables },
      messageId: ctx.messageId,
      dryRun: ctx.dryRun,
    },
    JSON,
    Math,
    Date,
    result: null as Record<string, unknown> | null,
  };
  const wrapped = `(function() {\n${code}\n})()`;
  try {
    vm.runInNewContext(wrapped, sandbox, { timeout: CODE_TIMEOUT_MS, displayErrors: true });
    const res = sandbox.result;
    if (res && typeof res === 'object') {
      return { ok: true, variables: res as Record<string, unknown> };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function registerCodeNodes(register: Reg): void {
  register({
    type: 'code.javascript',
    label: 'JavaScript',
    category: 'code',
    canvasType: 'registry',
    description:
      'Keine echte Sandbox: nur vertrauenswürdigen Code ausführen. Node-vm kann Prozesszugriff ermöglichen.',
    defaultConfig: {
      code: '// Setze result = { myVar: "wert" }\nresult = { ok: true };',
    },
    execute: async (ctx, config) => {
      const code = String(config.code ?? '');
      if (!code.trim()) return { status: 'skipped' };
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run js' };
      const r = runJavaScriptSnippet(code, ctx);
      if (!r.ok) return { status: 'error', message: r.error };
      const vars: Record<string, string | number | boolean | null> = {};
      if (r.variables) {
        for (const [k, v] of Object.entries(r.variables)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
            vars[k] = v;
          } else {
            vars[k] = JSON.stringify(v);
          }
        }
      }
      return { status: 'ok', variables: vars };
    },
  });

  register({
    type: 'code.python',
    label: 'Python (Subprozess)',
    category: 'code',
    canvasType: 'registry',
    description:
      'Führt python3 mit eingeschränkter Umgebung aus. Voller OS-Zugriff des App-Benutzers — nur eigenen Code verwenden.',
    defaultConfig: { code: 'print("ok")' },
    execute: async (ctx, config) => {
      const code = String(config.code ?? '');
      if (!code.trim()) return { status: 'skipped' };
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run python' };
      const { spawnSync } = await import('child_process');
      const r = spawnSync('python3', ['-c', code], {
        encoding: 'utf8',
        timeout: CODE_TIMEOUT_MS,
        env: {
          WORKFLOW_CTX: JSON.stringify(ctx.strings),
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
          HOME: process.env.HOME ?? '',
          TMPDIR: process.env.TMPDIR ?? '/tmp',
        },
      });
      if (r.error || r.status !== 0) {
        return { status: 'error', message: r.stderr || r.error?.message || 'Python fehlgeschlagen' };
      }
      return { status: 'ok', variables: { 'python.stdout': (r.stdout ?? '').trim() } };
    },
  });

  register({
    type: 'plugin.custom',
    label: 'Plugin-Knoten',
    category: 'code',
    canvasType: 'registry',
    defaultConfig: { pluginId: '', handler: '' },
    execute: async (ctx, config) => {
      const pluginId = String(config.pluginId ?? '');
      const handler = String(config.handler ?? '');
      if (!pluginId || !handler) return { status: 'skipped' };
      return runPluginNode(pluginId, handler, ctx, config);
    },
  });
}
