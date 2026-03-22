import { randomUUID } from 'crypto';
import { getDb } from '../sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_TABLE,
} from '../database-schema';
import { deleteEmailPassword } from './email-keytar';

export type EmailAccountRow = {
  id: number;
  display_name: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_tls: number;
  imap_username: string;
  keytar_account_key: string;
  created_at: string;
  updated_at: string;
};

export type EmailFolderRow = {
  id: number;
  account_id: number;
  path: string;
  delimiter: string | null;
  uidvalidity: number | null;
  uidvalidity_str: string | null;
  last_uid: number;
  last_synced_at: string | null;
};

export type EmailMessageRow = {
  id: number;
  account_id: number;
  folder_id: number;
  uid: number;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  subject: string | null;
  from_json: string | null;
  to_json: string | null;
  cc_json: string | null;
  date_received: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  seen_local: number;
  archived: number;
  soft_deleted: number;
  created_at: string;
};

export function listEmailAccounts(): EmailAccountRow[] {
  const stmt = getDb().prepare(
    `SELECT id, display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key, created_at, updated_at
     FROM ${EMAIL_ACCOUNTS_TABLE} ORDER BY id ASC`,
  );
  return stmt.all() as EmailAccountRow[];
}

export function getEmailAccountById(id: number): EmailAccountRow | undefined {
  const stmt = getDb().prepare(
    `SELECT id, display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key, created_at, updated_at
     FROM ${EMAIL_ACCOUNTS_TABLE} WHERE id = ?`,
  );
  return stmt.get(id) as EmailAccountRow | undefined;
}

export function createEmailAccountRecord(input: {
  displayName: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUsername: string;
  /** If omitted, a new key is generated. Prefer passing a key only after the password was stored in Keytar. */
  keytarAccountKey?: string;
}): { id: number; keytarAccountKey: string } {
  const keytarAccountKey = input.keytarAccountKey ?? `email-${randomUUID()}`;
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    `INSERT INTO ${EMAIL_ACCOUNTS_TABLE} (
      display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    input.displayName,
    input.emailAddress.trim(),
    input.imapHost.trim(),
    input.imapPort,
    input.imapTls ? 1 : 0,
    input.imapUsername.trim(),
    keytarAccountKey,
    now,
    now,
  );
  return { id: Number(result.lastInsertRowid), keytarAccountKey };
}

export function updateEmailAccountRecord(
  id: number,
  input: Partial<{
    displayName: string;
    emailAddress: string;
    imapHost: string;
    imapPort: number;
    imapTls: boolean;
    imapUsername: string;
  }>,
): void {
  const existing = getEmailAccountById(id);
  if (!existing) {
    throw new Error('Email account not found');
  }
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    `UPDATE ${EMAIL_ACCOUNTS_TABLE} SET
      display_name = COALESCE(?, display_name),
      email_address = COALESCE(?, email_address),
      imap_host = COALESCE(?, imap_host),
      imap_port = COALESCE(?, imap_port),
      imap_tls = COALESCE(?, imap_tls),
      imap_username = COALESCE(?, imap_username),
      updated_at = ?
    WHERE id = ?`,
  );
  stmt.run(
    input.displayName ?? null,
    input.emailAddress?.trim() ?? null,
    input.imapHost?.trim() ?? null,
    input.imapPort ?? null,
    input.imapTls === undefined ? null : input.imapTls ? 1 : 0,
    input.imapUsername?.trim() ?? null,
    now,
    id,
  );
}

export async function deleteEmailAccountRecord(id: number): Promise<void> {
  const row = getEmailAccountById(id);
  if (row) {
    await deleteEmailPassword(row.keytar_account_key);
  }
  const stmt = getDb().prepare(`DELETE FROM ${EMAIL_ACCOUNTS_TABLE} WHERE id = ?`);
  stmt.run(id);
}

export function getFolderByAccountAndPath(accountId: number, path: string): EmailFolderRow | undefined {
  const stmt = getDb().prepare(
    `SELECT id, account_id, path, delimiter, uidvalidity, uidvalidity_str, last_uid, last_synced_at FROM ${EMAIL_FOLDERS_TABLE} WHERE account_id = ? AND path = ?`,
  );
  return stmt.get(accountId, path) as EmailFolderRow | undefined;
}

export function upsertEmailFolder(input: {
  accountId: number;
  path: string;
  delimiter?: string;
  uidvalidity?: number | null;
  uidvalidityStr?: string | null;
  lastUid?: number;
}): EmailFolderRow {
  const existing = getFolderByAccountAndPath(input.accountId, input.path);
  const now = new Date().toISOString();
  if (existing) {
    const stmt = getDb().prepare(
      `UPDATE ${EMAIL_FOLDERS_TABLE} SET
        delimiter = COALESCE(?, delimiter),
        uidvalidity = COALESCE(?, uidvalidity),
        uidvalidity_str = COALESCE(?, uidvalidity_str),
        last_uid = COALESCE(?, last_uid),
        last_synced_at = ?
      WHERE id = ?`,
    );
    stmt.run(
      input.delimiter ?? null,
      input.uidvalidity === undefined ? null : input.uidvalidity,
      input.uidvalidityStr === undefined ? null : input.uidvalidityStr,
      input.lastUid === undefined ? null : input.lastUid,
      now,
      existing.id,
    );
    return getFolderByAccountAndPath(input.accountId, input.path)!;
  }
  const ins = getDb().prepare(
    `INSERT INTO ${EMAIL_FOLDERS_TABLE} (account_id, path, delimiter, uidvalidity, uidvalidity_str, last_uid, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(
    input.accountId,
    input.path,
    input.delimiter ?? '/',
    input.uidvalidity ?? null,
    input.uidvalidityStr ?? null,
    input.lastUid ?? 0,
    now,
  );
  return getFolderByAccountAndPath(input.accountId, input.path)!;
}

export function updateFolderSyncState(
  folderId: number,
  input: { lastUid?: number; uidvalidity?: number | null; uidvalidityStr?: string | null },
): void {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    `UPDATE ${EMAIL_FOLDERS_TABLE} SET
      last_uid = COALESCE(?, last_uid),
      uidvalidity = COALESCE(?, uidvalidity),
      uidvalidity_str = COALESCE(?, uidvalidity_str),
      last_synced_at = ?
    WHERE id = ?`,
  );
  stmt.run(
    input.lastUid === undefined ? null : input.lastUid,
    input.uidvalidity === undefined ? null : input.uidvalidity,
    input.uidvalidityStr === undefined ? null : input.uidvalidityStr,
    now,
    folderId,
  );
}

export function listMessagesForFolder(
  folderId: number,
  opts: { limit?: number; offset?: number } = {},
): EmailMessageRow[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const stmt = getDb().prepare(
    `SELECT * FROM ${EMAIL_MESSAGES_TABLE}
     WHERE folder_id = ? AND soft_deleted = 0
     ORDER BY datetime(COALESCE(date_received, created_at)) DESC
     LIMIT ? OFFSET ?`,
  );
  return stmt.all(folderId, limit, offset) as EmailMessageRow[];
}

export function getEmailMessageById(id: number): EmailMessageRow | undefined {
  const stmt = getDb().prepare(`SELECT * FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`);
  return stmt.get(id) as EmailMessageRow | undefined;
}

export function insertOrUpdateEmailMessage(input: {
  accountId: number;
  folderId: number;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string | null;
  fromJson: string | null;
  toJson: string | null;
  ccJson: string | null;
  dateReceived: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  seenLocal: boolean;
}): number {
  const stmt = getDb().prepare(
    `INSERT INTO ${EMAIL_MESSAGES_TABLE} (
      account_id, folder_id, uid, message_id, in_reply_to, references_header,
      subject, from_json, to_json, cc_json, date_received, snippet, body_text, body_html, seen_local
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, folder_id, uid) DO UPDATE SET
      message_id = excluded.message_id,
      in_reply_to = excluded.in_reply_to,
      references_header = excluded.references_header,
      subject = excluded.subject,
      from_json = excluded.from_json,
      to_json = excluded.to_json,
      cc_json = excluded.cc_json,
      date_received = excluded.date_received,
      snippet = excluded.snippet,
      body_text = excluded.body_text,
      body_html = excluded.body_html,
      seen_local = MAX(${EMAIL_MESSAGES_TABLE}.seen_local, excluded.seen_local)`,
  );
  const result = stmt.run(
    input.accountId,
    input.folderId,
    input.uid,
    input.messageId,
    input.inReplyTo,
    input.referencesHeader,
    input.subject,
    input.fromJson,
    input.toJson,
    input.ccJson,
    input.dateReceived,
    input.snippet,
    input.bodyText,
    input.bodyHtml,
    input.seenLocal ? 1 : 0,
  );
  if (result.changes > 0 && result.lastInsertRowid) {
    return Number(result.lastInsertRowid);
  }
  const row = getDb().prepare(
    `SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid = ?`,
  ).get(input.accountId, input.folderId, input.uid) as { id: number } | undefined;
  return row?.id ?? 0;
}
