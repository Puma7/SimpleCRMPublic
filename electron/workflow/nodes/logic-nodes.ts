import { getWorkflowById } from '../../email/email-workflow-store';
import { getWorkflowSpamScoreThreshold } from '../automation-settings';
import { scheduleDelayedJob } from '../delayed-jobs';
import { parseGraphDocument, resolveResumeNodeAfter } from '../runtime';
import type { RegisteredWorkflowNode } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

export function registerLogicNodes(register: Reg): void {
  register({
    type: 'logic.stop',
    label: 'Stopp',
    category: 'logic',
    canvasType: 'action',
    execute: async () => ({ status: 'ok', stop: true }),
  });

  register({
    type: 'logic.set_variable',
    label: 'Variable setzen',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { name: 'var', value: '' },
    execute: async (ctx, config) => {
      const name = String(config.name ?? 'var');
      const value = config.value;
      return {
        status: 'ok',
        variables: {
          [name]:
            typeof value === 'boolean' || typeof value === 'number'
              ? value
              : String(value ?? ''),
        },
      };
    },
  });

  register({
    type: 'logic.delay',
    label: 'Verzögerung',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { minutes: 5 },
    execute: async (ctx, config, nodeId) => {
      const minutes = Math.max(1, Math.min(60 * 24 * 7, Number(config.minutes ?? 5)));
      const executeAt = new Date(Date.now() + minutes * 60_000).toISOString();
      if (ctx.dryRun) return { status: 'ok', message: `delay ${minutes}m` };
      const wf = getWorkflowById(ctx.workflowId);
      const doc = parseGraphDocument(wf?.graph_json ?? null);
      let resumeNodeId = String(config.resumeNodeId ?? '').trim();
      if (!resumeNodeId && doc) {
        resumeNodeId = resolveResumeNodeAfter(doc, nodeId) ?? '';
      }
      if (!resumeNodeId) {
        return { status: 'error', message: 'Kein Folgeknoten für Resume (Kante nach Verzögerung)' };
      }
      scheduleDelayedJob({
        workflowId: ctx.workflowId,
        messageId: ctx.messageId,
        resumeNodeId,
        executeAt,
        contextJson: JSON.stringify({ variables: ctx.variables }),
      });
      return { status: 'ok', stop: true, message: `delayed_until:${executeAt}` };
    },
  });

  register({
    type: 'logic.merge',
    label: 'Zusammenführen',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: {},
    execute: async () => ({ status: 'ok', port: 'default' }),
  });

  register({
    type: 'logic.threshold',
    label: 'Schwellwert',
    category: 'logic',
    canvasType: 'registry',
    description: 'Vergleicht eine Workflow-Variable (z. B. ai.spam_score) mit einem Grenzwert.',
    defaultConfig: { variable: 'ai.spam_score', operator: 'gte', value: 70 },
    execute: async (ctx, config) => {
      const field = String(config.variable ?? 'ai.spam_score');
      const raw = ctx.variables[field];
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
      if (!Number.isFinite(num)) {
        return { status: 'error', message: `Variable ${field} ist keine Zahl` };
      }
      const op = String(config.operator ?? 'gte') === 'lte' ? 'lte' : 'gte';
      const useGlobal = config.useGlobalThreshold === true;
      const thresh = useGlobal
        ? getWorkflowSpamScoreThreshold()
        : Number(config.value ?? 70);
      if (!Number.isFinite(thresh)) {
        return { status: 'error', message: 'Schwellwert ungültig' };
      }
      const match = op === 'gte' ? num >= thresh : num <= thresh;
      return {
        status: 'ok',
        port: match ? 'yes' : 'no',
        variables: { 'threshold.matched': match },
      };
    },
  });

  register({
    type: 'logic.switch',
    label: 'Schalter',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { field: 'ai.class', cases: 'A,B,C' },
    execute: async (ctx, config) => {
      const field = String(config.field ?? 'ai.class');
      const raw =
        ctx.variables[field] != null
          ? String(ctx.variables[field])
          : (ctx.strings[field] ?? '');
      const value = raw.trim().toLowerCase();
      const cases = String(config.cases ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const idx = cases.indexOf(value);
      if (idx >= 0 && cases[idx]) {
        return { status: 'ok', port: cases[idx] };
      }
      return { status: 'ok', port: 'default' };
    },
  });

  register({
    type: 'logic.loop',
    label: 'Schleife',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { sourceVariable: 'attachment_names', items: '' },
    execute: async () => ({ status: 'ok', port: 'default' }),
  });
}
