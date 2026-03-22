import { getEmailAccountById, getEmailMessageById, markDraftAsSent } from './email-store';
import { evaluateOutboundWorkflows } from './email-workflow-engine';
import { sendSmtpForAccount } from './email-smtp';
import { appendSentToImap } from './email-imap-append';
import { ensureTicketInSubject, extractTicketFromSubject, generateTicketCode, getOrCreateThreadForTicket } from './email-ticket';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

export async function sendComposeDraft(input: {
  accountId: number;
  draftMessageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  to: string;
  cc?: string;
  inReplyToMessageId?: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const draft = getEmailMessageById(input.draftMessageId);
  if (!draft || draft.uid >= 0) {
    return { ok: false, error: 'Ungültiger Entwurf' };
  }

  const outbound = evaluateOutboundWorkflows({
    messageId: input.draftMessageId,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml ?? draft.body_html ?? undefined,
    to: input.to,
    cc: input.cc,
  });
  if (!outbound.allowed) {
    return { ok: false, error: outbound.reason || 'Outbound blockiert' };
  }

  let ticketCode: string | null = null;
  let threadId: string | null = null;
  if (input.inReplyToMessageId) {
    const parent = getEmailMessageById(input.inReplyToMessageId);
    if (parent?.ticket_code) {
      ticketCode = parent.ticket_code;
      threadId = parent.thread_id;
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

  const html = input.bodyHtml ?? draft.body_html ?? undefined;
  try {
    await sendSmtpForAccount(input.accountId, {
      from: acc.email_address,
      to: input.to,
      cc: input.cc,
      subject: finalSubject,
      text: input.bodyText,
      html: html || undefined,
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
    });
  } catch {
    /* Sent-Ordner optional */
  }

  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET subject = ?, body_text = ?, body_html = COALESCE(?, body_html), ticket_code = ?, thread_id = ? WHERE id = ?`,
    )
    .run(finalSubject, input.bodyText, html ?? null, ticketCode, threadId, input.draftMessageId);

  markDraftAsSent(input.draftMessageId);
  return { ok: true };
}
