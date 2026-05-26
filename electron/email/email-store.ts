import { randomUUID } from 'crypto';
import { getDb } from '../sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_MESSAGE_TAGS_TABLE,
  EMAIL_MESSAGE_CATEGORIES_TABLE,
  EMAIL_TEAM_MEMBERS_TABLE,
  EMAIL_ACCOUNT_SIGNATURES_TABLE,
} from '../database-schema';
import { deleteEmailPassword } from './email-keytar';
import { SNOOZE_FILTER_SQL } from './email-message-features';
import type { MessageListSortMode } from '../../shared/email-list-options';
import type { MessageListFilter } from '../../shared/email-list-filters';
import { draftAttachmentPathsToJson } from '../../shared/compose-draft-attachments';

export type EmailAccountRow = {
  id: number;
  display_name: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_tls: number;
  imap_username: string;
  keytar_account_key: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_tls: number | null;
  smtp_username: string | null;
  smtp_use_imap_auth: number | null;
  smtp_keytar_account_key: string | null;
  protocol: string;
  pop3_host: string | null;
  pop3_port: number | null;
  pop3_tls: number | null;
  oauth_provider: string | null;
  oauth_refresh_keytar_key: string | null;
  sent_folder_path: string | null;
  imap_sync_seen_on_open: number;
  vacation_enabled: number;
  vacation_subject: string | null;
  vacation_body_text: string | null;
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
  pop3_uidl_str: string | null;
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
  bcc_json: string | null;
  date_received: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  seen_local: number;
  archived: number;
  soft_deleted: number;
  outbound_hold: number;
  outbound_block_reason: string | null;
  thread_id: string | null;
  ticket_code: string | null;
  customer_id: number | null;
  folder_kind: string;
  imap_thread_id: string | null;
  has_attachments: number;
  attachments_json: string | null;
  assigned_to: string | null;
  is_spam: number;
  /** POP3 server UIDL when message came from POP3 (stable key). */
  pop3_uidl: string | null;
  raw_headers: string | null;
  auth_spf: string | null;
  auth_dkim: string | null;
  auth_dmarc: string | null;
  auth_arc: string | null;
  auth_dkim_domains: string | null;
  auth_error: string | null;
  rspamd_score: number | null;
  rspamd_action: string | null;
  rspamd_symbols: string | null;
  rspamd_error: string | null;
  security_checked_at: string | null;
  draft_attachment_paths_json: string | null;
  created_at: string;
};

const ACCOUNT_SELECT = `id, display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key,
            smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth, smtp_keytar_account_key,
            COALESCE(protocol, 'imap') AS protocol, pop3_host, pop3_port, pop3_tls, oauth_provider, oauth_refresh_keytar_key,
            COALESCE(sent_folder_path, 'Sent') AS sent_folder_path,
            COALESCE(imap_sync_seen_on_open, 1) AS imap_sync_seen_on_open,
            COALESCE(vacation_enabled, 0) AS vacation_enabled,
            vacation_subject, vacation_body_text,
            created_at, updated_at`;

export function listEmailAccounts(): EmailAccountRow[] {
  const stmt = getDb().prepare(
    `SELECT ${ACCOUNT_SELECT}
     FROM ${EMAIL_ACCOUNTS_TABLE} ORDER BY id ASC`,
  );
  return stmt.all() as EmailAccountRow[];
}

export function getEmailAccountById(id: number): EmailAccountRow | undefined {
  const stmt = getDb().prepare(
    `SELECT ${ACCOUNT_SELECT}
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
  protocol?: 'imap' | 'pop3';
  pop3Host?: string | null;
  pop3Port?: number;
  pop3Tls?: boolean;
  imapSyncSeenOnOpen?: boolean;
}): { id: number; keytarAccountKey: string } {
  const keytarAccountKey = input.keytarAccountKey ?? `email-${randomUUID()}`;
  const now = new Date().toISOString();
  const proto = input.protocol ?? 'imap';
  const p3h = input.pop3Host?.trim() || null;
  const p3p = input.pop3Port ?? 995;
  const p3t = input.pop3Tls !== false ? 1 : 0;
  const syncSeen = input.imapSyncSeenOnOpen !== false ? 1 : 0;
  const stmt = getDb().prepare(
    `INSERT INTO ${EMAIL_ACCOUNTS_TABLE} (
      display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key,
      smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth, smtp_keytar_account_key,
      protocol, pop3_host, pop3_port, pop3_tls, imap_sync_seen_on_open,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    input.displayName,
    input.emailAddress.trim(),
    input.imapHost.trim(),
    input.imapPort,
    input.imapTls ? 1 : 0,
    input.imapUsername.trim(),
    keytarAccountKey,
    null,
    587,
    1,
    null,
    1,
    null,
    proto,
    p3h,
    p3p,
    p3t,
    syncSeen,
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
    smtpHost: string | null;
    smtpPort: number | null;
    smtpTls: boolean | null;
    smtpUsername: string | null;
    smtpUseImapAuth: boolean | null;
    smtpKeytarAccountKey: string | null;
    protocol: 'imap' | 'pop3';
    pop3Host: string | null;
    pop3Port: number | null;
    pop3Tls: boolean | null;
    oauthProvider: string | null;
    oauthRefreshKeytarKey: string | null;
    sentFolderPath: string | null;
    imapSyncSeenOnOpen: boolean;
    vacationEnabled: boolean;
    vacationSubject: string | null;
    vacationBodyText: string | null;
  }>,
): void {
  const existing = getEmailAccountById(id);
  if (!existing) {
    throw new Error('Email account not found');
  }
  const now = new Date().toISOString();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (input.displayName !== undefined) { sets.push('display_name = ?'); vals.push(input.displayName); }
  if (input.emailAddress !== undefined) { sets.push('email_address = ?'); vals.push(input.emailAddress.trim()); }
  if (input.imapHost !== undefined) { sets.push('imap_host = ?'); vals.push(input.imapHost.trim()); }
  if (input.imapPort !== undefined) { sets.push('imap_port = ?'); vals.push(input.imapPort); }
  if (input.imapTls !== undefined) { sets.push('imap_tls = ?'); vals.push(input.imapTls ? 1 : 0); }
  if (input.imapUsername !== undefined) { sets.push('imap_username = ?'); vals.push(input.imapUsername.trim()); }
  if (input.smtpHost !== undefined) { sets.push('smtp_host = ?'); vals.push(input.smtpHost); }
  if (input.smtpPort !== undefined) { sets.push('smtp_port = ?'); vals.push(input.smtpPort); }
  if (input.smtpTls !== undefined) { sets.push('smtp_tls = ?'); vals.push(input.smtpTls ? 1 : 0); }
  if (input.smtpUsername !== undefined) { sets.push('smtp_username = ?'); vals.push(input.smtpUsername); }
  if (input.smtpUseImapAuth !== undefined) { sets.push('smtp_use_imap_auth = ?'); vals.push(input.smtpUseImapAuth ? 1 : 0); }
  if (input.smtpKeytarAccountKey !== undefined) { sets.push('smtp_keytar_account_key = ?'); vals.push(input.smtpKeytarAccountKey); }
  if (input.protocol !== undefined) { sets.push('protocol = ?'); vals.push(input.protocol); }
  if (input.pop3Host !== undefined) { sets.push('pop3_host = ?'); vals.push(input.pop3Host); }
  if (input.pop3Port !== undefined) { sets.push('pop3_port = ?'); vals.push(input.pop3Port); }
  if (input.pop3Tls !== undefined) { sets.push('pop3_tls = ?'); vals.push(input.pop3Tls ? 1 : 0); }
  if (input.oauthProvider !== undefined) { sets.push('oauth_provider = ?'); vals.push(input.oauthProvider); }
  if (input.oauthRefreshKeytarKey !== undefined) { sets.push('oauth_refresh_keytar_key = ?'); vals.push(input.oauthRefreshKeytarKey); }
  if (input.sentFolderPath !== undefined) { sets.push('sent_folder_path = ?'); vals.push(input.sentFolderPath); }
  if (input.imapSyncSeenOnOpen !== undefined) {
    sets.push('imap_sync_seen_on_open = ?');
    vals.push(input.imapSyncSeenOnOpen ? 1 : 0);
  }
  if (input.vacationEnabled !== undefined) {
    sets.push('vacation_enabled = ?');
    vals.push(input.vacationEnabled ? 1 : 0);
  }
  if (input.vacationSubject !== undefined) {
    sets.push('vacation_subject = ?');
    vals.push(input.vacationSubject);
  }
  if (input.vacationBodyText !== undefined) {
    sets.push('vacation_body_text = ?');
    vals.push(input.vacationBodyText);
  }

  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(now, id);
  getDb()
    .prepare(`UPDATE ${EMAIL_ACCOUNTS_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}

export function setMessageAssignedTo(messageId: number, teamMemberId: string | null): void {
  getDb().prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET assigned_to = ? WHERE id = ?`).run(teamMemberId, messageId);
}

export type EmailTeamMemberRow = {
  id: string;
  display_name: string;
  role: string;
  signature_html: string | null;
  sort_order: number;
  created_at: string;
};

export function listEmailTeamMembers(): EmailTeamMemberRow[] {
  const stmt = getDb().prepare(
    `SELECT id, display_name, role, signature_html, sort_order, created_at FROM ${EMAIL_TEAM_MEMBERS_TABLE} ORDER BY sort_order ASC, display_name ASC`,
  );
  let rows = stmt.all() as EmailTeamMemberRow[];
  if (rows.length === 0) {
    upsertEmailTeamMember({
      id: 'agent-1',
      displayName: 'Kundenservice',
      role: 'agent',
      sortOrder: 0,
      signatureHtml: '<p>Mit freundlichen Grüßen<br/>Ihr Kundenservice</p>',
    });
    rows = stmt.all() as EmailTeamMemberRow[];
  }
  return rows;
}

export function upsertEmailTeamMember(input: {
  id: string;
  displayName: string;
  role?: string;
  sortOrder?: number;
  signatureHtml?: string | null;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_TEAM_MEMBERS_TABLE} (id, display_name, role, signature_html, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         signature_html = excluded.signature_html,
         sort_order = excluded.sort_order`,
    )
    .run(
      input.id.trim(),
      input.displayName.trim(),
      input.role?.trim() || 'agent',
      input.signatureHtml?.trim() || null,
      input.sortOrder ?? 0,
      now,
    );
}

export type AccountSignatureRow = {
  account_id: number;
  display_name: string;
  email_address: string;
  signature_html: string | null;
};

export function listAccountSignatureRows(): AccountSignatureRow[] {
  return getDb()
    .prepare(
      `SELECT a.id AS account_id, a.display_name, a.email_address, s.signature_html
       FROM ${EMAIL_ACCOUNTS_TABLE} a
       LEFT JOIN ${EMAIL_ACCOUNT_SIGNATURES_TABLE} s ON s.account_id = a.id
       ORDER BY a.id ASC`,
    )
    .all() as AccountSignatureRow[];
}

export function saveAccountSignature(accountId: number, signatureHtml: string | null): void {
  const trimmed = signatureHtml?.trim() || null;
  if (!trimmed) {
    getDb()
      .prepare(`DELETE FROM ${EMAIL_ACCOUNT_SIGNATURES_TABLE} WHERE account_id = ?`)
      .run(accountId);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_ACCOUNT_SIGNATURES_TABLE} (account_id, signature_html, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         signature_html = excluded.signature_html,
         updated_at = datetime('now')`,
    )
    .run(accountId, trimmed);
}

function getTeamFallbackSignatureHtml(): string | null {
  const rows = listEmailTeamMembers();
  const withSig = rows.find((r) => r.signature_html?.trim());
  if (withSig?.signature_html) return withSig.signature_html.trim();
  if (rows.length > 0) {
    return `<p>Mit freundlichen Grüßen<br/>${rows[0]!.display_name}</p>`;
  }
  return null;
}

/** Compose footer for a specific mail account (per-account → team → account display name). */
export function getComposeSignatureHtml(accountId: number): string | null {
  const acc = getEmailAccountById(accountId);
  if (!acc) return null;
  const row = getDb()
    .prepare(
      `SELECT signature_html FROM ${EMAIL_ACCOUNT_SIGNATURES_TABLE} WHERE account_id = ?`,
    )
    .get(accountId) as { signature_html: string | null } | undefined;
  if (row?.signature_html?.trim()) {
    return row.signature_html.trim();
  }
  const teamFallback = getTeamFallbackSignatureHtml();
  if (teamFallback) return teamFallback;
  return `<p>Mit freundlichen Grüßen<br/>${acc.display_name}</p>`;
}

/** @deprecated Use getComposeSignatureHtml(accountId) */
export function getDefaultComposeSignatureHtml(): string | null {
  const accounts = listEmailAccounts();
  if (accounts.length === 0) return getTeamFallbackSignatureHtml();
  return getComposeSignatureHtml(accounts[0]!.id);
}

export function deleteEmailTeamMember(id: string): void {
  getDb().prepare(`DELETE FROM ${EMAIL_TEAM_MEMBERS_TABLE} WHERE id = ?`).run(id);
}

export async function deleteEmailAccountRecord(id: number): Promise<void> {
  const row = getEmailAccountById(id);
  if (row) {
    const { purgeAttachmentFilesForAccount } = await import('./email-message-attachments-store');
    await purgeAttachmentFilesForAccount(id);
    await deleteEmailPassword(row.keytar_account_key);
    if (row.smtp_keytar_account_key) {
      await deleteEmailPassword(row.smtp_keytar_account_key).catch(() => undefined);
    }
    if (row.oauth_refresh_keytar_key) {
      await deleteEmailPassword(row.oauth_refresh_keytar_key).catch(() => undefined);
    }
  }
  const stmt = getDb().prepare(`DELETE FROM ${EMAIL_ACCOUNTS_TABLE} WHERE id = ?`);
  stmt.run(id);
}

export function getFolderByAccountAndPath(accountId: number, path: string): EmailFolderRow | undefined {
  const stmt = getDb().prepare(
    `SELECT id, account_id, path, delimiter, uidvalidity, uidvalidity_str, last_uid, last_synced_at, pop3_uidl_str FROM ${EMAIL_FOLDERS_TABLE} WHERE account_id = ? AND path = ?`,
  );
  return stmt.get(accountId, path) as EmailFolderRow | undefined;
}

export function getFolderById(folderId: number): EmailFolderRow | undefined {
  const stmt = getDb().prepare(
    `SELECT id, account_id, path, delimiter, uidvalidity, uidvalidity_str, last_uid, last_synced_at, pop3_uidl_str FROM ${EMAIL_FOLDERS_TABLE} WHERE id = ?`,
  );
  return stmt.get(folderId) as EmailFolderRow | undefined;
}

export function upsertEmailFolder(input: {
  accountId: number;
  path: string;
  delimiter?: string;
  uidvalidity?: number | null;
  uidvalidityStr?: string | null;
  lastUid?: number;
  pop3UidlStr?: string | null;
}): EmailFolderRow {
  const existing = getFolderByAccountAndPath(input.accountId, input.path);
  const now = new Date().toISOString();
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (input.delimiter !== undefined) { sets.push('delimiter = ?'); vals.push(input.delimiter); }
    if (input.uidvalidity !== undefined) { sets.push('uidvalidity = ?'); vals.push(input.uidvalidity); }
    if (input.uidvalidityStr !== undefined) { sets.push('uidvalidity_str = ?'); vals.push(input.uidvalidityStr); }
    if (input.lastUid !== undefined) { sets.push('last_uid = ?'); vals.push(input.lastUid); }
    if (input.pop3UidlStr !== undefined) { sets.push('pop3_uidl_str = ?'); vals.push(input.pop3UidlStr); }
    sets.push('last_synced_at = ?');
    vals.push(now, existing.id);
    getDb()
      .prepare(`UPDATE ${EMAIL_FOLDERS_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
      .run(...vals);
    return getFolderByAccountAndPath(input.accountId, input.path)!;
  }
  const ins = getDb().prepare(
    `INSERT INTO ${EMAIL_FOLDERS_TABLE} (account_id, path, delimiter, uidvalidity, uidvalidity_str, last_uid, pop3_uidl_str, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(
    input.accountId,
    input.path,
    input.delimiter ?? '/',
    input.uidvalidity ?? null,
    input.uidvalidityStr ?? null,
    input.lastUid ?? 0,
    input.pop3UidlStr ?? null,
    now,
  );
  return getFolderByAccountAndPath(input.accountId, input.path)!;
}

export function updateFolderSyncState(
  folderId: number,
  input: {
    lastUid?: number;
    uidvalidity?: number | null;
    uidvalidityStr?: string | null;
    pop3UidlStr?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.lastUid !== undefined) { sets.push('last_uid = ?'); vals.push(input.lastUid); }
  if (input.uidvalidity !== undefined) { sets.push('uidvalidity = ?'); vals.push(input.uidvalidity); }
  if (input.uidvalidityStr !== undefined) { sets.push('uidvalidity_str = ?'); vals.push(input.uidvalidityStr); }
  if (input.pop3UidlStr !== undefined) { sets.push('pop3_uidl_str = ?'); vals.push(input.pop3UidlStr); }
  sets.push('last_synced_at = ?');
  vals.push(now, folderId);
  getDb()
    .prepare(`UPDATE ${EMAIL_FOLDERS_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
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
       AND (uid >= 0 OR pop3_uidl IS NOT NULL)
       AND (folder_kind = 'inbox' OR folder_kind IS NULL OR folder_kind = '')
       AND archived = 0 AND is_spam = 0
     ORDER BY datetime(COALESCE(date_received, created_at)) DESC
     LIMIT ? OFFSET ?`,
  );
  return stmt.all(folderId, limit, offset) as EmailMessageRow[];
}

export type AccountMailView = 'inbox' | 'sent' | 'archived' | 'drafts' | 'spam' | 'trash' | 'all';

function orderClauseForSort(sort?: MessageListSortMode): string {
  if (sort === 'priority') {
    return `ORDER BY
      CASE
        WHEN EXISTS (SELECT 1 FROM ${EMAIL_MESSAGE_TAGS_TABLE} t WHERE t.message_id = m.id AND t.tag = 'priority:hoch') THEN 0
        WHEN EXISTS (SELECT 1 FROM ${EMAIL_MESSAGE_TAGS_TABLE} t WHERE t.message_id = m.id AND t.tag = 'priority:mittel') THEN 1
        WHEN EXISTS (SELECT 1 FROM ${EMAIL_MESSAGE_TAGS_TABLE} t WHERE t.message_id = m.id AND t.tag = 'priority:niedrig') THEN 2
        ELSE 3
      END ASC,
      datetime(COALESCE(m.date_received, m.created_at)) DESC`;
  }
  if (sort === 'date_asc') {
    return `ORDER BY datetime(COALESCE(m.date_received, m.created_at)) ASC`;
  }
  return `ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC`;
}

function listFilterSql(filter?: MessageListFilter): string {
  switch (filter) {
    case 'unread':
      return ' AND m.seen_local = 0 AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL)';
    case 'attachment':
      return ' AND m.has_attachments = 1';
    case 'customer':
      return ' AND m.customer_id IS NOT NULL AND m.customer_id > 0';
    case 'workflow':
      return ' AND (m.outbound_hold = 1 OR (m.ticket_code IS NOT NULL AND m.ticket_code != \'\'))';
    default:
      return '';
  }
}

export function ensureInboxFolderForAccount(accountId: number): EmailFolderRow {
  const existing = getFolderByAccountAndPath(accountId, 'INBOX');
  if (existing) return existing;
  return upsertEmailFolder({ accountId, path: 'INBOX', lastUid: 0 });
}

export function listMessagesForAccountView(
  accountId: number,
  view: AccountMailView,
  opts: {
    limit?: number;
    offset?: number;
    categoryId?: number | null;
    sort?: MessageListSortMode;
    listFilter?: MessageListFilter;
  } = {},
): EmailMessageRow[] {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  let sql = `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m`;
  const params: (string | number)[] = [];

  if (opts.categoryId != null && opts.categoryId > 0 && view !== 'trash') {
    sql += ` INNER JOIN ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc ON mc.message_id = m.id AND mc.category_id = ?`;
    params.push(opts.categoryId);
  }

  if (view === 'trash') {
    sql += ` WHERE m.account_id = ? AND m.soft_deleted = 1`;
  } else {
    sql += ` WHERE m.account_id = ? AND m.soft_deleted = 0 AND ${SNOOZE_FILTER_SQL}`;
  }
  params.push(accountId);
  const nonDraftMail = `(m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`;
  const outboundHeldInInbox = `(m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = 1)`;
  if (view === 'trash') {
    sql += ` ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    return getDb().prepare(sql).all(...params) as EmailMessageRow[];
  }
  if (view === 'inbox') {
    sql += ` AND (
      (${nonDraftMail} AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '') AND m.archived = 0 AND m.is_spam = 0)
      OR ${outboundHeldInInbox}
    )`;
  } else if (view === 'sent') {
    sql += ` AND m.folder_kind = 'sent' AND m.is_spam = 0`;
  } else if (view === 'archived') {
    sql += ` AND m.archived = 1 AND ${nonDraftMail} AND m.is_spam = 0`;
  } else if (view === 'drafts') {
    sql += ` AND m.folder_kind = 'draft'`;
  } else if (view === 'spam') {
    sql += ` AND ${nonDraftMail} AND m.is_spam = 1`;
  } else {
    sql += ` AND ${nonDraftMail}`;
  }

  sql += listFilterSql(opts.listFilter);
  sql += ` ${orderClauseForSort(opts.sort)} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return getDb().prepare(sql).all(...params) as EmailMessageRow[];
}

/** Unified inbox: same view rules across every configured account. */
export function listMessagesForAllAccountsView(
  view: AccountMailView,
  opts: {
    limit?: number;
    offset?: number;
    categoryId?: number | null;
    sort?: MessageListSortMode;
    listFilter?: MessageListFilter;
  } = {},
): EmailMessageRow[] {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  let sql = `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m`;
  const params: (string | number)[] = [];

  if (opts.categoryId != null && opts.categoryId > 0 && view !== 'trash') {
    sql += ` INNER JOIN ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc ON mc.message_id = m.id AND mc.category_id = ?`;
    params.push(opts.categoryId);
  }

  if (view === 'trash') {
    sql += ` WHERE m.soft_deleted = 1`;
  } else {
    sql += ` WHERE m.soft_deleted = 0 AND ${SNOOZE_FILTER_SQL}`;
  }
  const nonDraftMail = `(m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`;
  const outboundHeldInInbox = `(m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = 1)`;
  if (view === 'trash') {
    sql += ` ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    return getDb().prepare(sql).all(...params) as EmailMessageRow[];
  }
  if (view === 'inbox') {
    sql += ` AND (
      (${nonDraftMail} AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '') AND m.archived = 0 AND m.is_spam = 0)
      OR ${outboundHeldInInbox}
    )`;
  } else if (view === 'sent') {
    sql += ` AND m.folder_kind = 'sent' AND m.is_spam = 0`;
  } else if (view === 'archived') {
    sql += ` AND m.archived = 1 AND ${nonDraftMail} AND m.is_spam = 0`;
  } else if (view === 'drafts') {
    sql += ` AND m.folder_kind = 'draft'`;
  } else if (view === 'spam') {
    sql += ` AND ${nonDraftMail} AND m.is_spam = 1`;
  } else {
    sql += ` AND ${nonDraftMail}`;
  }

  sql += listFilterSql(opts.listFilter);
  sql += ` ${orderClauseForSort(opts.sort)} LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params) as EmailMessageRow[];
}

export function listMessagesForMailScope(
  accountScope: number | 'all',
  view: AccountMailView,
  opts: {
    limit?: number;
    offset?: number;
    categoryId?: number | null;
    sort?: MessageListSortMode;
    listFilter?: MessageListFilter;
  } = {},
): EmailMessageRow[] {
  if (accountScope === 'all') {
    return listMessagesForAllAccountsView(view, opts);
  }
  return listMessagesForAccountView(accountScope, view, opts);
}

export type MailFolderCounts = {
  inbox: number;
  inboxUnread: number;
  sent: number;
  drafts: number;
  archived: number;
  spam: number;
  trash: number;
};

/** Per-folder message totals for sidebar badges (current account). */
export function getMailFolderCountsForAccount(accountId: number): MailFolderCounts {
  const nonDraftMail = `(uid >= 0 OR pop3_uidl IS NOT NULL)`;
  const outboundHeldInInbox = `(uid < 0 AND folder_kind = 'draft' AND outbound_hold = 1)`;
  const inboxBase = `soft_deleted = 0 AND (
    (${nonDraftMail} AND (folder_kind = 'inbox' OR folder_kind IS NULL OR folder_kind = '') AND archived = 0 AND is_spam = 0)
    OR ${outboundHeldInInbox}
  )`;
  const row = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN soft_deleted = 1 THEN 1 ELSE 0 END) AS trash,
        SUM(CASE WHEN ${inboxBase} THEN 1 ELSE 0 END) AS inbox,
        SUM(CASE WHEN ${inboxBase} AND seen_local = 0 THEN 1 ELSE 0 END) AS inbox_unread,
        SUM(CASE WHEN soft_deleted = 0 AND folder_kind = 'sent' AND is_spam = 0 THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN soft_deleted = 0 AND folder_kind = 'draft' THEN 1 ELSE 0 END) AS drafts,
        SUM(CASE WHEN soft_deleted = 0 AND archived = 1 AND ${nonDraftMail} AND is_spam = 0 THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN soft_deleted = 0 AND ${nonDraftMail} AND is_spam = 1 THEN 1 ELSE 0 END) AS spam
      FROM ${EMAIL_MESSAGES_TABLE}
      WHERE account_id = ?`,
    )
    .get(accountId) as {
    trash: number | null;
    inbox: number | null;
    inbox_unread: number | null;
    sent: number | null;
    drafts: number | null;
    archived: number | null;
    spam: number | null;
  };

  return {
    inbox: Number(row?.inbox) || 0,
    inboxUnread: Number(row?.inbox_unread) || 0,
    sent: Number(row?.sent) || 0,
    drafts: Number(row?.drafts) || 0,
    archived: Number(row?.archived) || 0,
    spam: Number(row?.spam) || 0,
    trash: Number(row?.trash) || 0,
  };
}

/** Folder badges when „Alle Konten“ is selected — sums across accounts. */
export function getMailFolderCountsForAllAccounts(): MailFolderCounts {
  const nonDraftMail = `(uid >= 0 OR pop3_uidl IS NOT NULL)`;
  const outboundHeldInInbox = `(uid < 0 AND folder_kind = 'draft' AND outbound_hold = 1)`;
  const inboxBase = `soft_deleted = 0 AND (
    (${nonDraftMail} AND (folder_kind = 'inbox' OR folder_kind IS NULL OR folder_kind = '') AND archived = 0 AND is_spam = 0)
    OR ${outboundHeldInInbox}
  )`;
  const row = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN soft_deleted = 1 THEN 1 ELSE 0 END) AS trash,
        SUM(CASE WHEN ${inboxBase} THEN 1 ELSE 0 END) AS inbox,
        SUM(CASE WHEN ${inboxBase} AND seen_local = 0 THEN 1 ELSE 0 END) AS inbox_unread,
        SUM(CASE WHEN soft_deleted = 0 AND folder_kind = 'sent' AND is_spam = 0 THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN soft_deleted = 0 AND folder_kind = 'draft' THEN 1 ELSE 0 END) AS drafts,
        SUM(CASE WHEN soft_deleted = 0 AND archived = 1 AND ${nonDraftMail} AND is_spam = 0 THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN soft_deleted = 0 AND ${nonDraftMail} AND is_spam = 1 THEN 1 ELSE 0 END) AS spam
      FROM ${EMAIL_MESSAGES_TABLE}`,
    )
    .get() as {
    trash: number | null;
    inbox: number | null;
    inbox_unread: number | null;
    sent: number | null;
    drafts: number | null;
    archived: number | null;
    spam: number | null;
  };

  return {
    inbox: Number(row?.inbox) || 0,
    inboxUnread: Number(row?.inbox_unread) || 0,
    sent: Number(row?.sent) || 0,
    drafts: Number(row?.drafts) || 0,
    archived: Number(row?.archived) || 0,
    spam: Number(row?.spam) || 0,
    trash: Number(row?.trash) || 0,
  };
}

export function getMailFolderCountsForScope(accountScope: number | 'all'): MailFolderCounts {
  if (accountScope === 'all') {
    return getMailFolderCountsForAllAccounts();
  }
  return getMailFolderCountsForAccount(accountScope);
}

export function getEmailMessageById(id: number): EmailMessageRow | undefined {
  const stmt = getDb().prepare(`SELECT * FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`);
  return stmt.get(id) as EmailMessageRow | undefined;
}

/** Negative UID for POP3 rows only — never collides with IMAP uid >= 0 or draft negatives in same folder. */
export function allocatePop3NegativeUid(accountId: number, folderId: number): number {
  const row = getDb()
    .prepare(
      `SELECT MIN(uid) as m FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid < 0`,
    )
    .get(accountId, folderId) as { m: number | null };
  return row.m != null ? row.m - 1 : -1;
}

export function listMessageIdsForWorkflowBackfill(offset: number, limit: number): number[] {
  const rows = getDb()
    .prepare(
      `SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE (uid >= 0 OR pop3_uidl IS NOT NULL) AND soft_deleted = 0 ORDER BY id ASC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as { id: number }[];
  return rows.map((r) => r.id);
}

const IN_QUERY_CHUNK = 400;

/** POP3: all UIDLs already stored for a folder (one query per sync). */
export function loadPop3UidlsForFolder(folderId: number): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT pop3_uidl FROM ${EMAIL_MESSAGES_TABLE}
       WHERE folder_id = ? AND pop3_uidl IS NOT NULL AND TRIM(pop3_uidl) != ''`,
    )
    .all(folderId) as { pop3_uidl: string }[];
  return new Set(rows.map((r) => r.pop3_uidl));
}

/** POP3: map UIDL → local message id (one query per sync). */
export function loadPop3UidlToIdMap(folderId: number): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT id, pop3_uidl FROM ${EMAIL_MESSAGES_TABLE}
       WHERE folder_id = ? AND pop3_uidl IS NOT NULL AND TRIM(pop3_uidl) != ''`,
    )
    .all(folderId) as { id: number; pop3_uidl: string }[];
  return new Map(rows.map((r) => [r.pop3_uidl, r.id]));
}

/** IMAP: existing server UIDs in folder for a batch of candidates. */
export function loadImapUidToIdMap(folderId: number, uids: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (uids.length === 0) return map;
  const db = getDb();
  for (let i = 0; i < uids.length; i += IN_QUERY_CHUNK) {
    const chunk = uids.slice(i, i + IN_QUERY_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT uid, id FROM ${EMAIL_MESSAGES_TABLE} WHERE folder_id = ? AND uid IN (${placeholders})`,
      )
      .all(folderId, ...chunk) as { uid: number; id: number }[];
    for (const r of rows) map.set(r.uid, r.id);
  }
  return map;
}

/** Mutable context reused across messages in one sync run (avoids per-message SELECT/MIN). */
export type MessageUpsertContext = {
  pop3UidlToId?: Map<string, number>;
  nextPop3Uid?: number;
  imapUidToId?: Map<number, number>;
};

export function createPop3UpsertContext(folderId: number, accountId: number): MessageUpsertContext {
  const row = getDb()
    .prepare(
      `SELECT MIN(uid) as m FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid < 0`,
    )
    .get(accountId, folderId) as { m: number | null };
  return {
    pop3UidlToId: loadPop3UidlToIdMap(folderId),
    nextPop3Uid: row.m != null ? row.m - 1 : -1,
  };
}

export function createImapUpsertContext(folderId: number, uids: number[]): MessageUpsertContext {
  return { imapUidToId: loadImapUidToIdMap(folderId, uids) };
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
  imapThreadId?: string | null;
  hasAttachments?: boolean;
  attachmentsJson?: string | null;
  /** POP3: stable server UIDL — row is keyed by this, not by volatile message number. */
  pop3Uidl?: string | null;
  rawHeaders?: string | null;
}, ctx?: MessageUpsertContext): { id: number; isNew: boolean } {
  const hasAtt = input.hasAttachments ? 1 : 0;
  const attJson = input.attachmentsJson ?? null;
  const imapTid = input.imapThreadId ?? null;
  const pop3Uidl = input.pop3Uidl?.trim() || null;

  const db = getDb();

  let existingByUidl: { id: number } | undefined;
  if (pop3Uidl) {
    const cachedId = ctx?.pop3UidlToId?.get(pop3Uidl);
    if (cachedId != null) {
      existingByUidl = { id: cachedId };
    } else {
      existingByUidl = db
        .prepare(
          `SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND pop3_uidl = ?`,
        )
        .get(input.accountId, input.folderId, pop3Uidl) as { id: number } | undefined;
    }
    if (existingByUidl) {
      const byUidl = existingByUidl;
      db.prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE} SET
          message_id = ?,
          in_reply_to = ?,
          references_header = ?,
          subject = ?,
          from_json = ?,
          to_json = ?,
          cc_json = ?,
          date_received = ?,
          snippet = ?,
          body_text = ?,
          body_html = ?,
          imap_thread_id = COALESCE(?, imap_thread_id),
          has_attachments = ?,
          attachments_json = COALESCE(?, attachments_json),
          seen_local = MAX(seen_local, ?),
          raw_headers = COALESCE(?, raw_headers)
        WHERE id = ?`,
      ).run(
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
        imapTid,
        hasAtt,
        attJson,
        input.seenLocal ? 1 : 0,
        input.rawHeaders ?? null,
        byUidl.id,
      );
      return { id: byUidl.id, isNew: false };
    }
  }

  let uidForRow = input.uid;
  if (pop3Uidl && !existingByUidl) {
    if (ctx?.nextPop3Uid != null) {
      uidForRow = ctx.nextPop3Uid;
      ctx.nextPop3Uid -= 1;
    } else {
      uidForRow = allocatePop3NegativeUid(input.accountId, input.folderId);
    }
  }

  const cachedImapId =
    !pop3Uidl && ctx?.imapUidToId != null ? ctx.imapUidToId.get(uidForRow) : undefined;
  const existing =
    cachedImapId != null
      ? { id: cachedImapId }
      : (db
          .prepare(`SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid = ?`)
          .get(input.accountId, input.folderId, uidForRow) as { id: number } | undefined);
  const isNew = !existing;

  const stmt = db.prepare(
    `INSERT INTO ${EMAIL_MESSAGES_TABLE} (
      account_id, folder_id, uid, message_id, in_reply_to, references_header,
      subject, from_json, to_json, cc_json, date_received, snippet, body_text, body_html, seen_local,
      imap_thread_id, has_attachments, attachments_json, pop3_uidl, raw_headers,
      thread_id, ticket_code, customer_id, folder_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'inbox')
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
      imap_thread_id = COALESCE(excluded.imap_thread_id, ${EMAIL_MESSAGES_TABLE}.imap_thread_id),
      has_attachments = excluded.has_attachments,
      attachments_json = COALESCE(excluded.attachments_json, ${EMAIL_MESSAGES_TABLE}.attachments_json),
      pop3_uidl = COALESCE(excluded.pop3_uidl, ${EMAIL_MESSAGES_TABLE}.pop3_uidl),
      raw_headers = COALESCE(excluded.raw_headers, ${EMAIL_MESSAGES_TABLE}.raw_headers),
      seen_local = MAX(${EMAIL_MESSAGES_TABLE}.seen_local, excluded.seen_local)`,
  );
  const result = stmt.run(
    input.accountId,
    input.folderId,
    uidForRow,
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
    imapTid,
    hasAtt,
    attJson,
    pop3Uidl,
    input.rawHeaders ?? null,
  );
  let id = existing?.id ?? 0;
  if (!id) {
    const row = db
      .prepare(`SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid = ?`)
      .get(input.accountId, input.folderId, uidForRow) as { id: number } | undefined;
    id = row?.id ?? (result.lastInsertRowid ? Number(result.lastInsertRowid) : 0);
  }
  if (pop3Uidl && ctx?.pop3UidlToId && id > 0) {
    ctx.pop3UidlToId.set(pop3Uidl, id);
  }
  if (!pop3Uidl && ctx?.imapUidToId && id > 0) {
    ctx.imapUidToId.set(uidForRow, id);
  }
  return { id, isNew };
}

export function bulkSoftDeleteMessages(messageIds: number[], accountId?: number): number {
  if (messageIds.length === 0) return 0;
  const placeholders = messageIds.map(() => '?').join(',');
  const syncable = `(uid >= 0 OR pop3_uidl IS NOT NULL)`;
  const sql =
    accountId != null
      ? `UPDATE ${EMAIL_MESSAGES_TABLE} SET soft_deleted = 1 WHERE account_id = ? AND id IN (${placeholders}) AND ${syncable}`
      : `UPDATE ${EMAIL_MESSAGES_TABLE} SET soft_deleted = 1 WHERE id IN (${placeholders}) AND ${syncable}`;
  const params = accountId != null ? [accountId, ...messageIds] : messageIds;
  const r = getDb().prepare(sql).run(...params);
  return r.changes;
}

export function bulkSetMessagesArchived(
  messageIds: number[],
  archived: boolean,
  accountId?: number,
): number {
  if (messageIds.length === 0) return 0;
  const placeholders = messageIds.map(() => '?').join(',');
  const syncable = `(uid >= 0 OR pop3_uidl IS NOT NULL)`;
  const sql =
    accountId != null
      ? `UPDATE ${EMAIL_MESSAGES_TABLE} SET archived = ? WHERE account_id = ? AND id IN (${placeholders}) AND ${syncable} AND soft_deleted = 0`
      : `UPDATE ${EMAIL_MESSAGES_TABLE} SET archived = ? WHERE id IN (${placeholders}) AND ${syncable} AND soft_deleted = 0`;
  const params =
    accountId != null
      ? [archived ? 1 : 0, accountId, ...messageIds]
      : [archived ? 1 : 0, ...messageIds];
  const r = getDb().prepare(sql).run(...params);
  return r.changes;
}

export function setMessageArchived(messageId: number, archived: boolean): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET archived = ? WHERE id = ?`)
    .run(archived ? 1 : 0, messageId);
}

export function setMessageSeenLocal(messageId: number, seen: boolean): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET seen_local = ? WHERE id = ?`)
    .run(seen ? 1 : 0, messageId);
}

export function setMessageSpam(messageId: number, spam: boolean): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET is_spam = ? WHERE id = ?`)
    .run(spam ? 1 : 0, messageId);
}

export function listTagsForMessage(messageId: number): string[] {
  const rows = getDb()
    .prepare(`SELECT tag FROM ${EMAIL_MESSAGE_TAGS_TABLE} WHERE message_id = ? ORDER BY tag ASC`)
    .all(messageId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

export function addMessageTag(messageId: number, tag: string): void {
  const t = tag.trim();
  if (!t) return;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${EMAIL_MESSAGE_TAGS_TABLE} (message_id, tag) VALUES (?, ?)`,
    )
    .run(messageId, t);
}

export function removeMessageTag(messageId: number, tag: string): void {
  const t = tag.trim();
  if (!t) return;
  getDb()
    .prepare(`DELETE FROM ${EMAIL_MESSAGE_TAGS_TABLE} WHERE message_id = ? AND tag = ?`)
    .run(messageId, t);
}

export function setOutboundHold(messageId: number, hold: boolean, reason: string | null): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET outbound_hold = ?, outbound_block_reason = ? WHERE id = ?`,
    )
    .run(hold ? 1 : 0, reason, messageId);
}

/** Negative IMAP UID: local compose draft only, never from server sync. */
export function createComposeDraft(input: {
  accountId: number;
  subject?: string;
  bodyText?: string;
  toJson?: string | null;
  draftAttachmentPaths?: string[];
}): number {
  const folder = ensureInboxFolderForAccount(input.accountId);
  const minRow = getDb()
    .prepare(
      `SELECT MIN(uid) as m FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid < 0`,
    )
    .get(input.accountId, folder.id) as { m: number | null };
  const uid = minRow.m != null ? minRow.m - 1 : -1;
  const { id } = insertOrUpdateEmailMessage({
    accountId: input.accountId,
    folderId: folder.id,
    uid,
    messageId: null,
    inReplyTo: null,
    referencesHeader: null,
    subject: input.subject ?? '(Entwurf)',
    fromJson: null,
    toJson: input.toJson ?? null,
    ccJson: null,
    dateReceived: new Date().toISOString(),
    snippet: (input.bodyText ?? '').slice(0, 220) || null,
    bodyText: input.bodyText ?? '',
    bodyHtml: null,
    seenLocal: true,
  });
  const draftPathsJson = draftAttachmentPathsToJson(input.draftAttachmentPaths ?? []);
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET folder_kind = 'draft', draft_attachment_paths_json = ? WHERE id = ?`,
    )
    .run(draftPathsJson, id);
  return id;
}

/** Related messages for CRM thread view (ticket and/or linked customer). */
export function listConversationMessages(
  accountId: number,
  opts: {
    excludeMessageId?: number;
    ticketCode?: string | null;
    customerId?: number | null;
    limit?: number;
  },
): EmailMessageRow[] {
  return listConversationMessagesForScope(accountId, opts);
}

export function listConversationMessagesForScope(
  accountScope: number | 'all',
  opts: {
    excludeMessageId?: number;
    ticketCode?: string | null;
    customerId?: number | null;
    limit?: number;
  },
): EmailMessageRow[] {
  const limit = Math.min(opts.limit ?? 20, 50);
  const clauses: string[] = ['m.soft_deleted = 0'];
  const params: (string | number)[] = [];
  if (accountScope !== 'all') {
    clauses.push('m.account_id = ?');
    params.push(accountScope);
  }
  if (opts.excludeMessageId != null) {
    clauses.push('m.id != ?');
    params.push(opts.excludeMessageId);
  }
  const orParts: string[] = [];
  if (opts.ticketCode?.trim()) {
    orParts.push('m.ticket_code = ?');
    params.push(opts.ticketCode.trim());
  }
  if (opts.customerId != null && opts.customerId > 0) {
    orParts.push('m.customer_id = ?');
    params.push(opts.customerId);
  }
  if (orParts.length === 0) return [];
  clauses.push(`(${orParts.join(' OR ')})`);
  params.push(limit);
  const sql = `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
    WHERE ${clauses.join(' AND ')}
    ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
    LIMIT ?`;
  return getDb().prepare(sql).all(...params) as EmailMessageRow[];
}

type TrashSnapshotRow = {
  archived: number;
  is_spam: number;
  folder_kind: string;
  trash_prev_archived: number | null;
  trash_prev_is_spam: number | null;
  trash_prev_folder_kind: string | null;
};

/** Permanently remove a local compose draft (negative IMAP uid). Not recoverable. */
export function deleteLocalComposeDraft(messageId: number): void {
  const row = getEmailMessageById(messageId);
  if (!row) {
    throw new Error('Entwurf nicht gefunden');
  }
  if (row.uid >= 0) {
    throw new Error('Nur lokale Entwürfe können endgültig gelöscht werden');
  }
  getDb().prepare(`DELETE FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`).run(messageId);
}

export function setMessageSoftDeleted(messageId: number, deleted: boolean): void {
  const row = getDb()
    .prepare(
      `SELECT archived, is_spam, folder_kind, trash_prev_archived, trash_prev_is_spam, trash_prev_folder_kind
       FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
    )
    .get(messageId) as TrashSnapshotRow | undefined;
  if (!row) return;

  if (deleted) {
    getDb()
      .prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE}
         SET soft_deleted = 1,
             trash_prev_archived = ?,
             trash_prev_is_spam = ?,
             trash_prev_folder_kind = ?
         WHERE id = ?`,
      )
      .run(row.archived ?? 0, row.is_spam ?? 0, row.folder_kind ?? 'inbox', messageId);
    return;
  }

  const archived = row.trash_prev_archived ?? row.archived ?? 0;
  const isSpam = row.trash_prev_is_spam ?? row.is_spam ?? 0;
  const folderKind = row.trash_prev_folder_kind ?? row.folder_kind ?? 'inbox';
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET soft_deleted = 0,
           archived = ?,
           is_spam = ?,
           folder_kind = ?,
           trash_prev_archived = NULL,
           trash_prev_is_spam = NULL,
           trash_prev_folder_kind = NULL
       WHERE id = ?`,
    )
    .run(archived, isSpam, folderKind, messageId);
}

/** Move a message into a mail sidebar view (inbox, archive, spam, trash). */
export function moveMessageToMailView(messageId: number, view: AccountMailView): void {
  if (view === 'trash') {
    setMessageSoftDeleted(messageId, true);
    return;
  }
  const row = getEmailMessageById(messageId);
  if (!row) throw new Error('Nachricht nicht gefunden');
  if (row.uid < 0 && !row.pop3_uidl) {
    throw new Error('Entwürfe können nicht per Ordner verschoben werden');
  }

  switch (view) {
    case 'inbox':
      getDb()
        .prepare(
          `UPDATE ${EMAIL_MESSAGES_TABLE}
           SET soft_deleted = 0, archived = 0, is_spam = 0,
               folder_kind = 'inbox',
               trash_prev_archived = NULL, trash_prev_is_spam = NULL, trash_prev_folder_kind = NULL
           WHERE id = ?`,
        )
        .run(messageId);
      break;
    case 'archived':
      getDb()
        .prepare(
          `UPDATE ${EMAIL_MESSAGES_TABLE}
           SET soft_deleted = 0, archived = 1, is_spam = 0,
               trash_prev_archived = NULL, trash_prev_is_spam = NULL, trash_prev_folder_kind = NULL
           WHERE id = ?`,
        )
        .run(messageId);
      break;
    case 'spam':
      getDb()
        .prepare(
          `UPDATE ${EMAIL_MESSAGES_TABLE}
           SET soft_deleted = 0, archived = 0, is_spam = 1,
               trash_prev_archived = NULL, trash_prev_is_spam = NULL, trash_prev_folder_kind = NULL
           WHERE id = ?`,
        )
        .run(messageId);
      break;
    case 'sent':
    case 'drafts':
    case 'all':
      throw new Error('Dieser Ordner unterstützt kein Verschieben per Drag & Drop');
    default:
      break;
  }
}

export function markDraftAsSent(draftMessageId: number): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET folder_kind = 'sent', outbound_hold = 0, archived = 0 WHERE id = ?`,
    )
    .run(draftMessageId);
}

export function updateComposeDraft(
  messageId: number,
  input: {
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    toJson?: string | null;
    ccJson?: string | null;
    bccJson?: string | null;
    draftAttachmentPaths?: string[];
  },
): void {
  const row = getEmailMessageById(messageId);
  if (!row || row.uid >= 0) {
    throw new Error('Nur lokale Entwürfe (negative UID) können hier bearbeitet werden');
  }
  const subj = input.subject !== undefined ? input.subject : row.subject;
  const body = input.bodyText !== undefined ? input.bodyText : row.body_text ?? '';
  const html =
    input.bodyHtml !== undefined ? input.bodyHtml : row.body_html;
  const snippet = body.trim() ? (body.length > 220 ? `${body.slice(0, 217)}...` : body) : row.snippet;
  const sets: string[] = ['subject = ?', 'body_text = ?', 'snippet = ?'];
  const vals: unknown[] = [subj, body, snippet];
  if (input.bodyHtml !== undefined) { sets.push('body_html = ?'); vals.push(html); }
  if (input.toJson !== undefined) { sets.push('to_json = ?'); vals.push(input.toJson); }
  if (input.ccJson !== undefined) { sets.push('cc_json = ?'); vals.push(input.ccJson); }
  if (input.bccJson !== undefined) { sets.push('bcc_json = ?'); vals.push(input.bccJson); }
  if (input.draftAttachmentPaths !== undefined) {
    sets.push('draft_attachment_paths_json = ?');
    vals.push(draftAttachmentPathsToJson(input.draftAttachmentPaths));
  }
  vals.push(messageId);
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}
