import { getDb } from '../sqlite-service';
import { EMAIL_ACCOUNTS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getEmailAccountById, getEmailMessageById } from './email-store';
import { sendSmtpForAccount } from './email-smtp';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';

const DEDUP_TABLE = 'email_vacation_reply_dedup';

export function ensureVacationDedupTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS ${DEDUP_TABLE} (
      account_id INTEGER NOT NULL,
      sender_email TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (account_id, sender_email)
    );
  `);
}

function extractSenderEmail(fromJson: string | null): string {
  const field = recipientFieldFromJson(fromJson);
  const m = field.match(/[\w.+-]+@[\w.-]+\.\w+/i);
  return m?.[0]?.toLowerCase() ?? '';
}

function wasVacationReplySentRecently(accountId: number, sender: string): boolean {
  ensureVacationDedupTable();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = getDb()
    .prepare(
      `SELECT 1 FROM ${DEDUP_TABLE} WHERE account_id = ? AND sender_email = ? AND sent_at >= ?`,
    )
    .get(accountId, sender, dayAgo);
  return Boolean(row);
}

function markVacationReplySent(accountId: number, sender: string): void {
  ensureVacationDedupTable();
  getDb()
    .prepare(
      `INSERT INTO ${DEDUP_TABLE} (account_id, sender_email, sent_at) VALUES (?, ?, ?)
       ON CONFLICT(account_id, sender_email) DO UPDATE SET sent_at = excluded.sent_at`,
    )
    .run(accountId, sender, new Date().toISOString());
}

/** Best-effort vacation auto-reply for inbound mail (anti-loop aware). */
export async function maybeSendVacationAutoReply(
  messageId: number,
  preloadedRow?: import('./email-store').EmailMessageRow,
): Promise<void> {
  const row = preloadedRow ?? getEmailMessageById(messageId);
  if (!row || (row.uid < 0 && !row.pop3_uidl)) return;
  const acc = getEmailAccountById(row.account_id);
  if (!acc) return;
  const enabled = (acc as { vacation_enabled?: number }).vacation_enabled === 1;
  if (!enabled) return;

  const headers = (row.raw_headers ?? '').toLowerCase();
  if (
    headers.includes('auto-submitted:') ||
    headers.includes('x-auto-response-suppress:') ||
    headers.includes('precedence: bulk') ||
    headers.includes('precedence: junk')
  ) {
    return;
  }

  const sender = extractSenderEmail(row.from_json);
  if (!sender || sender === acc.email_address.toLowerCase()) return;
  if (wasVacationReplySentRecently(acc.id, sender)) return;

  const subject =
    (acc as { vacation_subject?: string | null }).vacation_subject?.trim() ||
    'Abwesenheit: Automatische Antwort';
  const body =
    (acc as { vacation_body_text?: string | null }).vacation_body_text?.trim() ||
    'Vielen Dank für Ihre Nachricht. Ich bin derzeit nicht erreichbar und melde mich schnellstmöglich.';

  try {
    await sendSmtpForAccount(acc.id, {
      from: acc.email_address,
      to: sender,
      subject,
      text: body,
      inReplyTo: row.message_id ?? undefined,
    });
    markVacationReplySent(acc.id, sender);
  } catch {
    /* optional */
  }
}
