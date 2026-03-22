import { randomUUID } from 'crypto';
import { getDb } from '../sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_MESSAGE_TAGS_TABLE,
  EMAIL_MESSAGE_CATEGORIES_TABLE,
  EMAIL_TEAM_MEMBERS_TABLE,
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
  /** POP3 server UIDL when message came from POP3 (stable key). */
  pop3_uidl: string | null;
  created_at: string;
};

const ACCOUNT_SELECT = `id, display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key,
            smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth, smtp_keytar_account_key,
            COALESCE(protocol, 'imap') AS protocol, pop3_host, pop3_port, pop3_tls, oauth_provider, oauth_refresh_keytar_key,
            COALESCE(sent_folder_path, 'Sent') AS sent_folder_path,
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
}): { id: number; keytarAccountKey: string } {
  const keytarAccountKey = input.keytarAccountKey ?? `email-${randomUUID()}`;
  const now = new Date().toISOString();
  const proto = input.protocol ?? 'imap';
  const p3h = input.pop3Host?.trim() || null;
  const p3p = input.pop3Port ?? 995;
  const p3t = input.pop3Tls !== false ? 1 : 0;
  const stmt = getDb().prepare(
    `INSERT INTO ${EMAIL_ACCOUNTS_TABLE} (
      display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key,
      smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth, smtp_keytar_account_key,
      protocol, pop3_host, pop3_port, pop3_tls,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      smtp_host = COALESCE(?, smtp_host),
      smtp_port = COALESCE(?, smtp_port),
      smtp_tls = COALESCE(?, smtp_tls),
      smtp_username = COALESCE(?, smtp_username),
      smtp_use_imap_auth = COALESCE(?, smtp_use_imap_auth),
      smtp_keytar_account_key = COALESCE(?, smtp_keytar_account_key),
      protocol = COALESCE(?, protocol),
      pop3_host = COALESCE(?, pop3_host),
      pop3_port = COALESCE(?, pop3_port),
      pop3_tls = COALESCE(?, pop3_tls),
      oauth_provider = COALESCE(?, oauth_provider),
      oauth_refresh_keytar_key = COALESCE(?, oauth_refresh_keytar_key),
      sent_folder_path = COALESCE(?, sent_folder_path),
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
    input.smtpHost === undefined ? null : input.smtpHost,
    input.smtpPort ?? null,
    input.smtpTls === undefined ? null : input.smtpTls ? 1 : 0,
    input.smtpUsername === undefined ? null : input.smtpUsername,
    input.smtpUseImapAuth === undefined ? null : input.smtpUseImapAuth ? 1 : 0,
    input.smtpKeytarAccountKey === undefined ? null : input.smtpKeytarAccountKey,
    input.protocol ?? null,
    input.pop3Host === undefined ? null : input.pop3Host,
    input.pop3Port ?? null,
    input.pop3Tls === undefined ? null : input.pop3Tls ? 1 : 0,
    input.oauthProvider === undefined ? null : input.oauthProvider,
    input.oauthRefreshKeytarKey === undefined ? null : input.oauthRefreshKeytarKey,
    input.sentFolderPath === undefined ? null : input.sentFolderPath,
    now,
    id,
  );
}

export function setMessageAssignedTo(messageId: number, teamMemberId: string | null): void {
  getDb().prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET assigned_to = ? WHERE id = ?`).run(teamMemberId, messageId);
}

export type EmailTeamMemberRow = {
  id: string;
  display_name: string;
  role: string;
  sort_order: number;
  created_at: string;
};

export function listEmailTeamMembers(): EmailTeamMemberRow[] {
  const stmt = getDb().prepare(
    `SELECT id, display_name, role, sort_order, created_at FROM ${EMAIL_TEAM_MEMBERS_TABLE} ORDER BY sort_order ASC, display_name ASC`,
  );
  let rows = stmt.all() as EmailTeamMemberRow[];
  if (rows.length === 0) {
    upsertEmailTeamMember({ id: 'agent-1', displayName: 'Agent 1', role: 'agent', sortOrder: 0 });
    rows = stmt.all() as EmailTeamMemberRow[];
  }
  return rows;
}

export function upsertEmailTeamMember(input: {
  id: string;
  displayName: string;
  role?: string;
  sortOrder?: number;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_TEAM_MEMBERS_TABLE} (id, display_name, role, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         sort_order = excluded.sort_order`,
    )
    .run(
      input.id.trim(),
      input.displayName.trim(),
      input.role?.trim() || 'agent',
      input.sortOrder ?? 0,
      now,
    );
}

export function deleteEmailTeamMember(id: string): void {
  getDb().prepare(`DELETE FROM ${EMAIL_TEAM_MEMBERS_TABLE} WHERE id = ?`).run(id);
}

export async function deleteEmailAccountRecord(id: number): Promise<void> {
  const row = getEmailAccountById(id);
  if (row) {
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
    const stmt = getDb().prepare(
      `UPDATE ${EMAIL_FOLDERS_TABLE} SET
        delimiter = COALESCE(?, delimiter),
        uidvalidity = COALESCE(?, uidvalidity),
        uidvalidity_str = COALESCE(?, uidvalidity_str),
        last_uid = COALESCE(?, last_uid),
        pop3_uidl_str = COALESCE(?, pop3_uidl_str),
        last_synced_at = ?
      WHERE id = ?`,
    );
    stmt.run(
      input.delimiter ?? null,
      input.uidvalidity === undefined ? null : input.uidvalidity,
      input.uidvalidityStr === undefined ? null : input.uidvalidityStr,
      input.lastUid === undefined ? null : input.lastUid,
      input.pop3UidlStr === undefined ? null : input.pop3UidlStr,
      now,
      existing.id,
    );
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
  const stmt = getDb().prepare(
    `UPDATE ${EMAIL_FOLDERS_TABLE} SET
      last_uid = COALESCE(?, last_uid),
      uidvalidity = COALESCE(?, uidvalidity),
      uidvalidity_str = COALESCE(?, uidvalidity_str),
      pop3_uidl_str = COALESCE(?, pop3_uidl_str),
      last_synced_at = ?
    WHERE id = ?`,
  );
  stmt.run(
    input.lastUid === undefined ? null : input.lastUid,
    input.uidvalidity === undefined ? null : input.uidvalidity,
    input.uidvalidityStr === undefined ? null : input.uidvalidityStr,
    input.pop3UidlStr === undefined ? null : input.pop3UidlStr,
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
       AND (uid >= 0 OR pop3_uidl IS NOT NULL)
       AND (folder_kind = 'inbox' OR folder_kind IS NULL OR folder_kind = '')
       AND archived = 0
     ORDER BY datetime(COALESCE(date_received, created_at)) DESC
     LIMIT ? OFFSET ?`,
  );
  return stmt.all(folderId, limit, offset) as EmailMessageRow[];
}

export type AccountMailView = 'inbox' | 'sent' | 'archived' | 'drafts' | 'all';

export function listMessagesForAccountView(
  accountId: number,
  view: AccountMailView,
  opts: { limit?: number; offset?: number; categoryId?: number | null } = {},
): EmailMessageRow[] {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  let sql = `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m`;
  const params: (string | number)[] = [accountId];

  if (opts.categoryId != null && opts.categoryId > 0) {
    sql += ` INNER JOIN ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc ON mc.message_id = m.id AND mc.category_id = ?`;
    params.push(opts.categoryId);
  }

  sql += ` WHERE m.account_id = ? AND m.soft_deleted = 0`;
  const nonDraftMail = `(m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`;
  if (view === 'inbox') {
    sql += ` AND ${nonDraftMail} AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '') AND m.archived = 0`;
  } else if (view === 'sent') {
    sql += ` AND m.folder_kind = 'sent'`;
  } else if (view === 'archived') {
    sql += ` AND m.archived = 1 AND ${nonDraftMail}`;
  } else if (view === 'drafts') {
    sql += ` AND m.folder_kind = 'draft'`;
  } else {
    sql += ` AND ${nonDraftMail}`;
  }

  sql += ` ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return getDb().prepare(sql).all(...params) as EmailMessageRow[];
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
}): { id: number; isNew: boolean } {
  const hasAtt = input.hasAttachments ? 1 : 0;
  const attJson = input.attachmentsJson ?? null;
  const imapTid = input.imapThreadId ?? null;
  const pop3Uidl = input.pop3Uidl?.trim() || null;

  const db = getDb();

  let existingByUidl: { id: number } | undefined;
  if (pop3Uidl) {
    existingByUidl = db
      .prepare(
        `SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND pop3_uidl = ?`,
      )
      .get(input.accountId, input.folderId, pop3Uidl) as { id: number } | undefined;
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
          seen_local = MAX(seen_local, ?)
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
        byUidl.id,
      );
      return { id: byUidl.id, isNew: false };
    }
  }

  const uidForRow =
    pop3Uidl && !existingByUidl ? allocatePop3NegativeUid(input.accountId, input.folderId) : input.uid;

  const existing = db
    .prepare(`SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid = ?`)
    .get(input.accountId, input.folderId, uidForRow) as { id: number } | undefined;
  const isNew = !existing;

  const stmt = db.prepare(
    `INSERT INTO ${EMAIL_MESSAGES_TABLE} (
      account_id, folder_id, uid, message_id, in_reply_to, references_header,
      subject, from_json, to_json, cc_json, date_received, snippet, body_text, body_html, seen_local,
      imap_thread_id, has_attachments, attachments_json, pop3_uidl,
      thread_id, ticket_code, customer_id, folder_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'inbox')
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
  );
  const row = db
    .prepare(`SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id = ? AND folder_id = ? AND uid = ?`)
    .get(input.accountId, input.folderId, input.uid) as { id: number } | undefined;
  const id = row?.id ?? (result.lastInsertRowid ? Number(result.lastInsertRowid) : 0);
  return { id, isNew };
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
}): number {
  const folder = getFolderByAccountAndPath(input.accountId, 'INBOX');
  if (!folder) {
    throw new Error('INBOX für dieses Konto nicht gefunden. Bitte zuerst synchronisieren.');
  }
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
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET folder_kind = 'draft' WHERE id = ?`)
    .run(id);
  return id;
}

export function setMessageSoftDeleted(messageId: number, deleted: boolean): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET soft_deleted = ? WHERE id = ?`)
    .run(deleted ? 1 : 0, messageId);
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
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET
        subject = ?,
        body_text = ?,
        body_html = COALESCE(?, body_html),
        snippet = ?,
        to_json = COALESCE(?, to_json),
        cc_json = COALESCE(?, cc_json)
      WHERE id = ?`,
    )
    .run(subj, body, html, snippet, input.toJson ?? null, input.ccJson ?? null, messageId);
}
