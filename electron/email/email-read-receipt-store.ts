import { getDb } from '../sqlite-service';
import {
  getReadReceiptSettings,
  logReadReceiptAction,
  type RespondToReadReceipts,
} from './email-read-receipt';

export type LocalReadReceiptSettings = {
  respond: RespondToReadReceipts;
  trustedDomains: string | null;
};

function getEmailDbOrThrow() {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function getLocalReadReceiptSettings(accountId: number): LocalReadReceiptSettings {
  return getReadReceiptSettings(getEmailDbOrThrow(), accountId);
}

export function logLocalReadReceiptDeclined(messageId: number): void {
  logReadReceiptAction(getEmailDbOrThrow(), messageId, 'declined');
}
