import type { EmailMessageRow } from './email-store';
import {
  getEmailMessageById,
  addMessageTag,
  setMessageArchived,
  setMessageSeenLocal,
  setOutboundHold,
  getEmailAccountById,
  listEmailAccounts,
} from './email-store';
import { assignCategoryPathToMessage, tryLinkMessageToCustomer } from './email-crm-store';
import {
  listWorkflowsByTrigger,
  wasWorkflowAppliedToMessage,
  markWorkflowAppliedToMessage,
  insertWorkflowRun,
} from './email-workflow-store';
import type { WorkflowDefinitionV1, WorkflowThenStep } from './email-workflow-types';
import { evaluateWorkflowWhen, parseWorkflowDefinition } from './email-workflow-types';
import { sendSmtpForAccount } from './email-smtp';

export type OutboundDraftPayload = {
  messageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  to: string;
  cc?: string;
};

function extractAddressList(json: string | null): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as { value?: { address?: string }[] };
    return parsed?.value?.map((v) => v.address ?? '').filter(Boolean).join(', ') ?? '';
  } catch {
    return '';
  }
}

function buildInboundContext(row: EmailMessageRow) {
  const fromAddr = extractAddressList(row.from_json);
  const toAddr = extractAddressList(row.to_json);
  const ccAddr = extractAddressList(row.cc_json);
  const sub = row.subject ?? '';
  const body = row.body_text ?? '';
  const snip = row.snippet ?? '';
  const combined = [sub, body, snip, fromAddr, toAddr, ccAddr].join('\n');
  return {
    subject: sub,
    body_text: body,
    snippet: snip,
    from_address: fromAddr,
    to_address: toAddr,
    cc_address: ccAddr,
    combined_text: combined,
  };
}

function buildOutboundContext(payload: OutboundDraftPayload) {
  const htmlPlain = (payload.bodyHtml ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const combined = [payload.subject, payload.bodyText, htmlPlain, payload.to, payload.cc ?? ''].join('\n');
  return {
    subject: payload.subject,
    body_text: payload.bodyText,
    snippet: payload.bodyText.slice(0, 500),
    from_address: '',
    to_address: payload.to,
    cc_address: payload.cc ?? '',
    combined_text: combined,
  };
}

async function executeInboundStep(step: WorkflowThenStep, messageId: number, row: EmailMessageRow, log: string[]): Promise<boolean> {
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
    case 'set_category':
      assignCategoryPathToMessage(messageId, step.path);
      log.push(`category:${step.path}`);
      return true;
    case 'link_customer':
      tryLinkMessageToCustomer(messageId);
      log.push('link_customer');
      return true;
    case 'forward_copy': {
      const acc = getEmailAccountById(row.account_id);
      if (!acc) {
        log.push('forward_copy:skip_no_account');
        return true;
      }
      const subj = row.subject ? `Fwd: ${row.subject}` : 'Weitergeleitet';
      const body = [
        row.body_text ?? row.snippet ?? '',
        '',
        '---',
        `Original von: ${buildInboundContext(row).from_address}`,
      ].join('\n');
      try {
        await sendSmtpForAccount(row.account_id, {
          from: acc.email_address,
          to: step.to,
          subject: subj,
          text: body.slice(0, 500_000),
        });
        log.push(`forward_copy:${step.to}`);
      } catch (e) {
        log.push(`forward_copy_error:${e instanceof Error ? e.message : String(e)}`);
      }
      return true;
    }
    case 'tag_attachment_meta': {
      if (row.has_attachments) {
        addMessageTag(messageId, step.tag);
        log.push(`tag_attachment_meta:${step.tag}`);
      } else {
        log.push('tag_attachment_meta:skip');
      }
      return true;
    }
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

async function runRulesInbound(def: WorkflowDefinitionV1, messageId: number, row: EmailMessageRow): Promise<string[]> {
  const ctx = buildInboundContext(row);
  const log: string[] = [];
  for (const rule of def.rules) {
    if (!evaluateWorkflowWhen(rule.when, ctx)) continue;
    log.push('rule_matched');
    for (const step of rule.then) {
      const cont = await executeInboundStep(step, messageId, row, log);
      if (!cont) return log;
    }
  }
  return log;
}

function runRulesOutbound(def: WorkflowDefinitionV1, payload: OutboundDraftPayload): { blocked: boolean; log: string[] } {
  const ctx = buildOutboundContext(payload);
  const log: string[] = [];
  for (const rule of def.rules) {
    if (!evaluateWorkflowWhen(rule.when, ctx)) continue;
    log.push('rule_matched');
    for (const step of rule.then) {
      const r = executeOutboundStep(step, payload.messageId, log);
      if (r === 'blocked') return { blocked: true, log };
      if (r === 'stop') return { blocked: false, log };
    }
  }
  return { blocked: false, log };
}

export async function runInboundWorkflowsForMessage(messageId: number): Promise<void> {
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
      log = await runRulesInbound(def, messageId, row);
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

export async function runDraftCreatedWorkflowsForMessage(messageId: number): Promise<void> {
  const row = getEmailMessageById(messageId);
  if (!row || row.uid >= 0) return;

  const workflows = listWorkflowsByTrigger('draft_created');
  for (const wf of workflows) {
    if (wasWorkflowAppliedToMessage(messageId, wf.id)) continue;
    let log: string[] = [];
    let status: 'ok' | 'error' = 'ok';
    try {
      const def = parseWorkflowDefinition(wf.definition_json);
      log = await runRulesInbound(def, messageId, row);
    } catch (e) {
      status = 'error';
      log = [`error:${e instanceof Error ? e.message : String(e)}`];
    }
    markWorkflowAppliedToMessage(messageId, wf.id);
    insertWorkflowRun({
      workflowId: wf.id,
      messageId,
      direction: 'draft_created',
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

export function runScheduledWorkflowFire(workflowId: number): void {
  const accounts = listEmailAccounts();
  const log = [`scheduled_fire`, `accounts:${accounts.length}`];
  insertWorkflowRun({
    workflowId,
    messageId: null,
    direction: 'schedule',
    status: 'ok',
    logJson: JSON.stringify(log),
  });
}
