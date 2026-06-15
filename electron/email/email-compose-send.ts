import fs from 'fs';
import path from 'path';
import {
  extractEmailAddressesFromRecipientField,
  recipientJsonFromField,
  senderJsonFromMailbox,
  validateRecipientField,
} from '../../shared/email-recipient-parse';
import {
  getEmailAccountById,
  getEmailMessageById,
  markDraftAsSent,
  setMessageDoneLocal,
  setSentImapSyncFailed,
  updateComposeDraft,
} from './email-store';
import {
  getComposeMarkReplyParentDone,
  setComposeMarkReplyParentDone,
} from './compose-reply-done';
import { evaluateOutboundWorkflows } from './email-workflow-engine';
import { buildComposeRfc822, estimateComposeRfc822Bytes } from './mail-rfc822-compose';
import { ensureTicketInSubject, extractKnownTicketFromSubject, getOrCreateThreadForTicket, createTicketCodeForAccount } from './email-ticket';
import {
  buildOutboundThreadingHeaders,
  generateOutboundMessageId,
} from './email-outbound-threading';
import { SYNC_INFO_TABLE } from '../database-schema';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import type { EmailAccountRow } from './email-store';

function resolveRequestReadReceipt(
  acc: EmailAccountRow,
  override?: boolean,
): boolean {
  if (override !== undefined) return override;
  return (acc as { request_read_receipt?: number }).request_read_receipt === 1;
}
import {
  cleanupInlineImageTempFiles,
  extractInlineImagesFromHtml,
} from './email-inline-images';
import { persistLocalComposeAttachments } from './email-message-attachments-store';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

function maxComposeAttachmentBytes(): number {
  const mb = parseInt(getSyncInfo('email_max_attachment_mb') || '25', 10);
  const clamped = Number.isFinite(mb) ? Math.max(1, Math.min(mb, 100)) : 25;
  return clamped * 1024 * 1024;
}

const DEFAULT_IMAP_SENT_APPEND_MAX_BYTES = 20 * 1024 * 1024;

/** IMAP APPEND is optional; skip above this **total message** size (independent of per-file SMTP limit). */
function maxImapSentAppendBytes(): number {
  const mb = parseInt(getSyncInfo('email_imap_sent_append_max_mb') || '0', 10);
  if (Number.isFinite(mb) && mb > 0) {
    return Math.max(1, Math.min(mb, 100)) * 1024 * 1024;
  }
  return DEFAULT_IMAP_SENT_APPEND_MAX_BYTES;
}

function joinWarnings(parts: Array<string | undefined>): string | undefined {
  const merged = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return merged.length > 0 ? merged.join(' ') : undefined;
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
  const warnings: string[] = [];
  let imapSyncFailed = false;

  try {
    persistLocalComposeAttachments(input.draftMessageId, input.attachments);
  } catch (e) {
    console.warn('[email-compose] local sent attachment persistence failed:', e);
    warnings.push(
      e instanceof Error
        ? `E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert, aber Anhänge konnten nicht übernommen werden: ${e.message}`
        : 'E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert, aber Anhänge konnten nicht übernommen werden.',
    );
  }

  markDraftAsSent(input.draftMessageId);
  clearSmtpCommitted(input.draftMessageId);

  const acc = getEmailAccountById(input.accountId);
  if (acc && (acc.protocol || 'imap') !== 'imap') {
    imapSyncFailed = true;
    warnings.push(
      'E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert. POP3-Konten können keine Kopie per IMAP auf dem Server ablegen.',
    );
    setSentImapSyncFailed(input.draftMessageId, imapSyncFailed);
    return { sentAppendWarning: joinWarnings(warnings) };
  }

  const appendInput = {
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
    includeBccInHeaders: false as const,
    requestReadReceipt: input.requestReadReceipt,
  };
  const estimatedBytes = estimateComposeRfc822Bytes({
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });
  const imapLimit = maxImapSentAppendBytes();
  if (estimatedBytes > imapLimit) {
    imapSyncFailed = true;
    const mb = (estimatedBytes / (1024 * 1024)).toFixed(1);
    const limitMb = Math.round(imapLimit / (1024 * 1024));
    warnings.push(
      `E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert. Server-Kopie (IMAP) übersprungen — Nachricht zu groß (ca. ${mb} MB, IMAP-Limit ${limitMb} MB).`,
    );
    setSentImapSyncFailed(input.draftMessageId, imapSyncFailed);
    return { sentAppendWarning: joinWarnings(warnings) };
  }

  let builtRfc822: Buffer | undefined;
  try {
    builtRfc822 = buildComposeRfc822({
      ...appendInput,
      bcc: undefined,
    });
  } catch (e) {
    imapSyncFailed = true;
    console.warn('[email-compose] RFC822 build for IMAP failed:', e);
    warnings.push(
      e instanceof Error
        ? `E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert. Server-Kopie konnte nicht vorbereitet werden: ${e.message}`
        : 'E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert. Server-Kopie konnte nicht vorbereitet werden.',
    );
    setSentImapSyncFailed(input.draftMessageId, imapSyncFailed);
    return { sentAppendWarning: joinWarnings(warnings) };
  }
  if (!builtRfc822) {
    imapSyncFailed = true;
    warnings.push('E-Mail wurde versendet und lokal unter "Gesendet" gespeichert. Server-Kopie konnte nicht vorbereitet werden.');
    setSentImapSyncFailed(input.draftMessageId, imapSyncFailed);
    return { sentAppendWarning: joinWarnings(warnings) };
  }
  const rfc822 = builtRfc822;

  try {
    const { appendSentToImap } = await import('./email-imap-append');
    await appendSentToImap(appendInput, {
      source: rfc822,
      estimatedBytes: Math.max(estimatedBytes, rfc822.length),
    });
  } catch (e) {
    imapSyncFailed = true;
    console.warn('[email-compose] sent IMAP append failed:', e);
    warnings.push(
      e instanceof Error
        ? `E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert. Kopie auf dem Server im Ordner „Gesendet“ fehlgeschlagen: ${e.message}`
        : 'E-Mail wurde versendet und lokal unter „Gesendet“ gespeichert. Kopie auf dem Server im Ordner „Gesendet“ fehlgeschlagen.',
    );
  }

  setSentImapSyncFailed(input.draftMessageId, imapSyncFailed);
  return { sentAppendWarning: joinWarnings(warnings) };
}

/** SMTP already succeeded (crash recovery): skip outbound/attachment gates, finalize only. */
async function finalizeCommittedSmtpDraft(
  input: {
    accountId: number;
    draftMessageId: number;
    subject: string;
    bodyText: string;
    to: string;
    cc?: string;
    bcc?: string;
    inReplyToMessageId?: number | null;
    requestReadReceipt?: boolean;
    attachmentPaths?: string[];
  },
  draft: NonNullable<ReturnType<typeof getEmailMessageById>>,
  html: string | null,
): Promise<
  | { ok: true; warning?: string; recoveredSentAppend: true }
  | { ok: false; error: string }
> {
  const acc = getEmailAccountById(input.accountId);
  if (!acc) return { ok: false, error: 'Konto nicht gefunden' };

  const smtpTo = extractEmailAddressesFromRecipientField(input.to).join(', ');
  const smtpCc = input.cc?.trim()
    ? extractEmailAddressesFromRecipientField(input.cc).join(', ')
    : undefined;
  const smtpBcc = input.bcc?.trim()
    ? extractEmailAddressesFromRecipientField(input.bcc).join(', ')
    : undefined;
  const outboundMessageId =
    draft.message_id?.trim() || generateOutboundMessageId(acc.email_address);
  const subjectBase = draft.subject?.trim() || input.subject.trim() || '(Ohne Betreff)';
  const ticket = draft.ticket_code?.trim();
  const finalSubject = ticket ? ensureTicketInSubject(subjectBase, ticket) : subjectBase;
  const requestReceipt = resolveRequestReadReceipt(acc, input.requestReadReceipt);
  const recoveredAttachments = (input.attachmentPaths ?? [])
    .filter((attachmentPath) => {
      try {
        return fs.statSync(attachmentPath).isFile();
      } catch {
        return false;
      }
    })
    .map((attachmentPath) => ({ filename: path.basename(attachmentPath), path: attachmentPath }));

  const fin = await finalizeSentDraft({
    accountId: input.accountId,
    draftMessageId: input.draftMessageId,
    from: acc.email_address,
    to: smtpTo,
    cc: smtpCc,
    bcc: smtpBcc,
    subject: finalSubject,
    text: input.bodyText,
    html: html || undefined,
    messageId: outboundMessageId,
    inReplyTo: draft.in_reply_to ?? undefined,
    references: draft.references_header ?? undefined,
    attachments: recoveredAttachments,
    requestReadReceipt: requestReceipt,
  });
  if (fin.sentAppendWarning) {
    return { ok: true, warning: fin.sentAppendWarning, recoveredSentAppend: true };
  }
  return { ok: true, recoveredSentAppend: true };
}

function maybeMarkReplyParentDone(
  inReplyToMessageId: number | null | undefined,
  draftMessageId: number,
  markReplyParentDone: boolean | undefined,
): void {
  if (!inReplyToMessageId) return;
  const shouldMark =
    markReplyParentDone !== undefined
      ? markReplyParentDone
      : getComposeMarkReplyParentDone(draftMessageId);
  if (shouldMark) {
    setMessageDoneLocal(inReplyToMessageId, true);
  }
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
  /** When replying: mark original message done (default true). */
  markReplyParentDone?: boolean;
  /** Override account default for Disposition-Notification-To. */
  requestReadReceipt?: boolean;
  pgpEncrypt?: boolean;
  pgpSign?: boolean;
  pgpPassphrase?: string;
  pgpUserId?: string;
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
    let bodyText = input.bodyText;
    const html = input.bodyHtml ?? draft.body_html ?? undefined;
    if (input.pgpEncrypt) {
      const hasAttachments = (input.attachmentPaths?.length ?? 0) > 0;
      const hasHtml = Boolean(html?.trim());
      if (hasAttachments || hasHtml) {
        return {
          ok: false,
          error:
            'PGP-Verschlüsselung ist nur für Klartext ohne Anhänge und ohne HTML verfügbar. Anhänge würden sonst unverschlüsselt mitgesendet.',
        };
      }
    }
    if (input.pgpEncrypt || input.pgpSign) {
      const { prepareOutboundPgpBody } = await import('../pgp/pgp-service');
      const { extractEmailAddressesFromRecipientField } = await import('../../shared/email-recipient-parse');
      const recipients = [
        ...extractEmailAddressesFromRecipientField(input.to),
        ...(input.cc ? extractEmailAddressesFromRecipientField(input.cc) : []),
        ...(input.bcc ? extractEmailAddressesFromRecipientField(input.bcc) : []),
      ];
      const prepared = await prepareOutboundPgpBody({
        bodyText,
        recipientEmails: recipients,
        userId: input.pgpUserId ?? 'local-owner',
        encrypt: input.pgpEncrypt,
        sign: input.pgpSign,
        passphrase: input.pgpPassphrase,
      });
      bodyText = prepared.bodyText;
    }
    const toJson = recipientJsonFromField(input.to);
    const ccJson = input.cc?.trim() ? recipientJsonFromField(input.cc) : null;
    const bccJson = input.bcc?.trim() ? recipientJsonFromField(input.bcc) : null;
    const accForFrom = getEmailAccountById(input.accountId);
    const fromJson = accForFrom
      ? senderJsonFromMailbox(accForFrom.email_address, accForFrom.display_name)
      : null;

    updateComposeDraft(input.draftMessageId, {
      subject: input.subject,
      bodyText,
      bodyHtml: html ?? null,
      toJson,
      ccJson,
      bccJson,
      fromJson,
      draftAttachmentPaths: input.attachmentPaths,
    });

    const { clearOutboundHoldForResend } = await import('./email-outbound-review');
    clearOutboundHoldForResend(input.draftMessageId);

    if (isSmtpCommitted(input.draftMessageId)) {
      const recovered = await finalizeCommittedSmtpDraft(input, draft, html ?? null);
      maybeMarkReplyParentDone(
        input.inReplyToMessageId,
        input.draftMessageId,
        input.markReplyParentDone,
      );
      return recovered;
    }

    const outbound = await evaluateOutboundWorkflows({
      messageId: input.draftMessageId,
      accountId: input.accountId,
      subject: input.subject,
      bodyText,
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
      const fromSubj = extractKnownTicketFromSubject(input.subject);
      if (fromSubj) {
        ticketCode = fromSubj;
      } else {
        ticketCode = createTicketCodeForAccount(input.accountId);
      }
    }
    if (!threadId && ticketCode) {
      threadId = getOrCreateThreadForTicket(ticketCode, input.accountId);
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
        bodyText,
        input.pgpEncrypt ? null : html ?? null,
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

    const requestReceipt = resolveRequestReadReceipt(acc, input.requestReadReceipt);

    if (input.markReplyParentDone !== undefined) {
      setComposeMarkReplyParentDone(input.draftMessageId, input.markReplyParentDone);
    }

    try {
      const { sendSmtpForAccount } = await import('./email-smtp');
      await sendSmtpForAccount(input.accountId, {
        from: acc.email_address,
        to: smtpTo,
        cc: smtpCc,
        bcc: smtpBcc,
        subject: finalSubject,
        text: bodyText,
        html: input.pgpEncrypt ? undefined : htmlOut,
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
      text: bodyText,
      html: input.pgpEncrypt ? undefined : htmlOut || undefined,
      messageId: outboundMessageId,
      inReplyTo: threadHeaders.inReplyTo,
      references: threadHeaders.references,
      attachments: sentAppendAttachments,
      requestReadReceipt: requestReceipt,
    });

    maybeMarkReplyParentDone(
      input.inReplyToMessageId,
      input.draftMessageId,
      input.markReplyParentDone,
    );
    return fin.sentAppendWarning ? { ok: true, warning: fin.sentAppendWarning } : { ok: true };
  } finally {
    cleanupInlineImageTempFiles(inlineTempPaths);
    releaseSendingLock(input.draftMessageId);
  }
}
