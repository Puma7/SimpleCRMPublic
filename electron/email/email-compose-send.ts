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
import { SYNC_INFO_TABLE } from '../database-schema';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  cleanupInlineImageTempFiles,
  extractInlineImagesFromHtml,
} from './email-inline-images';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

function maxComposeAttachmentBytes(): number {
  const mb = parseInt(getSyncInfo('email_max_attachment_mb') || '25', 10);
  const clamped = Number.isFinite(mb) ? Math.max(1, Math.min(mb, 100)) : 25;
  return clamped * 1024 * 1024;
}

function smtpCommittedKey(draftMessageId: number): string {
  return `email_compose_smtp_ok:${draftMessageId}`;
}

function sendingInProgressKey(draftMessageId: number): string {
  return `email_compose_sending:${draftMessageId}`;
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

function tryAcquireSendingLock(draftMessageId: number): boolean {
  const key = sendingInProgressKey(draftMessageId);
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${SYNC_INFO_TABLE} (key, value, lastUpdated) VALUES (?, '1', datetime('now'))`,
    )
    .run(key);
  return r.changes === 1;
}

function releaseSendingLock(draftMessageId: number): void {
  getDb().prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = ?`).run(sendingInProgressKey(draftMessageId));
}

/** Clear compose send locks left after crash (call on app/DB init). */
export function clearStaleComposeSendingLocks(): void {
  getDb()
    .prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key LIKE 'email_compose_sending:%'`)
    .run();
}

/** After crash: SMTP succeeded but draft was not finalized to sent. */
export function getComposeDraftRecoveryState(draftMessageId: number): {
  smtpCommitted: boolean;
  needsResendFinalize: boolean;
} {
  const draft = getEmailMessageById(draftMessageId);
  const smtpCommitted = isSmtpCommitted(draftMessageId);
  const needsResendFinalize = Boolean(
    smtpCommitted && draft && draft.uid < 0 && draft.folder_kind === 'draft',
  );
  return { smtpCommitted, needsResendFinalize };
}

async function finalizeSentDraft(input: {
  accountId: number;
  draftMessageId: number;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  attachments?: { filename: string; path: string; cid?: string }[];
  requestReadReceipt?: boolean;
}): Promise<{ sentAppendWarning?: string }> {
  let sentAppendWarning: string | undefined;
  const acc = getEmailAccountById(input.accountId);
  if (acc && (acc.protocol || 'imap') !== 'imap') {
    sentAppendWarning =
      'E-Mail wurde versendet. POP3-Konten können keine Kopie per IMAP in „Gesendet“ ablegen.';
  } else {
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
      attachments: input.attachments,
      includeBccInHeaders: false,
      requestReadReceipt: input.requestReadReceipt,
    });
  } catch (e) {
    sentAppendWarning =
      e instanceof Error
        ? `E-Mail wurde versendet, konnte aber nicht in den Server-Ordner „Gesendet“ kopiert werden: ${e.message}`
        : 'E-Mail wurde versendet, konnte aber nicht in den Server-Ordner „Gesendet“ kopiert werden.';
  }
  }
  markDraftAsSent(input.draftMessageId);
  clearSmtpCommitted(input.draftMessageId);
  return { sentAppendWarning };
}

export async function sendComposeDraft(input: {
  accountId: number;
  draftMessageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  to: string;
  cc?: string;
  bcc?: string;
  inReplyToMessageId?: number | null;
  attachmentPaths?: string[];
}): Promise<
  | { ok: true; warning?: string; recoveredSentAppend?: boolean }
  | { ok: false; error: string; workflowRunId?: number | null }
> {
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
  if (input.bcc?.trim()) {
    const bccCheck = validateRecipientField(input.bcc, 'Bcc');
    if (!bccCheck.ok) {
      return { ok: false, error: bccCheck.error };
    }
  }

  if (!tryAcquireSendingLock(input.draftMessageId)) {
    return { ok: false, error: 'Versand läuft bereits für diesen Entwurf.' };
  }

  const inlineTempPaths: string[] = [];
  try {
    const html = input.bodyHtml ?? draft.body_html ?? undefined;
    const toJson = recipientJsonFromField(input.to);
    const ccJson = input.cc?.trim() ? recipientJsonFromField(input.cc) : null;
    const bccJson = input.bcc?.trim() ? recipientJsonFromField(input.bcc) : null;

    updateComposeDraft(input.draftMessageId, {
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: html ?? null,
      toJson,
      ccJson,
      bccJson,
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
      bcc: input.bcc,
      inReplyToMessageId: input.inReplyToMessageId,
      attachmentCount: input.attachmentPaths?.length ?? 0,
      attachmentPaths: input.attachmentPaths,
    });
    if (!outbound.allowed) {
      return {
        ok: false,
        error: outbound.reason || 'Outbound blockiert',
        workflowRunId: outbound.workflowRunId ?? null,
      };
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

    const smtpAttachments: { filename: string; path: string }[] = [];
    for (const p of input.attachmentPaths ?? []) {
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
      const maxBytes = maxComposeAttachmentBytes();
      if (st.size > maxBytes) {
        return {
          ok: false,
          error: `Anhang zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB): ${path.basename(p)}`,
        };
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
    const smtpBcc = input.bcc?.trim()
      ? extractEmailAddressesFromRecipientField(input.bcc).join(', ')
      : undefined;

    let htmlOut = html || undefined;
    const inlineAtt: { filename: string; path: string; cid: string }[] = [];
    if (htmlOut) {
      const extracted = extractInlineImagesFromHtml(htmlOut);
      htmlOut = extracted.html;
      inlineAtt.push(...extracted.attachments);
      inlineTempPaths.push(...extracted.attachments.map((a) => a.path));
    }
    const allAttachments = [
      ...smtpAttachments,
      ...inlineAtt.map((a) => ({ filename: a.filename, path: a.path, cid: a.cid })),
    ];
    const sentAppendAttachments = allAttachments.map((a) => ({
      filename: a.filename,
      path: a.path,
      cid: 'cid' in a && typeof a.cid === 'string' ? a.cid : undefined,
    }));

    const requestReceipt =
      (acc as { request_read_receipt?: number }).request_read_receipt === 1;

    if (isSmtpCommitted(input.draftMessageId)) {
      const fin = await finalizeSentDraft({
        accountId: input.accountId,
        draftMessageId: input.draftMessageId,
        from: acc.email_address,
        to: smtpTo,
        cc: smtpCc,
        bcc: smtpBcc,
        subject: finalSubject,
        text: input.bodyText,
        html: htmlOut || undefined,
        messageId: outboundMessageId,
        inReplyTo: threadHeaders.inReplyTo,
        references: threadHeaders.references,
        attachments: sentAppendAttachments,
        requestReadReceipt: requestReceipt,
      });
      if (fin.sentAppendWarning) {
        return { ok: true, warning: fin.sentAppendWarning };
      }
      return { ok: true, recoveredSentAppend: true };
    }

    try {
      await sendSmtpForAccount(input.accountId, {
        from: acc.email_address,
        to: smtpTo,
        cc: smtpCc,
        bcc: smtpBcc,
        subject: finalSubject,
        text: input.bodyText,
        html: htmlOut,
        attachments: allAttachments.length > 0 ? allAttachments : undefined,
        messageId: outboundMessageId,
        inReplyTo: threadHeaders.inReplyTo,
        references: threadHeaders.references,
        requestReadReceipt: requestReceipt,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    markSmtpCommitted(input.draftMessageId);

    const fin = await finalizeSentDraft({
      accountId: input.accountId,
      draftMessageId: input.draftMessageId,
      from: acc.email_address,
      to: smtpTo,
      cc: smtpCc,
      bcc: smtpBcc,
      subject: finalSubject,
      text: input.bodyText,
      html: htmlOut || undefined,
      messageId: outboundMessageId,
      inReplyTo: threadHeaders.inReplyTo,
      references: threadHeaders.references,
      attachments: sentAppendAttachments,
      requestReadReceipt: requestReceipt,
    });

    return fin.sentAppendWarning ? { ok: true, warning: fin.sentAppendWarning } : { ok: true };
  } finally {
    cleanupInlineImageTempFiles(inlineTempPaths);
    releaseSendingLock(input.draftMessageId);
  }
}
