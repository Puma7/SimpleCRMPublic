import type Database from 'better-sqlite3';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_READ_RECEIPT_LOG_TABLE,
} from '../database-schema';

export type RespondToReadReceipts = 'never' | 'ask' | 'always_trusted';

export function parseDispositionNotificationTo(rawHeaders: string | null): string | null {
  if (!rawHeaders) return null;
  const lines = rawHeaders.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^Disposition-Notification-To:\s*(.*)/i);
    if (m) {
      let val = m[1]!.trim();
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) {
        i++;
        val += ` ${lines[i]!.trim()}`;
      }
      return val || null;
    }
  }
  return null;
}

export function detectAndFlagReadReceiptRequest(
  db: Database.Database,
  messageId: number,
  rawHeaders: string | null,
): boolean {
  const dnt = parseDispositionNotificationTo(rawHeaders);
  if (!dnt) return false;
  db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET read_receipt_requested = 1 WHERE id = ?`).run(messageId);
  db.prepare(
    `INSERT INTO ${EMAIL_READ_RECEIPT_LOG_TABLE} (message_id, direction, recipient) VALUES (?, 'received_in', ?)`,
  ).run(messageId, dnt);
  return true;
}

export function domainTrusted(trustedCsv: string | null, senderDomain: string): boolean {
  if (!trustedCsv?.trim()) return false;
  const list = trustedCsv.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  return list.includes(senderDomain.toLowerCase());
}

export function getReadReceiptSettings(
  db: Database.Database,
  accountId: number,
): { respond: RespondToReadReceipts; trustedDomains: string | null } {
  const row = db
    .prepare(
      `SELECT respond_to_read_receipts, read_receipt_trusted_domains FROM ${EMAIL_ACCOUNTS_TABLE} WHERE id = ?`,
    )
    .get(accountId) as { respond_to_read_receipts: string; read_receipt_trusted_domains: string | null } | undefined;
  return {
    respond: (row?.respond_to_read_receipts ?? 'never') as RespondToReadReceipts,
    trustedDomains: row?.read_receipt_trusted_domains ?? null,
  };
}

export function logReadReceiptAction(
  db: Database.Database,
  messageId: number,
  direction: string,
  recipient?: string,
): void {
  db.prepare(
    `INSERT INTO ${EMAIL_READ_RECEIPT_LOG_TABLE} (message_id, direction, recipient) VALUES (?, ?, ?)`,
  ).run(messageId, direction, recipient ?? null);
}
