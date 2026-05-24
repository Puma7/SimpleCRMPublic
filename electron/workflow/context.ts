import type { EmailMessageRow } from '../email/email-store';
import { getCustomerById } from '../sqlite-service';
import type { OutboundDraftPayload } from '../email/email-workflow-engine';
import { attachmentContextFromJson } from '../email/email-workflow-types';
import type { WorkflowContext, WorkflowStringContext } from './types';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

function extractAddressList(json: string | null): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as { value?: { address?: string }[] };
    return parsed?.value?.map((v) => v.address ?? '').filter(Boolean).join(', ') ?? '';
  } catch {
    return '';
  }
}

export function buildStringContextFromMessage(row: EmailMessageRow): WorkflowStringContext {
  const fromAddr = extractAddressList(row.from_json);
  const toAddr = extractAddressList(row.to_json);
  const ccAddr = extractAddressList(row.cc_json);
  const sub = row.subject ?? '';
  const body = row.body_text ?? '';
  const snip = row.snippet ?? '';
  const att = attachmentContextFromJson(row.attachments_json, row.has_attachments);
  return {
    subject: sub,
    body_text: body,
    snippet: snip,
    from_address: fromAddr,
    to_address: toAddr,
    cc_address: ccAddr,
    combined_text: [sub, body, snip, fromAddr, toAddr, ccAddr].join('\n'),
    ...att,
  };
}

export function buildStringContextFromOutbound(payload: OutboundDraftPayload): WorkflowStringContext {
  const htmlPlain = (payload.bodyHtml ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    subject: payload.subject,
    body_text: payload.bodyText,
    snippet: payload.bodyText.slice(0, 500),
    from_address: '',
    to_address: payload.to,
    cc_address: payload.cc ?? '',
    combined_text: [payload.subject, payload.bodyText, htmlPlain, payload.to, payload.cc ?? ''].join('\n'),
    has_attachments: 'false',
    attachment_names: '',
    attachment_types: '',
  };
}

export function createWorkflowContext(input: {
  trigger: WorkflowTriggerKind;
  direction: WorkflowContext['direction'];
  workflowId: number;
  runId: number;
  message?: EmailMessageRow | null;
  outbound?: OutboundDraftPayload | null;
  dryRun?: boolean;
}): WorkflowContext {
  const message = input.message ?? null;
  const outbound = input.outbound ?? null;
  const strings = message
    ? buildStringContextFromMessage(message)
    : outbound
      ? buildStringContextFromOutbound(outbound)
      : {
          subject: '',
          body_text: '',
          snippet: '',
          from_address: '',
          to_address: '',
          cc_address: '',
          combined_text: '',
          has_attachments: 'false',
          attachment_names: '',
          attachment_types: '',
        };

  const vars: Record<string, string | number | boolean | null> = {};
  if (message?.customer_id) {
    const c = getCustomerById(message.customer_id);
    if (c) {
      vars['customer.id'] = c.id;
      vars['customer.name'] = c.name ?? '';
      vars['customer.email'] = c.email ?? '';
    }
  }

  return {
    trigger: input.trigger,
    direction: input.direction,
    messageId: message?.id ?? outbound?.messageId ?? null,
    message,
    outbound,
    workflowId: input.workflowId,
    runId: input.runId,
    dryRun: input.dryRun ?? false,
    variables: vars,
    strings,
    ai: {},
  };
}

export function interpolateTemplate(template: string, ctx: WorkflowContext): string {
  let out = template;
  for (const [k, v] of Object.entries(ctx.strings)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  out = out.replace(/\{\{text\}\}/g, ctx.strings.combined_text ?? '');
  out = out.replace(/\{\{customer\.name\}\}/g, String(ctx.variables['customer.name'] ?? ''));
  out = out.replace(/\{\{customer\.email\}\}/g, String(ctx.variables['customer.email'] ?? ''));
  for (const [k, v] of Object.entries(ctx.variables)) {
    out = out.replace(new RegExp(`\\{\\{${k.replace('.', '\\.')}\\}\\}`, 'g'), String(v ?? ''));
  }
  return out;
}
