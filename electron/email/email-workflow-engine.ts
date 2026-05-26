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
import {
  attachmentContextFromJson,
  evaluateWorkflowWhen,
  parseWorkflowDefinition,
} from './email-workflow-types';
import { listAiPrompts } from './email-crm-store';
import { addressesFromRecipientJson } from './email-parse-utils';
import { runChatCompletion } from './email-openai';
import { sendSmtpForAccount } from './email-smtp';

export type OutboundDraftPayload = {
  messageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  to: string;
  cc?: string;
  inReplyToMessageId?: number | null;
  attachmentCount?: number;
};

export function outboundPayloadFromMessage(
  row: EmailMessageRow,
  opts: { attachmentCount?: number } = {},
): OutboundDraftPayload {
  const to = extractAddressList(row.to_json);
  const cc = extractAddressList(row.cc_json);
  return {
    messageId: row.id,
    subject: row.subject ?? '',
    bodyText: row.body_text ?? '',
    bodyHtml: row.body_html ?? undefined,
    to,
    cc: cc || undefined,
    attachmentCount: opts.attachmentCount ?? 0,
  };
}

function extractAddressList(json: string | null): string {
  return addressesFromRecipientJson(json);
}

function buildInboundContext(row: EmailMessageRow) {
  const fromAddr = extractAddressList(row.from_json);
  const toAddr = extractAddressList(row.to_json);
  const ccAddr = extractAddressList(row.cc_json);
  const sub = row.subject ?? '';
  const body = row.body_text ?? '';
  const snip = row.snippet ?? '';
  const combined = [sub, body, snip, fromAddr, toAddr, ccAddr].join('\n');
  const att = attachmentContextFromJson(row.attachments_json, row.has_attachments);
  return {
    subject: sub,
    body_text: body,
    snippet: snip,
    from_address: fromAddr,
    to_address: toAddr,
    cc_address: ccAddr,
    combined_text: combined,
    ...att,
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
    case 'ai_review': {
      const ctx = buildInboundContext(row);
      const blocked = await runAiReviewStep(step, ctx.combined_text, log);
      if (blocked) {
        addMessageTag(messageId, 'ki-review-block');
        log.push('ai_review:inbound_tag');
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

async function runAiReviewStep(
  step: Extract<WorkflowThenStep, { type: 'ai_review' }>,
  text: string,
  log: string[],
): Promise<boolean> {
  const prompts = listAiPrompts();
  const p = prompts.find((x) => x.id === step.promptId);
  if (!p) {
    log.push('ai_review:prompt_not_found');
    return false;
  }
  const user = p.user_template.replace(/\{\{text\}\}/g, text);
  const blockKw = (step.blockKeyword ?? 'BLOCK').trim() || 'BLOCK';
  try {
    const out = await runChatCompletion(
      'Antworte nur mit OK oder BLOCK. BLOCK wenn der Inhalt laut Prüfauftrag problematisch ist.',
      user,
    );
    const blocked = out.toUpperCase().includes(blockKw.toUpperCase());
    log.push(blocked ? `ai_review:block:${blockKw}` : 'ai_review:ok');
    return blocked;
  } catch (e) {
    log.push(`ai_review_error:${e instanceof Error ? e.message : String(e)}`);
    return true;
  }
}

async function executeOutboundStep(
  step: WorkflowThenStep,
  messageId: number,
  payload: OutboundDraftPayload,
  log: string[],
): Promise<'continue' | 'stop' | 'blocked'> {
  if (step.type === 'hold_outbound') {
    setOutboundHold(messageId, true, step.reason);
    log.push(`hold_outbound:${step.reason}`);
    return 'blocked';
  }
  if (step.type === 'ai_review') {
    const ctx = buildOutboundContext(payload);
    const blocked = await runAiReviewStep(step, ctx.combined_text, log);
    if (blocked) {
      setOutboundHold(messageId, true, 'KI-Prüfung: Versand blockiert');
      return 'blocked';
    }
    return 'continue';
  }
  if (step.type === 'stop') {
    log.push('stop');
    return 'stop';
  }
  log.push(`skip:${(step as WorkflowThenStep).type}`);
  return 'continue';
}

export async function runCompiledInboundRules(
  def: WorkflowDefinitionV1,
  messageId: number,
  row: EmailMessageRow,
  workflowId: number,
): Promise<string[]> {
  return runRulesInbound(def, messageId, row, workflowId);
}

export async function runCompiledOutboundRules(
  def: WorkflowDefinitionV1,
  payload: OutboundDraftPayload,
): Promise<{ blocked: boolean; log: string[] }> {
  return runRulesOutbound(def, payload);
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
    if (rule.when == null && rule.then.some((s) => s.type !== 'stop')) {
      log.push('skip_rule:unconditional');
      continue;
    }
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
      const r = await executeOutboundStep(step, payload.messageId, payload, log);
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

  const { runMailSecurityPipeline } = await import('./mail-security-pipeline');
  const security = await runMailSecurityPipeline(messageId);
  if (security.preWorkflow.skippedWorkflows) return;

  const { executeWorkflowForTrigger } = await import('../workflow/workflow-executor');
  const workflows = listWorkflowsByTrigger('inbound');
  for (const wf of workflows) {
    if (wasWorkflowAppliedToMessage(messageId, wf.id)) continue;
    let markApplied = false;
    try {
      const r = await executeWorkflowForTrigger({
        workflow: wf,
        trigger: 'inbound',
        direction: 'inbound',
        message: row,
      });
      if (r.status === 'ok') markApplied = true;
    } catch (e) {
      insertWorkflowRun({
        workflowId: wf.id,
        messageId,
        direction: 'inbound',
        status: 'error',
        logJson: JSON.stringify([`error:${e instanceof Error ? e.message : String(e)}`]),
      });
    }
    if (markApplied) markWorkflowAppliedToMessage(messageId, wf.id);
  }

  const { ensureReplySuggestion } = await import('./email-reply-ai');
  ensureReplySuggestion(messageId);
}

export async function runDraftCreatedWorkflowsForMessage(messageId: number): Promise<void> {
  const row = getEmailMessageById(messageId);
  if (!row || row.uid >= 0) return;

  const { executeWorkflowForTrigger } = await import('../workflow/workflow-executor');
  const workflows = listWorkflowsByTrigger('draft_created');
  for (const wf of workflows) {
    if (wasWorkflowAppliedToMessage(messageId, wf.id)) continue;
    let markApplied = false;
    try {
      const r = await executeWorkflowForTrigger({
        workflow: wf,
        trigger: 'draft_created',
        direction: 'draft_created',
        message: row,
      });
      if (r.status === 'ok') markApplied = true;
    } catch (e) {
      insertWorkflowRun({
        workflowId: wf.id,
        messageId,
        direction: 'draft_created',
        status: 'error',
        logJson: JSON.stringify([`error:${e instanceof Error ? e.message : String(e)}`]),
      });
    }
    if (markApplied) markWorkflowAppliedToMessage(messageId, wf.id);
  }
}

export async function evaluateOutboundWorkflows(
  payload: OutboundDraftPayload,
  options?: { dryRun?: boolean },
): Promise<{
  allowed: boolean;
  reason: string | null;
}> {
  const dryRun = options?.dryRun === true;
  if (!payload.messageId || payload.messageId <= 0) {
    if (dryRun) return { allowed: true, reason: null };
    return { allowed: false, reason: 'Kein gültiger Entwurf für die Ausgangsprüfung' };
  }
  const row = getEmailMessageById(payload.messageId);
  if (!row) {
    if (dryRun) return { allowed: true, reason: null };
    return { allowed: false, reason: 'Entwurf nicht gefunden' };
  }

  if (!dryRun) {
    setOutboundHold(payload.messageId, false, null);
  }

  const { executeWorkflowForTrigger } = await import('../workflow/workflow-executor');
  const workflows = listWorkflowsByTrigger('outbound');
  let parseOrEngineError: string | null = null;
  for (const wf of workflows) {
    try {
      const r = await executeWorkflowForTrigger({
        workflow: wf,
        trigger: 'outbound',
        direction: 'outbound',
        message: row,
        outbound: payload,
        dryRun,
      });
      if (r.blocked) {
        const reason =
          r.blockReason ||
          'Ausgehende Nachricht durch Workflow zurückgestellt. Bitte Text prüfen.';
        if (!dryRun) {
          const { returnOutboundDraftToInbox } = await import('./email-outbound-review');
          returnOutboundDraftToInbox(payload.messageId, reason, { payload });
        }
        return { allowed: false, reason };
      }
      if (!dryRun) {
        const checkHold = getEmailMessageById(payload.messageId);
        if (checkHold?.outbound_hold) {
          const reason = checkHold.outbound_block_reason || 'Ausgehende Nachricht zurückgestellt.';
          const { returnOutboundDraftToInbox } = await import('./email-outbound-review');
          returnOutboundDraftToInbox(payload.messageId, reason, { payload });
          return { allowed: false, reason };
        }
      }
      if (r.status === 'error') {
        parseOrEngineError = r.log.join('; ');
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
    const reason = `Workflow-Fehler: ${parseOrEngineError}`;
    if (!dryRun) {
      setOutboundHold(payload.messageId, true, reason);
      const { returnOutboundDraftToInbox } = await import('./email-outbound-review');
      returnOutboundDraftToInbox(payload.messageId, reason, { payload });
    }
    return {
      allowed: false,
      reason: 'Ausgehender Workflow fehlgeschlagen; Versand aus Sicherheitsgründen blockiert.',
    };
  }

  if (!dryRun) {
    const after = getEmailMessageById(payload.messageId);
    if (after?.outbound_hold) {
      const reason = after.outbound_block_reason || 'Ausgehende Nachricht zurückgestellt.';
      const { returnOutboundDraftToInbox } = await import('./email-outbound-review');
      returnOutboundDraftToInbox(payload.messageId, reason, { payload });
      return { allowed: false, reason };
    }
  }
  return { allowed: true, reason: null };
}

export async function runScheduledWorkflowFire(workflowId: number): Promise<void> {
  const { getWorkflowById } = await import('./email-workflow-store');
  const wf = getWorkflowById(workflowId);
  if (!wf || wf.enabled !== 1) return;

  const syncLog: string[] = [];
  if (wf.schedule_account_id != null) {
    const accId = wf.schedule_account_id;
    try {
      const acc = getEmailAccountById(accId);
      if (!acc) {
        syncLog.push(`sync_skip:no_account:${accId}`);
      } else if ((acc.protocol || 'imap') === 'pop3') {
        const { syncInboxPop3 } = await import('./email-pop3-sync');
        const r = await syncInboxPop3(accId);
        syncLog.push(`pop3_fetched:${r.fetched}`);
      } else {
        const { syncInboxImap } = await import('./email-imap-sync');
        const r = await syncInboxImap(accId);
        syncLog.push(`imap_fetched:${r.fetched}`);
      }
    } catch (e) {
      syncLog.push(`sync_error:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const { executeWorkflowForTrigger } = await import('../workflow/workflow-executor');
  const trigger = (wf.trigger === 'schedule' ? 'schedule' : wf.trigger) as import('../../shared/workflow-types').WorkflowTriggerKind;
  try {
    await executeWorkflowForTrigger({
      workflow: wf,
      trigger,
      direction: 'schedule',
      message: null,
      initialVariables: {
        'schedule.sync_log': syncLog.join('; ') || 'ok',
      },
      eventStrings: {
        subject: '',
        body_text: '',
        snippet: syncLog.join('\n'),
        from_address: '',
        to_address: '',
        cc_address: '',
        combined_text: syncLog.join('\n'),
        has_attachments: 'false',
        attachment_names: '',
        attachment_types: '',
      },
    });
  } catch (e) {
    insertWorkflowRun({
      workflowId,
      messageId: null,
      direction: 'schedule',
      status: 'error',
      logJson: JSON.stringify([`error:${e instanceof Error ? e.message : String(e)}`, ...syncLog]),
    });
  }
}
