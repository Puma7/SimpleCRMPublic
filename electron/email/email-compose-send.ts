import fs from 'fs';
import path from 'path';
import {
  extractEmailAddressesFromRecipientField,
  recipientJsonFromField,
  validateRecipientField,
} from '../../shared/email-recipient-parse';
import {
  getEmailAccountById,
  getEmailMessageById,
  markDraftAsSent,
  updateComposeDraft,
} from './email-store';
import { evaluateOutboundWorkflows } from './email-workflow-engine';
import { sendSmtpForAccount } from './email-smtp';
import { appendSentToImap } from './email-imap-append';
import { ensureTicketInSubject, extractTicketFromSubject, generateTicketCode, getOrCreateThreadForTicket } from './email-ticket';
import {
  buildOutboundThreadingHeaders,
  generateOutboundMessageId,
} from './email-outbound-threading';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

const MAX_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function smtpCommittedKey(draftMessageId: number): string {
  return `email_compose_smtp_ok:${draftMessageId}`;
}

function isSmtpCommitted(draftMessageId: number): boolean {
  return getSyncInfo(smtpCommittedKey(draftMessageId)) === '1';
}

function markSmtpCommitted(draftMessageId: number): void {
  setSyncInfo(smtpCommittedKey(draftMessageId), '1');
}

function clearSmtpCommitted(draftMessageId: number): void {
  setSyncInfo(smtpCommittedKey(draftMessageId), '');
}

async function finalizeSentDraft(input: {
  accountId: number;
  draftMessageId: number;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
}): Promise<void> {
  try {
    await appendSentToImap({
      accountId: input.accountId,
      from: input.from,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      messageId: input.messageId,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
  } catch {
    /* Sent-Ordner optional */
  }
  markDraftAsSent(input.draftMessageId);
  clearSmtpCommitted(input.draftMessageId);
}

export async function sendComposeDraft(input: {
  accountId: number;
  draftMessageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  to: string;
  cc?: string;
  inReplyToMessageId?: number | null;
  attachmentPaths?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const draft = getEmailMessageById(input.draftMessageId);
  if (!draft || draft.uid >= 0) {
    return { ok: false, error: 'Ungültiger Entwurf' };
  }
  if (draft.folder_kind === 'sent') {
    return { ok: true };
  }
  if (draft.account_id !== input.accountId) {
    return { ok: false, error: 'Entwurf gehört zu einem anderen Konto' };
  }

  const toCheck = validateRecipientField(input.to, 'An');
  if (!toCheck.ok) {
    return { ok: false, error: toCheck.error };
  }
  if (input.cc?.trim()) {
    const ccCheck = validateRecipientField(input.cc, 'Cc');
    if (!ccCheck.ok) {
      return { ok: false, error: ccCheck.error };
    }
  }

  const html = input.bodyHtml ?? draft.body_html ?? undefined;
  const toJson = recipientJsonFromField(input.to);
  const ccJson = input.cc?.trim() ? recipientJsonFromField(input.cc) : null;

  updateComposeDraft(input.draftMessageId, {
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: html ?? null,
    toJson,
    ccJson,
  });

  const { clearOutboundHoldForResend } = await import('./email-outbound-review');
  clearOutboundHoldForResend(input.draftMessageId);

  const outbound = await evaluateOutboundWorkflows({
    messageId: input.draftMessageId,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: html ?? undefined,
    to: input.to,
    cc: input.cc,
    inReplyToMessageId: input.inReplyToMessageId,
    attachmentCount: input.attachmentPaths?.length ?? 0,
  });
  if (!outbound.allowed) {
    return { ok: false, error: outbound.reason || 'Outbound blockiert' };
  }

  let ticketCode: string | null = null;
  let threadId: string | null = null;
  let parentForThreading: ReturnType<typeof getEmailMessageById> | null = null;
  if (input.inReplyToMessageId) {
    parentForThreading = getEmailMessageById(input.inReplyToMessageId);
    if (parentForThreading?.ticket_code) {
      ticketCode = parentForThreading.ticket_code;
      threadId = parentForThreading.thread_id;
    }
  }
  if (!ticketCode) {
    const fromSubj = extractTicketFromSubject(input.subject);
    if (fromSubj) {
      ticketCode = fromSubj;
    } else {
      ticketCode = generateTicketCode();
    }
  }
  if (!threadId && ticketCode) {
    threadId = getOrCreateThreadForTicket(ticketCode);
  }

  const finalSubject = ensureTicketInSubject(input.subject.trim() || '(Ohne Betreff)', ticketCode);

  const acc = getEmailAccountById(input.accountId);
  if (!acc) return { ok: false, error: 'Konto nicht gefunden' };

  const threadHeaders = buildOutboundThreadingHeaders(
    parentForThreading
      ? {
          message_id: parentForThreading.message_id,
          references_header: parentForThreading.references_header,
        }
      : null,
  );

  const outboundMessageId =
    draft.message_id?.trim() || generateOutboundMessageId(acc.email_address);

  const refsHeader = threadHeaders.references ?? null;
  const inReplyHeader = threadHeaders.inReplyTo ?? null;
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET subject = ?, body_text = ?, body_html = COALESCE(?, body_html), ticket_code = ?, thread_id = ?, message_id = ?, in_reply_to = ?, references_header = ? WHERE id = ?`,
    )
    .run(
      finalSubject,
      input.bodyText,
      html ?? null,
      ticketCode,
      threadId,
      outboundMessageId,
      inReplyHeader,
      refsHeader,
      input.draftMessageId,
    );

  if (isSmtpCommitted(input.draftMessageId)) {
    await finalizeSentDraft({
      accountId: input.accountId,
      draftMessageId: input.draftMessageId,
      from: acc.email_address,
      to: input.to,
      cc: input.cc,
      subject: finalSubject,
      text: input.bodyText,
      html: html || undefined,
      messageId: outboundMessageId,
      inReplyTo: threadHeaders.inReplyTo,
      references: threadHeaders.references,
    });
    return { ok: true };
  }

  const smtpAttachments: { filename: string; path: string }[] = [];
  for (const p of input.attachmentPaths ?? []) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      if (st.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
        return { ok: false, error: `Anhang zu groß (max. 25 MB): ${path.basename(p)}` };
      }
      smtpAttachments.push({ filename: path.basename(p), path: p });
    } catch {
      return { ok: false, error: `Anhang nicht lesbar: ${path.basename(p)}` };
    }
  }

  const smtpTo = extractEmailAddressesFromRecipientField(input.to).join(', ');
  const smtpCc = input.cc?.trim()
    ? extractEmailAddressesFromRecipientField(input.cc).join(', ')
    : undefined;

  try {
    await sendSmtpForAccount(input.accountId, {
      from: acc.email_address,
      to: smtpTo,
      cc: smtpCc,
      subject: finalSubject,
      text: input.bodyText,
      html: html || undefined,
      attachments: smtpAttachments.length > 0 ? smtpAttachments : undefined,
      messageId: outboundMessageId,
      inReplyTo: threadHeaders.inReplyTo,
      references: threadHeaders.references,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  markSmtpCommitted(input.draftMessageId);

  await finalizeSentDraft({
    accountId: input.accountId,
    draftMessageId: input.draftMessageId,
    from: acc.email_address,
    to: smtpTo,
    cc: smtpCc,
    subject: finalSubject,
    text: input.bodyText,
    html: html || undefined,
    messageId: outboundMessageId,
    inReplyTo: threadHeaders.inReplyTo,
    references: threadHeaders.references,
  });

  return { ok: true };
}
