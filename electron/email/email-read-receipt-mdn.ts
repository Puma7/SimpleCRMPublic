import { getEmailAccountById, getEmailMessageById } from './email-store';
import { sendSmtpForAccount } from './email-smtp';
import { parseDispositionNotificationTo, logReadReceiptAction } from './email-read-receipt';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { generateOutboundMessageId } from './email-outbound-threading';
import { evaluateOutboundWorkflows } from './email-workflow-engine';
import { encodeMailboxListHeader, encodeRfc2047 } from './mail-rfc822-compose';
import { randomBytes } from 'crypto';
import {
  dispositionNotificationMatchesSender,
  extractDispositionNotificationEmail,
} from '../../packages/core/src/email';

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function base64Lines(text: string): string {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * RFC 8098 MDN: multipart/report; report-type=disposition-notification with a
 * human-readable text/plain part and the machine-readable
 * message/disposition-notification part.
 */
export function buildReadReceiptMdnRfc822(input: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  humanText: string;
  finalRecipient: string;
  originalMessageId?: string;
  date?: Date;
}): Buffer {
  const boundary = `mdn_${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${encodeMailboxListHeader(input.from)}`,
    `To: ${encodeMailboxListHeader(input.to)}`,
    `Subject: ${encodeRfc2047(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${headerValue(input.messageId)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${headerValue(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${headerValue(input.references)}`] : []),
    'Auto-Submitted: auto-replied',
    'MIME-Version: 1.0',
    `Content-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"`,
  ];
  const notification = [
    'Reporting-UA: SimpleCRM',
    `Final-Recipient: rfc822;${headerValue(input.finalRecipient)}`,
    ...(input.originalMessageId ? [`Original-Message-ID: ${headerValue(input.originalMessageId)}`] : []),
    'Disposition: manual-action/MDN-sent-manually; displayed',
  ];
  const lines = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(input.humanText),
    `--${boundary}`,
    'Content-Type: message/disposition-notification',
    'Content-Transfer-Encoding: 7bit',
    '',
    ...notification,
    '',
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/**
 * Send an RFC 8098 read receipt (MDN) for an inbound message.
 */
export async function sendReadReceiptMdn(messageId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = getEmailMessageById(messageId);
  if (!row) return { ok: false, error: 'Nachricht nicht gefunden' };

  if (row.is_spam === 1) {
    return { ok: false, error: 'Lesebestätigung für Spam-Nachrichten nicht erlaubt' };
  }
  if (row.folder_kind === 'trash' || row.soft_deleted === 1) {
    return { ok: false, error: 'Lesebestätigung für gelöschte Nachrichten nicht erlaubt' };
  }

  const dnt = parseDispositionNotificationTo(row.raw_headers ?? null);
  if (!dnt) return { ok: false, error: 'Keine MDN-Anfrage in dieser Nachricht' };

  if (!dispositionNotificationMatchesSender(dnt, row.from_json)) {
    return {
      ok: false,
      error: 'MDN-Empfänger stimmt nicht mit dem Absender überein (RFC 8098)',
    };
  }

  const recipient = extractDispositionNotificationEmail(dnt);
  if (!recipient) return { ok: false, error: 'MDN-Empfänger nicht parsebar' };

  const acc = getEmailAccountById(row.account_id);
  if (!acc) return { ok: false, error: 'Konto nicht gefunden' };

  const subject = `Gelesen: ${row.subject ?? '(ohne Betreff)'}`;
  const body = [
    'Dies ist eine Lesebestätigung für Ihre Nachricht.',
    '',
    row.message_id?.trim() ? `Original-Message-ID: ${row.message_id.trim()}` : '',
    `Gelesen am: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const outbound = await evaluateOutboundWorkflows(
    {
      messageId: row.id,
      accountId: row.account_id,
      subject,
      bodyText: body,
      to: recipient,
    },
    { sideEffects: 'none' },
  );
  if (!outbound.allowed) {
    return { ok: false, error: outbound.reason || 'MDN durch Workflow blockiert' };
  }

  const from = `${acc.display_name} <${acc.email_address}>`;
  const originalMid = row.message_id?.trim() || '';
  const outboundMid = generateOutboundMessageId(acc.email_address);
  const inReply = originalMid ? (originalMid.startsWith('<') ? originalMid : `<${originalMid}>`) : undefined;
  const references = row.references_header?.trim()
    ? `${row.references_header.trim()} ${inReply ?? ''}`.trim()
    : inReply;

  await sendSmtpForAccount(row.account_id, {
    from,
    to: recipient,
    subject,
    text: body,
    messageId: outboundMid,
    inReplyTo: inReply,
    references,
    raw: buildReadReceiptMdnRfc822({
      from,
      to: recipient,
      subject,
      messageId: outboundMid,
      inReplyTo: inReply,
      references,
      humanText: body,
      finalRecipient: acc.email_address,
      originalMessageId: inReply,
    }),
  });

  const db = getDb();
  if (db) {
    logReadReceiptAction(db, messageId, 'sent_back', recipient);
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET read_receipt_requested = 0 WHERE id = ?`).run(messageId);
  }

  return { ok: true };
}
