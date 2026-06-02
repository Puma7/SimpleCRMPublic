import { getEmailAccountById, getEmailMessageById } from './email-store';
import { sendSmtpForAccount } from './email-smtp';
import { parseDispositionNotificationTo, logReadReceiptAction } from './email-read-receipt';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { generateOutboundMessageId } from './email-outbound-threading';
import { evaluateOutboundWorkflows } from './email-workflow-engine';

function extractEmailAddress(dnt: string): string | null {
  const m = dnt.match(/<([^>]+)>/) ?? dnt.match(/([\w.+-]+@[\w.-]+\.\w+)/);
  return m ? m[1]!.trim().toLowerCase() : null;
}

function senderEmailFromJson(fromJson: string | null): string {
  if (!fromJson) return '';
  try {
    const p = JSON.parse(fromJson) as { value?: { address?: string }[] };
    return (p.value?.[0]?.address ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function dispositionMatchesSender(dnt: string, fromJson: string | null): boolean {
  const dntAddr = extractEmailAddress(dnt);
  const fromAddr = senderEmailFromJson(fromJson);
  if (!dntAddr || !fromAddr) return false;
  return dntAddr === fromAddr;
}

/**
 * Send RFC 3798-style read receipt (MDN) for an inbound message.
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

  if (!dispositionMatchesSender(dnt, row.from_json)) {
    return {
      ok: false,
      error: 'MDN-Empfänger stimmt nicht mit dem Absender überein (RFC 8098)',
    };
  }

  const recipient = extractEmailAddress(dnt);
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
    headers: {
      'Content-Type': 'multipart/report; report-type=disposition-notification',
      'Auto-Submitted': 'auto-replied',
    },
  });

  const db = getDb();
  if (db) {
    logReadReceiptAction(db, messageId, 'sent_back', recipient);
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET read_receipt_requested = 0 WHERE id = ?`).run(messageId);
  }

  return { ok: true };
}
