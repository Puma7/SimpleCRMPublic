/** SQLite mock with SQL-aware stmt handlers for email-store tests. */
import { createSqliteMock, type StmtMock } from './sqlite-mock';

export type SqliteEmailStoreMock = ReturnType<typeof createSqliteEmailStoreMock>;

export function createSqliteEmailStoreMock() {
  const base = createSqliteMock();
  const { db, stmt } = base;
  let lastSql = '';

  const accountRow = {
    id: 1,
    display_name: 'Test',
    email_address: 'a@b.de',
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_tls: 1,
    imap_username: 'a@b.de',
    keytar_account_key: 'k1',
    smtp_host: null,
    smtp_port: 587,
    smtp_tls: 1,
    smtp_username: null,
    smtp_use_imap_auth: 1,
    smtp_keytar_account_key: null,
    protocol: 'imap',
    pop3_host: null,
    pop3_port: 995,
    pop3_tls: 1,
    oauth_provider: null,
    oauth_refresh_keytar_key: null,
    sent_folder_path: 'Sent',
    imap_sync_seen_on_open: 1,
    vacation_enabled: 0,
    vacation_subject: null,
    vacation_body_text: null,
    request_read_receipt: 0,
    created_at: 't',
    updated_at: 't',
  };

  const folderRow = {
    id: 10,
    account_id: 1,
    path: 'INBOX',
    last_uid: 5,
    uidvalidity: 1,
    uidvalidity_str: '1',
    created_at: 't',
    updated_at: 't',
  };

  const messageRow = {
    id: 100,
    account_id: 1,
    folder_id: 10,
    uid: 6,
    message_id: '<m@x>',
    in_reply_to: null,
    references_header: null,
    subject: 'Subj',
    from_json: '[]',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: null,
    date_received: '2024-01-01',
    snippet: 'hi',
    body_text: 'body',
    body_html: null,
    seen_local: 0,
    imap_thread_id: null,
    has_attachments: 0,
    attachments_json: null,
    pop3_uidl: null,
    raw_headers: null,
    raw_rfc822_b64: null,
    thread_id: null,
    ticket_code: null,
    customer_id: null,
    assigned_to: null,
    folder_kind: 'inbox',
    archived: 0,
    spam: 0,
    soft_deleted: 0,
    outbound_hold: 0,
    outbound_hold_reason: null,
    post_process_done: 0,
    created_at: 't',
  };

  function routeGet(): unknown {
    if (lastSql.includes('MIN(uid)') || lastSql.includes('MIN(uid)')) {
      return { m: -1_000_001 };
    }
    if (lastSql.includes('COUNT(*)') && lastSql.includes('EMAIL_ACCOUNTS')) return { c: 1 };
    if (lastSql.includes('FROM email_accounts') || lastSql.includes('EMAIL_ACCOUNTS')) {
      return accountRow;
    }
    if (lastSql.includes('email_folders') || lastSql.includes('EMAIL_FOLDERS')) {
      return folderRow;
    }
    if (lastSql.includes('email_messages') || lastSql.includes('EMAIL_MESSAGES')) {
      if (lastSql.includes('SELECT id FROM') && lastSql.includes('pop3_uidl')) return undefined;
      if (lastSql.includes('SELECT id FROM') && lastSql.includes('uid =')) return undefined;
      return messageRow;
    }
    if (lastSql.includes('email_team_members')) return undefined;
    if (lastSql.includes('has_attachments')) return { has_attachments: 0, attachments_json: null };
    return undefined;
  }

  function routeAll(): unknown[] {
    if (lastSql.includes('email_accounts')) return [accountRow];
    if (lastSql.includes('email_team_members')) return [];
    if (lastSql.includes('email_folders')) return [folderRow];
    if (lastSql.includes('email_messages')) return [messageRow];
    if (lastSql.includes('workflow_id')) return [];
    if (lastSql.includes('tag')) return [];
    if (lastSql.includes('pop3_uidl')) return [];
    if (lastSql.includes('uid IN')) return [];
    return [];
  }

  db.prepare.mockImplementation((sql: string) => {
    lastSql = sql;
    return stmt;
  });

  stmt.get.mockImplementation(() => routeGet());
  stmt.all.mockImplementation(() => routeAll());
  stmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 101 }));

  return {
    ...base,
    accountRow,
    folderRow,
    messageRow,
    setLastSql: (s: string) => {
      lastSql = s;
    },
    resetStmt: (overrides?: Partial<StmtMock>) => {
      stmt.get.mockImplementation(() => routeGet());
      stmt.all.mockImplementation(() => routeAll());
      stmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 101 }));
      Object.assign(stmt, overrides);
    },
  };
}
