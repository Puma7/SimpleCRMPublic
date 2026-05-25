import fs from 'fs';
import path from 'path';
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
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

const MAX_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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

  const html = input.bodyHtml ?? draft.body_html ?? undefined;
  const toJson =
    input.to.trim() ?
      JSON.stringify({
        value: input.to.split(/[,;]+/).map((a) => ({ address: a.trim() })).filter((x) => x.address),
      })
    : null;

  updateComposeDraft(input.draftMessageId, {
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: html ?? null,
    toJson,
    ccJson: input.cc?.trim()
      ? JSON.stringify({
          value: input.cc.split(/[,;]+/).map((a) => ({ address: a.trim() })).filter((x) => x.address),
        })
      : null,
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

  const outboundMessageId = generateOutboundMessageId(acc.email_address);
  const threadHeaders = buildOutboundThreadingHeaders(
    parentForThreading
      ? {
          message_id: parentForThreading.message_id,
          references_header: parentForThreading.references_header,
        }
      : null,
  );

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

  try {
    await sendSmtpForAccount(input.accountId, {
      from: acc.email_address,
      to: input.to,
      cc: input.cc,
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

  try {
    await appendSentToImap({
      accountId: input.accountId,
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
  } catch {
    /* Sent-Ordner optional */
  }

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

  markDraftAsSent(input.draftMessageId);
  return { ok: true };
}
