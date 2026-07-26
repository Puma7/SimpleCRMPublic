import { getWorkflowById } from '../../email/email-workflow-store';
import { getEmailMessageById } from '../../email/email-store';
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
    type: 'logic.stop_after_spam',
    label: 'Stopp nach Spam',
    category: 'logic',
    canvasType: 'registry',
    description:
      'Beendet den Workflow, wenn die Mail als Spam oder „Spam prüfen" markiert ist. ' +
      'Hilfsknoten hinter email.mark_spam in Spam-Pipelines.',
    execute: async (ctx) => {
      // Prefer live DB row — a higher-priority workflow may have marked spam with
      // stopFurtherWorkflows:false while this workflow still holds a clean snapshot.
      let row = ctx.message;
      if (typeof ctx.messageId === 'number' && ctx.messageId > 0) {
        try {
          const live = getEmailMessageById(ctx.messageId);
          if (live) row = live;
        } catch {
          // Unit tests without SQLite keep the context snapshot.
        }
      }
      const isSpam =
        row?.is_spam === 1
        || row?.spam_status === 'spam'
        || row?.spam_status === 'review'
        || ctx.strings.spam_status === 'spam'
        || ctx.strings.spam_status === 'review'
        || ctx.variables['spam.status'] === 'spam'
        || ctx.variables['spam.status'] === 'review'
        || ctx.variables['email.is_spam'] === true;
      if (isSpam) {
        return {
          status: 'ok',
          stop: true,
          inboundChainStop: true,
          message: 'stop_after_spam',
        };
      }
      return { status: 'ok', message: 'not_spam:continue' };
    },
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
    defaultConfig: { delaySeconds: 60 },
    execute: async (ctx, config, nodeId) => {
      const totalMs =
        config.delaySeconds !== undefined
          ? Math.max(1000, Math.min(60 * 24 * 7 * 60 * 1000, Number(config.delaySeconds ?? 60) * 1000))
          : Math.max(60_000, Math.min(60 * 24 * 7 * 60 * 1000, Number(config.minutes ?? 5) * 60_000));
      const executeAt = new Date(Date.now() + totalMs).toISOString();
      const delayLabel =
        config.delaySeconds !== undefined
          ? `${Number(config.delaySeconds ?? 60)}s`
          : `${Number(config.minutes ?? 5)}m`;
      if (ctx.dryRun) return { status: 'ok', message: `delay ${delayLabel}` };
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
        contextJson: JSON.stringify({
          variables: ctx.variables,
          inboundConditionOk: ctx.variables.__inbound_condition_ok === true,
          eventStrings: ctx.strings,
        }),
      });
      return { status: 'ok', stop: true, deferred: true, message: `delayed_until:${executeAt}` };
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
    defaultConfig: { sourceVariable: 'attachment_names', items: '', maxItems: 50 },
    execute: async () => ({ status: 'ok', port: 'default' }),
  });
}
