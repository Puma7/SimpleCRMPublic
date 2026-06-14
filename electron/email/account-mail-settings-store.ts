import {
  buildDefaultAccountMailSettings,
  formatTicketSequence,
  normalizeAccountMailSettings,
  type AccountMailSettings,
} from '../../shared/account-mail-settings';
import { generateTicketCode } from '../../packages/core/src/email';
import { EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE, EMAIL_ACCOUNTS_TABLE } from '../database-schema';
import { getDb } from '../sqlite-service';

type AccountRow = {
  id: number;
  display_name: string | null;
  email_address: string | null;
};

type SettingsRow = {
  account_id: number;
  ticket_prefix: string;
  ticket_next_number: number;
  ticket_number_padding: number;
  thread_namespace: string;
};

function loadAccount(accountId: number): AccountRow {
  const stmt = getDb().prepare(
    `SELECT id, display_name, email_address FROM ${EMAIL_ACCOUNTS_TABLE} WHERE id = ?`,
  );
  if (typeof stmt.get !== 'function') {
    return { id: accountId, display_name: null, email_address: null };
  }
  const row = stmt.get(accountId) as AccountRow | undefined;
  if (!row) throw new Error('Konto nicht gefunden.');
  return row;
}

function rowToSettings(row: SettingsRow): AccountMailSettings {
  return normalizeAccountMailSettings(
    {
      ticketPrefix: row.ticket_prefix,
      ticketNextNumber: row.ticket_next_number,
      ticketNumberPadding: row.ticket_number_padding,
      threadNamespace: row.thread_namespace,
    },
    row.account_id,
  );
}

export function getAccountMailSettings(accountId: number): AccountMailSettings {
  const account = loadAccount(accountId);
  const stmt = getDb().prepare(
    `SELECT account_id, ticket_prefix, ticket_next_number, ticket_number_padding, thread_namespace
       FROM ${EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE}
       WHERE account_id = ?`,
  );
  if (typeof stmt.get !== 'function') return buildDefaultAccountMailSettings(account);
  const row = stmt.get(accountId) as SettingsRow | undefined;
  if (row) return rowToSettings(row);
  return buildDefaultAccountMailSettings(account);
}

export function setAccountMailSettings(
  accountId: number,
  partial: Partial<AccountMailSettings>,
): AccountMailSettings {
  loadAccount(accountId);
  const next = normalizeAccountMailSettings(
    { ...getAccountMailSettings(accountId), ...partial },
    accountId,
  );
  const conflictStmt = getDb().prepare(
    `SELECT account_id FROM ${EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE}
       WHERE ticket_prefix = ? AND account_id != ?`,
  );
  const conflict = typeof conflictStmt.get === 'function'
    ? conflictStmt.get(next.ticketPrefix, accountId) as { account_id: number } | undefined
    : undefined;
  if (conflict) {
    throw new Error(
      `Das Ticket-Präfix „${next.ticketPrefix}“ wird bereits von einem anderen Konto verwendet.`,
    );
  }

  const now = new Date().toISOString();
  const writeStmt = getDb().prepare(
    `INSERT INTO ${EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE}
         (account_id, ticket_prefix, ticket_next_number, ticket_number_padding, thread_namespace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         ticket_prefix = excluded.ticket_prefix,
         ticket_next_number = excluded.ticket_next_number,
         ticket_number_padding = excluded.ticket_number_padding,
         thread_namespace = excluded.thread_namespace,
         updated_at = excluded.updated_at`,
  );
  if (typeof writeStmt.run === 'function') {
    writeStmt.run(
      accountId,
      next.ticketPrefix,
      next.ticketNextNumber,
      next.ticketNumberPadding,
      next.threadNamespace,
      now,
      now,
    );
  }
  return next;
}


export function allocateNextTicketCodeForAccount(accountId: number): string {
  const current = getAccountMailSettings(accountId);
  const sequence = formatTicketSequence(current.ticketNextNumber, current.ticketNumberPadding);
  const nextNumber = current.ticketNextNumber + 1;
  setAccountMailSettings(accountId, { ...current, ticketNextNumber: nextNumber });
  return generateTicketCode({ prefix: current.ticketPrefix, sequence });
}
