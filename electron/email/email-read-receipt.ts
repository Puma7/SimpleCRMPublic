import type Database from 'better-sqlite3';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_READ_RECEIPT_LOG_TABLE,
} from '../database-schema';
import { parseDispositionNotificationTo } from '../../packages/core/src/email';

export {
  domainTrusted,
  parseDispositionNotificationTo,
} from '../../packages/core/src/email';

export type RespondToReadReceipts = 'never' | 'ask' | 'always_trusted';

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
