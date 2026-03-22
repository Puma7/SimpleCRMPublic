import type { EmailMessageRow } from './email-store';
import {
  getEmailMessageById,
  addMessageTag,
  setMessageArchived,
  setMessageSeenLocal,
  setOutboundHold,
} from './email-store';
import {
  listWorkflowsByTrigger,
  wasWorkflowAppliedToMessage,
  markWorkflowAppliedToMessage,
  insertWorkflowRun,
} from './email-workflow-store';
import type {
  WorkflowCondition,
  WorkflowDefinitionV1,
  WorkflowRule,
  WorkflowThenStep,
} from './email-workflow-types';
import { parseWorkflowDefinition } from './email-workflow-types';

export type OutboundDraftPayload = {
  messageId: number;
  subject: string;
  bodyText: string;
  to: string;
  cc?: string;
};

function extractFromAddress(fromJson: string | null): string {
  if (!fromJson) return '';
  try {
    const parsed = JSON.parse(fromJson) as { value?: { address?: string }[] };
    return parsed?.value?.map((v) => v.address ?? '').filter(Boolean).join(', ') ?? '';
  } catch {
    return '';
  }
}

function buildInboundContext(row: EmailMessageRow) {
  const fromAddr = extractFromAddress(row.from_json);
  const sub = row.subject ?? '';
  const body = row.body_text ?? '';
  const snip = row.snippet ?? '';
  const combined = [sub, body, snip, fromAddr].join('\n');
  return { subject: sub, body_text: body, snippet: snip, from_address: fromAddr, combined_text: combined };
}

function buildOutboundContext(payload: OutboundDraftPayload) {
  const combined = [payload.subject, payload.bodyText, payload.to, payload.cc ?? ''].join('\n');
  return {
    subject: payload.subject,
    body_text: payload.bodyText,
    snippet: payload.bodyText.slice(0, 500),
    from_address: '',
    combined_text: combined,
  };
}

function matchCondition(cond: WorkflowCondition | null, ctx: ReturnType<typeof buildInboundContext>): boolean {
  if (!cond) return true;
  let haystack = '';
  switch (cond.field) {
    case 'subject':
      haystack = ctx.subject;
      break;
    case 'body_text':
      haystack = ctx.body_text;
      break;
    case 'snippet':
      haystack = ctx.snippet;
      break;
    case 'from_address':
      haystack = ctx.from_address;
      break;
    case 'combined_text':
      haystack = ctx.combined_text;
      break;
    default:
      haystack = ctx.combined_text;
  }
  const needle = cond.value ?? '';
  const ci = cond.caseInsensitive !== false;

  if (cond.op === 'equals') {
    return ci ? haystack.toLowerCase() === needle.toLowerCase() : haystack === needle;
  }
  if (cond.op === 'contains') {
    const h = ci ? haystack.toLowerCase() : haystack;
    const n = ci ? needle.toLowerCase() : needle;
    return h.includes(n);
  }
  if (cond.op === 'domain_ends_with') {
    const at = ctx.from_address.lastIndexOf('@');
    const domain = at >= 0 ? ctx.from_address.slice(at + 1) : ctx.from_address;
    const d = ci ? domain.toLowerCase() : domain;
    const suf = ci ? needle.toLowerCase() : needle;
    return d.endsWith(suf);
  }
  if (cond.op === 'regex') {
    try {
      const flags = ci ? 'i' : '';
      return new RegExp(needle, flags).test(haystack);
    } catch {
      return false;
    }
  }
  return false;
}

function executeInboundStep(step: WorkflowThenStep, messageId: number, log: string[]): boolean {
  switch (step.type) {
    case 'tag':
      addMessageTag(messageId, step.tag);
      log.push(`tag:${step.tag}`);
      return true;
    case 'mark_seen':
      setMessageSeenLocal(messageId, true);
      log.push('mark_seen');
      return true;
    case 'archive':
      setMessageArchived(messageId, true);
      log.push('archive');
      return true;
    case 'hold_outbound':
      setOutboundHold(messageId, true, step.reason);
      log.push(`hold_outbound:${step.reason}`);
      return true;
    case 'stop':
      log.push('stop');
      return false;
    default:
      return true;
  }
}

function executeOutboundStep(
  step: WorkflowThenStep,
  messageId: number,
  log: string[],
): 'continue' | 'stop' | 'blocked' {
  if (step.type === 'hold_outbound') {
    setOutboundHold(messageId, true, step.reason);
    log.push(`hold_outbound:${step.reason}`);
    return 'blocked';
  }
  if (step.type === 'stop') {
    log.push('stop');
    return 'stop';
  }
  log.push(`skip:${(step as WorkflowThenStep).type}`);
  return 'continue';
}

function runRulesInbound(def: WorkflowDefinitionV1, messageId: number, row: EmailMessageRow): string[] {
  const ctx = buildInboundContext(row);
  const log: string[] = [];
  for (const rule of def.rules) {
    if (!matchCondition(rule.when, ctx)) continue;
    log.push('rule_matched');
    for (const step of rule.then) {
      const cont = executeInboundStep(step, messageId, log);
      if (!cont) return log;
    }
  }
  return log;
}

function runRulesOutbound(def: WorkflowDefinitionV1, payload: OutboundDraftPayload): { blocked: boolean; log: string[] } {
  const ctx = buildOutboundContext(payload);
  const log: string[] = [];
  for (const rule of def.rules) {
    if (!matchCondition(rule.when, ctx)) continue;
    log.push('rule_matched');
    for (const step of rule.then) {
      const r = executeOutboundStep(step, payload.messageId, log);
      if (r === 'blocked') return { blocked: true, log };
      if (r === 'stop') return { blocked: false, log };
    }
  }
  return { blocked: false, log };
}

export function runInboundWorkflowsForMessage(messageId: number): void {
  const row = getEmailMessageById(messageId);
  if (!row) return;
  if (row.uid < 0) return;

  const workflows = listWorkflowsByTrigger('inbound');
  for (const wf of workflows) {
    if (wasWorkflowAppliedToMessage(messageId, wf.id)) continue;
    let log: string[] = [];
    let status: 'ok' | 'error' = 'ok';
    try {
      const def = parseWorkflowDefinition(wf.definition_json);
      log = runRulesInbound(def, messageId, row);
    } catch (e) {
      status = 'error';
      log = [`error:${e instanceof Error ? e.message : String(e)}`];
    }
    markWorkflowAppliedToMessage(messageId, wf.id);
    insertWorkflowRun({
      workflowId: wf.id,
      messageId,
      direction: 'inbound',
      status,
      logJson: JSON.stringify(log),
    });
  }
}

export function evaluateOutboundWorkflows(payload: OutboundDraftPayload): {
  allowed: boolean;
  reason: string | null;
} {
  if (!payload.messageId || payload.messageId <= 0) {
    return { allowed: true, reason: null };
  }
  const row = getEmailMessageById(payload.messageId);
  if (!row) {
    return { allowed: true, reason: null };
  }

  setOutboundHold(payload.messageId, false, null);

  const workflows = listWorkflowsByTrigger('outbound');
  for (const wf of workflows) {
    try {
      const def = parseWorkflowDefinition(wf.definition_json);
      const { blocked, log } = runRulesOutbound(def, payload);
      insertWorkflowRun({
        workflowId: wf.id,
        messageId: payload.messageId,
        direction: 'outbound',
        status: blocked ? 'blocked' : 'ok',
        logJson: JSON.stringify(log),
      });
      if (blocked) {
        const fresh = getEmailMessageById(payload.messageId);
        const reason =
          fresh?.outbound_block_reason ||
          'Ausgehende Nachricht durch Workflow zurückgestellt. Bitte Text prüfen.';
        return { allowed: false, reason };
      }
      const checkHold = getEmailMessageById(payload.messageId);
      if (checkHold?.outbound_hold) {
        return {
          allowed: false,
          reason: checkHold.outbound_block_reason || 'Ausgehende Nachricht zurückgestellt.',
        };
      }
    } catch (e) {
      insertWorkflowRun({
        workflowId: wf.id,
        messageId: payload.messageId,
        direction: 'outbound',
        status: 'error',
        logJson: JSON.stringify([`error:${e instanceof Error ? e.message : String(e)}`]),
      });
    }
  }

  const after = getEmailMessageById(payload.messageId);
  if (after?.outbound_hold) {
    return {
      allowed: false,
      reason: after.outbound_block_reason || 'Ausgehende Nachricht zurückgestellt.',
    };
  }
  return { allowed: true, reason: null };
}
