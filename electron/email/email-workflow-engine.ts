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
import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE } from '../database-schema';
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

async function executeInboundStep(
  step: WorkflowThenStep,
  messageId: number,
  row: EmailMessageRow,
  log: string[],
  workflowId: number,
): Promise<boolean> {
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
      const dest = step.to.trim().toLowerCase();
      const dup = getDb()
        .prepare(
          `SELECT 1 FROM ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} WHERE message_id = ? AND workflow_id = ? AND dest = ?`,
        )
        .get(messageId, workflowId, dest) as { 1: number } | undefined;
      if (dup) {
        log.push('forward_copy:skip_duplicate');
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
        getDb()
          .prepare(
            `INSERT OR IGNORE INTO ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} (message_id, workflow_id, dest) VALUES (?, ?, ?)`,
          )
          .run(messageId, workflowId, dest);
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

async function runRulesInbound(
  def: WorkflowDefinitionV1,
  messageId: number,
  row: EmailMessageRow,
  workflowId: number,
): Promise<string[]> {
  const ctx = buildInboundContext(row);
  const log: string[] = [];
  for (const rule of def.rules) {
    if (!evaluateWorkflowWhen(rule.when, ctx)) continue;
    log.push('rule_matched');
    for (const step of rule.then) {
      const cont = await executeInboundStep(step, messageId, row, log, workflowId);
      if (!cont) return log;
    }
  }
  return log;
}

async function runRulesOutbound(
  def: WorkflowDefinitionV1,
  payload: OutboundDraftPayload,
): Promise<{ blocked: boolean; log: string[] }> {
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
  if (row.uid < 0 && !row.pop3_uidl) return;

  const workflows = listWorkflowsByTrigger('inbound');
  for (const wf of workflows) {
    if (wasWorkflowAppliedToMessage(messageId, wf.id)) continue;
    let log: string[] = [];
    let status: 'ok' | 'error' = 'ok';
    try {
      const def = parseWorkflowDefinition(wf.definition_json);
      log = await runRulesInbound(def, messageId, row, wf.id);
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
      log = await runRulesInbound(def, messageId, row, wf.id);
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

export async function evaluateOutboundWorkflows(payload: OutboundDraftPayload): Promise<{
  allowed: boolean;
  reason: string | null;
}> {
  if (!payload.messageId || payload.messageId <= 0) {
    return { allowed: true, reason: null };
  }
  const row = getEmailMessageById(payload.messageId);
  if (!row) {
    return { allowed: true, reason: null };
  }

  setOutboundHold(payload.messageId, false, null);

  const workflows = listWorkflowsByTrigger('outbound');
  let parseOrEngineError: string | null = null;
  for (const wf of workflows) {
    try {
      const def = parseWorkflowDefinition(wf.definition_json);
      const { blocked, log } = await runRulesOutbound(def, payload);
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
      const msg = e instanceof Error ? e.message : String(e);
      parseOrEngineError = msg;
      insertWorkflowRun({
        workflowId: wf.id,
        messageId: payload.messageId,
        direction: 'outbound',
        status: 'error',
        logJson: JSON.stringify([`error:${msg}`]),
      });
    }
  }

  if (parseOrEngineError) {
    setOutboundHold(payload.messageId, true, `Workflow-Fehler: ${parseOrEngineError}`);
    return {
      allowed: false,
      reason: 'Ausgehender Workflow fehlgeschlagen; Versand aus Sicherheitsgründen blockiert.',
    };
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

export async function runScheduledWorkflowFire(workflowId: number): Promise<void> {
  const { getWorkflowById } = await import('./email-workflow-store');
  const wf = getWorkflowById(workflowId);
  const accounts = listEmailAccounts();
  const log: string[] = [`scheduled_fire`, `accounts:${accounts.length}`];
  let status: 'ok' | 'error' = 'ok';
  if (wf?.schedule_account_id != null) {
    const accId = wf.schedule_account_id;
    try {
      const { getEmailAccountById } = await import('./email-store');
      const acc = getEmailAccountById(accId);
      if (!acc) {
        log.push(`sync_skip:no_account:${accId}`);
      } else if ((acc.protocol || 'imap') === 'pop3') {
        const { syncInboxPop3 } = await import('./email-pop3-sync');
        const r = await syncInboxPop3(accId);
        log.push(`pop3_fetched:${r.fetched}`);
      } else {
        const { syncInboxImap } = await import('./email-imap-sync');
        const r = await syncInboxImap(accId);
        log.push(`imap_fetched:${r.fetched}`);
      }
    } catch (e) {
      status = 'error';
      log.push(`sync_error:${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    log.push('sync_skip:no_schedule_account');
  }
  insertWorkflowRun({
    workflowId,
    messageId: null,
    direction: 'schedule',
    status,
    logJson: JSON.stringify(log),
  });
}
