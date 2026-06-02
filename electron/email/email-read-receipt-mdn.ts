import { getEmailAccountById, getEmailMessageById } from './email-store';
import { sendSmtpForAccount } from './email-smtp';
import { parseDispositionNotificationTo, logReadReceiptAction } from './email-read-receipt';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { generateOutboundMessageId } from './email-outbound-threading';

function extractEmailAddress(dnt: string): string | null {
  const m = dnt.match(/<([^>]+)>/) ?? dnt.match(/([\w.+-]+@[\w.-]+\.\w+)/);
  return m ? m[1]!.trim() : null;
}

/**
 * Send RFC 3798-style read receipt (MDN) for an inbound message.
 */
export async function sendReadReceiptMdn(messageId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = getEmailMessageById(messageId);
  if (!row) return { ok: false, error: 'Nachricht nicht gefunden' };
  const dnt = parseDispositionNotificationTo(row.raw_headers ?? null);
  if (!dnt) return { ok: false, error: 'Keine MDN-Anfrage in dieser Nachricht' };

  const recipient = extractEmailAddress(dnt);
  if (!recipient) return { ok: false, error: 'MDN-Empfänger nicht parsebar' };

  const acc = getEmailAccountById(row.account_id);
  if (!acc) return { ok: false, error: 'Konto nicht gefunden' };

  const from = `${acc.display_name} <${acc.email_address}>`;
  const originalMid = row.message_id?.trim() || '';
  const body = [
    'Dies ist eine Lesebestätigung für Ihre Nachricht.',
    '',
    originalMid ? `Original-Message-ID: ${originalMid}` : '',
    `Gelesen am: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const outboundMid = generateOutboundMessageId(acc.email_address);

  await sendSmtpForAccount(row.account_id, {
    from,
    to: recipient,
    subject: `Gelesen: ${row.subject ?? '(ohne Betreff)'}`,
    text: body,
    messageId: outboundMid,
    inReplyTo: originalMid ? (originalMid.startsWith('<') ? originalMid : `<${originalMid}>`) : undefined,
    headers: {
      'Content-Type': 'multipart/report; report-type=disposition-notification',
    },
  });

  const db = getDb();
  if (db) {
    logReadReceiptAction(db, messageId, 'sent_back', recipient);
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET read_receipt_requested = 0 WHERE id = ?`).run(messageId);
  }

  return { ok: true };
}
