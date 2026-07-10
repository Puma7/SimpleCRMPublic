import path from 'path';
import type { EmailMessageRow } from '../email/email-store';
import { getCustomerById } from '../sqlite-service';
import type { OutboundDraftPayload } from '../email/email-workflow-engine';
import { addressesFromRecipientJson } from '../email/email-parse-utils';
import { attachmentContextFromJson } from '../email/email-workflow-types';
import { securityVariablesFromRow } from '../email/mail-security-store';
import type { WorkflowContext, WorkflowStringContext } from './types';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

/** Metadata-only context for GDPR-conscious KI nodes (no body_text). */
export function buildMetadataContextFromMessage(row: EmailMessageRow): WorkflowStringContext {
  const fromAddr = addressesFromRecipientJson(row.from_json);
  const toAddr = addressesFromRecipientJson(row.to_json);
  const ccAddr = addressesFromRecipientJson(row.cc_json);
  const sub = row.subject ?? '';
  const snip = row.snippet ?? '';
  const att = attachmentContextFromJson(row.attachments_json, row.has_attachments);
  const metaCombined = [sub, snip, fromAddr, toAddr, ccAddr].join('\n');
  return {
    subject: sub,
    body_text: '',
    snippet: snip,
    from_address: fromAddr,
    to_address: toAddr,
    cc_address: ccAddr,
    combined_text: metaCombined,
    ...att,
  };
}

export function buildStringContextFromMessage(row: EmailMessageRow): WorkflowStringContext {
  const fromAddr = addressesFromRecipientJson(row.from_json);
  const toAddr = addressesFromRecipientJson(row.to_json);
  const ccAddr = addressesFromRecipientJson(row.cc_json);
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
  const attCount = payload.attachmentCount ?? 0;
  const attNames =
    payload.attachmentPaths?.map((p) => path.basename(p)).filter(Boolean).join('\n') ?? '';
  return {
    subject: payload.subject,
    body_text: payload.bodyText,
    snippet: payload.bodyText.slice(0, 500),
    from_address: '',
    to_address: payload.to,
    cc_address: payload.cc ?? '',
    combined_text: [
      payload.subject,
      payload.bodyText,
      htmlPlain,
      payload.to,
      payload.cc ?? '',
      attNames,
      `attachment_count:${attCount}`,
    ].join('\n'),
    has_attachments: attCount > 0 ? 'true' : 'false',
    attachment_names: attNames,
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
  previewOutbound?: boolean;
  eventStrings?: WorkflowStringContext;
  eventVariables?: Record<string, string | number | boolean | null>;
  initialVariables?: Record<string, string | number | boolean | null>;
}): WorkflowContext {
  const message = input.message ?? null;
  const outbound = input.outbound ?? null;
  const strings =
    input.eventStrings ??
    (message
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
          });

  const vars: Record<string, string | number | boolean | null> = {
    ...(input.initialVariables ?? {}),
    ...(input.eventVariables ?? {}),
  };
  if (message) {
    Object.assign(vars, securityVariablesFromRow(message));
  }
  if (message?.customer_id) {
    const c = getCustomerById(message.customer_id);
    if (c) {
      vars['customer.id'] = c.id;
      vars['customer.name'] = c.name ?? '';
      vars['customer.email'] = c.email ?? '';
    }
  }
  if (outbound) {
    vars['outbound.attachment_count'] = outbound.attachmentCount ?? 0;
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
    previewOutbound: input.previewOutbound === true,
    variables: vars,
    strings,
    ai: {},
  };
}

// Single-Pass: kein Re-Scan bereits eingesetzter Werte, Keys mit mehreren
// Punkten werden exakt aufgelöst. Unbekannte Platzhalter bleiben stehen.
// Key = alles außer geschweiften Klammern (Variablennamen dürfen Umlaute,
// Leerzeichen etc. enthalten — logic.set_variable erlaubt freie Namen).
export function interpolateTemplate(template: string, ctx: WorkflowContext): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    if (key === 'text') return ctx.strings.combined_text ?? '';
    if (Object.prototype.hasOwnProperty.call(ctx.strings, key)) {
      return (ctx.strings as Record<string, string>)[key] ?? '';
    }
    if (Object.prototype.hasOwnProperty.call(ctx.variables, key)) {
      return String(ctx.variables[key] ?? '');
    }
    return match;
  });
}
