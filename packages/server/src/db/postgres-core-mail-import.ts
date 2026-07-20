export type CoreMailImportPgClient = Readonly<{
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
}>;

export type CoreMailImportInput = Readonly<{
  workspaceId: string;
  runId: string;
}>;

export type CoreMailImportCommand = Readonly<{
  tableName: string;
  sql: string;
  params: readonly unknown[];
}>;

const mailTableOrder = [
  'email_accounts',
  'email_account_mail_settings',
  'email_folders',
  'email_team_members',
  'email_threads',
  'email_messages',
  'email_message_attachments',
  'email_message_tags',
  'email_categories',
  'email_message_categories',
  'email_internal_notes',
  'email_canned_responses',
  'email_account_signatures',
  'email_remote_content_allowlist',
  'email_read_receipt_log',
  'email_thread_edges',
  'email_thread_aliases',
] as const;

export async function runPostgresCoreMailImport(
  client: CoreMailImportPgClient,
  input: CoreMailImportInput,
): Promise<void> {
  for (const command of buildCoreMailImportCommands(input)) {
    await client.query(command.sql, command.params);
  }
}

export function buildCoreMailImportCommands(input: CoreMailImportInput): readonly CoreMailImportCommand[] {
  if (!input.workspaceId.trim()) {
    throw new Error('workspaceId is required for core mail import');
  }
  if (!input.runId.trim()) {
    throw new Error('runId is required for core mail import');
  }

  return mailTableOrder.map((tableName) => ({
    tableName,
    sql: mailImportSqlByTable[tableName],
    params: [input.workspaceId, tableName, input.runId],
  }));
}

const rowsFrom = 'FROM sqlite_import_rows r';

const rowsWhere = `WHERE r.workspace_id = $1
  AND r.table_name = $2
  AND r.imported_in_run_id = $3`;

const rowsFilter = `${rowsFrom}
${rowsWhere}`;

const idRowsFilter = `${rowsFilter}
  AND r.source_row ? 'id'`;

const mailImportSqlByTable: Record<typeof mailTableOrder[number], string> = {
  email_accounts: `INSERT INTO email_accounts (
  workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_port, imap_tls,
  imap_username, keytar_account_key, imap_password_secret_id, smtp_host, smtp_port, smtp_tls, smtp_username,
  smtp_use_imap_auth, smtp_keytar_account_key, smtp_password_secret_id, protocol, pop3_host, pop3_port, pop3_tls,
  oauth_provider, oauth_refresh_keytar_key, oauth_refresh_secret_id, sent_folder_path, sync_spam_folder_path,
  sync_archive_folder_path, imap_sync_sent, imap_sync_archive, imap_sync_spam, imap_sync_seen_on_open,
  vacation_enabled, vacation_subject, vacation_body_text, request_read_receipt,
  default_remote_content_policy, respond_to_read_receipts, read_receipt_trusted_domains,
  imap_delete_opt_in, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, COALESCE(NULLIF(r.source_row->>'display_name', ''), r.source_row->>'email_address'),
  COALESCE(NULLIF(r.source_row->>'email_address', ''), 'unknown@example.invalid'),
  COALESCE(NULLIF(r.source_row->>'imap_host', ''), 'localhost'),
  COALESCE(NULLIF(r.source_row->>'imap_port', '')::integer, 993),
  COALESCE(${sqliteBoolean('imap_tls')}, true),
  COALESCE(NULLIF(r.source_row->>'imap_username', ''), r.source_row->>'email_address', ''),
  NULLIF(r.source_row->>'keytar_account_key', ''),
  NULL::uuid,
  NULLIF(r.source_row->>'smtp_host', ''),
  NULLIF(r.source_row->>'smtp_port', '')::integer,
  COALESCE(${sqliteBoolean('smtp_tls')}, true),
  NULLIF(r.source_row->>'smtp_username', ''),
  COALESCE(${sqliteBoolean('smtp_use_imap_auth')}, true),
  NULLIF(r.source_row->>'smtp_keytar_account_key', ''),
  NULL::uuid,
  COALESCE(NULLIF(r.source_row->>'protocol', ''), 'imap'),
  NULLIF(r.source_row->>'pop3_host', ''),
  NULLIF(r.source_row->>'pop3_port', '')::integer,
  COALESCE(${sqliteBoolean('pop3_tls')}, true),
  NULLIF(r.source_row->>'oauth_provider', ''),
  NULLIF(r.source_row->>'oauth_refresh_keytar_key', ''),
  NULL::uuid,
  COALESCE(NULLIF(r.source_row->>'sent_folder_path', ''), 'Sent'),
  NULLIF(r.source_row->>'sync_spam_folder_path', ''),
  NULLIF(r.source_row->>'sync_archive_folder_path', ''),
  COALESCE(${sqliteBoolean('imap_sync_sent')}, false),
  COALESCE(${sqliteBoolean('imap_sync_archive')}, false),
  COALESCE(${sqliteBoolean('imap_sync_spam')}, false),
  COALESCE(${sqliteBoolean('imap_sync_seen_on_open')}, true),
  COALESCE(${sqliteBoolean('vacation_enabled')}, false),
  NULLIF(r.source_row->>'vacation_subject', ''),
  NULLIF(r.source_row->>'vacation_body_text', ''),
  COALESCE(${sqliteBoolean('request_read_receipt')}, false),
  COALESCE(NULLIF(r.source_row->>'default_remote_content_policy', ''), 'blocked'),
  COALESCE(NULLIF(r.source_row->>'respond_to_read_receipts', ''), 'never'),
  NULLIF(r.source_row->>'read_receipt_trusted_domains', ''),
  COALESCE(${sqliteBoolean('imap_delete_opt_in')}, false),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${idRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email_address = EXCLUDED.email_address,
  imap_host = EXCLUDED.imap_host,
  imap_port = EXCLUDED.imap_port,
  imap_tls = EXCLUDED.imap_tls,
  imap_username = EXCLUDED.imap_username,
  keytar_account_key = EXCLUDED.keytar_account_key,
  smtp_host = EXCLUDED.smtp_host,
  smtp_port = EXCLUDED.smtp_port,
  smtp_tls = EXCLUDED.smtp_tls,
  smtp_username = EXCLUDED.smtp_username,
  smtp_use_imap_auth = EXCLUDED.smtp_use_imap_auth,
  smtp_keytar_account_key = EXCLUDED.smtp_keytar_account_key,
  protocol = EXCLUDED.protocol,
  pop3_host = EXCLUDED.pop3_host,
  pop3_port = EXCLUDED.pop3_port,
  pop3_tls = EXCLUDED.pop3_tls,
  oauth_provider = EXCLUDED.oauth_provider,
  oauth_refresh_keytar_key = EXCLUDED.oauth_refresh_keytar_key,
  sent_folder_path = EXCLUDED.sent_folder_path,
  sync_spam_folder_path = EXCLUDED.sync_spam_folder_path,
  sync_archive_folder_path = EXCLUDED.sync_archive_folder_path,
  imap_sync_sent = EXCLUDED.imap_sync_sent,
  imap_sync_archive = EXCLUDED.imap_sync_archive,
  imap_sync_spam = EXCLUDED.imap_sync_spam,
  imap_sync_seen_on_open = EXCLUDED.imap_sync_seen_on_open,
  vacation_enabled = EXCLUDED.vacation_enabled,
  vacation_subject = EXCLUDED.vacation_subject,
  vacation_body_text = EXCLUDED.vacation_body_text,
  request_read_receipt = EXCLUDED.request_read_receipt,
  default_remote_content_policy = EXCLUDED.default_remote_content_policy,
  respond_to_read_receipts = EXCLUDED.respond_to_read_receipts,
  read_receipt_trusted_domains = EXCLUDED.read_receipt_trusted_domains,
  imap_delete_opt_in = EXCLUDED.imap_delete_opt_in,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_account_mail_settings: `INSERT INTO email_account_mail_settings (
  workspace_id, account_source_sqlite_id, account_id, ticket_prefix, ticket_next_number,
  ticket_number_padding, thread_namespace, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'account_id')::bigint, a.id,
  COALESCE(NULLIF(r.source_row->>'ticket_prefix', ''), 'ACC' || (r.source_row->>'account_id')),
  COALESCE(NULLIF(r.source_row->>'ticket_next_number', '')::bigint, 1),
  COALESCE(NULLIF(r.source_row->>'ticket_number_padding', '')::integer, 6),
  COALESCE(NULLIF(r.source_row->>'thread_namespace', ''), 'account:' || (r.source_row->>'account_id')),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = (r.source_row->>'account_id')::bigint
${rowsWhere}
  AND r.source_row ? 'account_id'
ON CONFLICT (workspace_id, account_source_sqlite_id)
DO UPDATE SET
  account_id = EXCLUDED.account_id,
  ticket_prefix = EXCLUDED.ticket_prefix,
  ticket_next_number = EXCLUDED.ticket_next_number,
  ticket_number_padding = EXCLUDED.ticket_number_padding,
  thread_namespace = EXCLUDED.thread_namespace,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_folders: `INSERT INTO email_folders (
  workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path, delimiter,
  uidvalidity, uidvalidity_str, last_uid, last_synced_at, pop3_uidl_str,
  source_row, imported_in_run_id, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'account_id')::bigint, a.id,
  COALESCE(NULLIF(r.source_row->>'path', ''), 'INBOX'),
  COALESCE(NULLIF(r.source_row->>'delimiter', ''), '/'),
  NULLIF(r.source_row->>'uidvalidity', '')::bigint,
  NULLIF(r.source_row->>'uidvalidity_str', ''),
  COALESCE(NULLIF(r.source_row->>'last_uid', '')::bigint, 0),
  NULLIF(r.source_row->>'last_synced_at', '')::timestamptz,
  NULLIF(r.source_row->>'pop3_uidl_str', ''),
  r.source_row, $3, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = (r.source_row->>'account_id')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  path = EXCLUDED.path,
  delimiter = EXCLUDED.delimiter,
  uidvalidity = EXCLUDED.uidvalidity,
  uidvalidity_str = EXCLUDED.uidvalidity_str,
  last_uid = EXCLUDED.last_uid,
  last_synced_at = EXCLUDED.last_synced_at,
  pop3_uidl_str = EXCLUDED.pop3_uidl_str,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  email_team_members: `INSERT INTO email_team_members (
  workspace_id, id, display_name, role, signature_html, sort_order,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, r.source_row->>'id', COALESCE(NULLIF(r.source_row->>'display_name', ''), r.source_row->>'id'),
  COALESCE(NULLIF(r.source_row->>'role', ''), 'agent'),
  NULLIF(r.source_row->>'signature_html', ''),
  COALESCE(NULLIF(r.source_row->>'sort_order', '')::integer, 0),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${idRowsFilter}
ON CONFLICT (workspace_id, id)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  signature_html = EXCLUDED.signature_html,
  sort_order = EXCLUDED.sort_order,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_threads: `INSERT INTO email_threads (
  workspace_id, id, ticket_code, account_source_sqlite_id, account_id, root_message_source_sqlite_id, root_message_id, last_message_at,
  message_count, has_unread, has_attachments, subject_normalized,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, r.source_row->>'id', COALESCE(NULLIF(r.source_row->>'ticket_code', ''), r.source_row->>'id'),
  NULLIF(r.source_row->>'account_id', '')::bigint, a.id,
  NULLIF(r.source_row->>'root_message_id', '')::bigint, m.id,
  NULLIF(r.source_row->>'last_message_at', '')::timestamptz,
  COALESCE(NULLIF(r.source_row->>'message_count', '')::integer, 0),
  COALESCE(${sqliteBoolean('has_unread')}, false),
  COALESCE(${sqliteBoolean('has_attachments')}, false),
  NULLIF(r.source_row->>'subject_normalized', ''),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = NULLIF(r.source_row->>'root_message_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, id)
DO UPDATE SET
  ticket_code = EXCLUDED.ticket_code,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  root_message_source_sqlite_id = EXCLUDED.root_message_source_sqlite_id,
  root_message_id = EXCLUDED.root_message_id,
  last_message_at = EXCLUDED.last_message_at,
  message_count = EXCLUDED.message_count,
  has_unread = EXCLUDED.has_unread,
  has_attachments = EXCLUDED.has_attachments,
  subject_normalized = EXCLUDED.subject_normalized,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_messages: `INSERT INTO email_messages (
  workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id, account_id, folder_id,
  uid, message_id, in_reply_to, references_header, subject, from_json, to_json, cc_json, bcc_json,
  date_received, snippet, body_text, body_html, seen_local, done_local, sent_imap_sync_failed,
  archived, soft_deleted, trash_prev_archived, trash_prev_is_spam, trash_prev_folder_kind,
  outbound_hold, outbound_block_reason, thread_id, ticket_code,
  customer_source_sqlite_id, customer_id, folder_kind, imap_thread_id, has_attachments,
  attachments_json, auth_spf, auth_dkim, auth_dmarc, auth_arc, auth_dkim_domains,
  auth_error, rspamd_score, rspamd_action, rspamd_symbols, rspamd_error, security_checked_at,
  draft_attachment_paths_json, post_process_done, reply_parent_message_id,
  assigned_to, legacy_assigned_to_user_id, assigned_to_user_id, is_spam, spam_status, spam_score,
  spam_score_label, spam_decision_source, spam_score_breakdown_json, spam_decided_at,
  snoozed_until, scheduled_send_at, reply_suggestion_text, reply_suggestion_status,
  reply_suggestion_error, reply_suggestion_updated_at,
  pop3_uidl, raw_headers, raw_rfc822_b64, remote_content_policy, read_receipt_requested,
  pgp_status, pgp_signer_fingerprint, thread_confidence, thread_resolver_version,
  normalized_subject, server_thread_source, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'account_id')::bigint, (r.source_row->>'folder_id')::bigint,
  a.id, f.id, COALESCE(NULLIF(r.source_row->>'uid', '')::bigint, 0),
  NULLIF(r.source_row->>'message_id', ''), NULLIF(r.source_row->>'in_reply_to', ''),
  NULLIF(r.source_row->>'references_header', ''), NULLIF(r.source_row->>'subject', ''),
  ${jsonbField('from_json')}, ${jsonbField('to_json')}, ${jsonbField('cc_json')}, ${jsonbField('bcc_json')},
  NULLIF(r.source_row->>'date_received', '')::timestamptz,
  NULLIF(r.source_row->>'snippet', ''), NULLIF(r.source_row->>'body_text', ''), NULLIF(r.source_row->>'body_html', ''),
  COALESCE(${sqliteBoolean('seen_local')}, false), COALESCE(${sqliteBoolean('done_local')}, false),
  COALESCE(${sqliteBoolean('sent_imap_sync_failed')}, false), COALESCE(${sqliteBoolean('archived')}, false),
  COALESCE(${sqliteBoolean('soft_deleted')}, false),
  ${sqliteBoolean('trash_prev_archived')}, ${sqliteBoolean('trash_prev_is_spam')},
  NULLIF(r.source_row->>'trash_prev_folder_kind', ''),
  COALESCE(${sqliteBoolean('outbound_hold')}, false),
  NULLIF(r.source_row->>'outbound_block_reason', ''), NULLIF(r.source_row->>'thread_id', ''),
  NULLIF(r.source_row->>'ticket_code', ''), NULLIF(r.source_row->>'customer_id', '')::bigint, c.id,
  COALESCE(NULLIF(r.source_row->>'folder_kind', ''), 'inbox'), NULLIF(r.source_row->>'imap_thread_id', ''),
  COALESCE(${sqliteBoolean('has_attachments')}, false), ${jsonbField('attachments_json')},
  NULLIF(r.source_row->>'auth_spf', ''), NULLIF(r.source_row->>'auth_dkim', ''),
  NULLIF(r.source_row->>'auth_dmarc', ''), NULLIF(r.source_row->>'auth_arc', ''),
  NULLIF(r.source_row->>'auth_dkim_domains', ''),
  NULLIF(r.source_row->>'auth_error', ''),
  NULLIF(r.source_row->>'rspamd_score', '')::double precision,
  NULLIF(r.source_row->>'rspamd_action', ''),
  NULLIF(r.source_row->>'rspamd_symbols', ''),
  NULLIF(r.source_row->>'rspamd_error', ''),
  NULLIF(r.source_row->>'security_checked_at', '')::timestamptz,
  NULLIF(r.source_row->>'draft_attachment_paths_json', ''),
  COALESCE(${sqliteBoolean('post_process_done')}, false),
  (SELECT p.id FROM email_messages p
    WHERE p.workspace_id = $1
      AND p.source_sqlite_id = NULLIF(r.source_row->>'reply_parent_message_id', '')::bigint
    LIMIT 1),
  NULLIF(r.source_row->>'assigned_to', ''),
  NULLIF(r.source_row->>'assigned_to_user_id', ''),
  NULL,
  COALESCE(${sqliteBoolean('is_spam')}, false), COALESCE(NULLIF(r.source_row->>'spam_status', ''), 'clean'),
  NULLIF(r.source_row->>'spam_score', '')::integer, NULLIF(r.source_row->>'spam_score_label', ''),
  NULLIF(r.source_row->>'spam_decision_source', ''), ${jsonbField('spam_score_breakdown_json')},
  NULLIF(r.source_row->>'spam_decided_at', '')::timestamptz,
  NULLIF(r.source_row->>'snoozed_until', '')::timestamptz,
  NULLIF(r.source_row->>'scheduled_send_at', '')::timestamptz,
  NULLIF(r.source_row->>'reply_suggestion_text', ''),
  NULLIF(r.source_row->>'reply_suggestion_status', ''),
  NULLIF(r.source_row->>'reply_suggestion_error', ''),
  NULLIF(r.source_row->>'reply_suggestion_updated_at', '')::timestamptz,
  NULLIF(r.source_row->>'pop3_uidl', ''),
  NULLIF(r.source_row->>'raw_headers', ''), NULLIF(r.source_row->>'raw_rfc822_b64', ''),
  COALESCE(NULLIF(r.source_row->>'remote_content_policy', ''), 'blocked'),
  COALESCE(${sqliteBoolean('read_receipt_requested')}, false),
  NULLIF(r.source_row->>'pgp_status', ''), NULLIF(r.source_row->>'pgp_signer_fingerprint', ''),
  NULLIF(r.source_row->>'thread_confidence', ''),
  COALESCE(NULLIF(r.source_row->>'thread_resolver_version', '')::integer, 0),
  NULLIF(r.source_row->>'normalized_subject', ''), NULLIF(r.source_row->>'server_thread_source', ''),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = (r.source_row->>'account_id')::bigint
LEFT JOIN email_folders f
  ON f.workspace_id = $1
 AND f.source_sqlite_id = (r.source_row->>'folder_id')::bigint
LEFT JOIN customers c
  ON c.workspace_id = $1
 AND c.source_sqlite_id = NULLIF(r.source_row->>'customer_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  folder_source_sqlite_id = EXCLUDED.folder_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  folder_id = EXCLUDED.folder_id,
  uid = EXCLUDED.uid,
  message_id = EXCLUDED.message_id,
  subject = EXCLUDED.subject,
  from_json = EXCLUDED.from_json,
  to_json = EXCLUDED.to_json,
  cc_json = EXCLUDED.cc_json,
  bcc_json = EXCLUDED.bcc_json,
  date_received = EXCLUDED.date_received,
  snippet = EXCLUDED.snippet,
  body_text = EXCLUDED.body_text,
  body_html = EXCLUDED.body_html,
  archived = EXCLUDED.archived,
  soft_deleted = EXCLUDED.soft_deleted,
  trash_prev_archived = EXCLUDED.trash_prev_archived,
  trash_prev_is_spam = EXCLUDED.trash_prev_is_spam,
  trash_prev_folder_kind = EXCLUDED.trash_prev_folder_kind,
  folder_kind = EXCLUDED.folder_kind,
  attachments_json = EXCLUDED.attachments_json,
  auth_spf = EXCLUDED.auth_spf,
  auth_dkim = EXCLUDED.auth_dkim,
  auth_dmarc = EXCLUDED.auth_dmarc,
  auth_arc = EXCLUDED.auth_arc,
  auth_dkim_domains = EXCLUDED.auth_dkim_domains,
  auth_error = EXCLUDED.auth_error,
  rspamd_score = EXCLUDED.rspamd_score,
  rspamd_action = EXCLUDED.rspamd_action,
  rspamd_symbols = EXCLUDED.rspamd_symbols,
  rspamd_error = EXCLUDED.rspamd_error,
  security_checked_at = EXCLUDED.security_checked_at,
  draft_attachment_paths_json = EXCLUDED.draft_attachment_paths_json,
  post_process_done = EXCLUDED.post_process_done,
  reply_parent_message_id = EXCLUDED.reply_parent_message_id,
  assigned_to = EXCLUDED.assigned_to,
  legacy_assigned_to_user_id = EXCLUDED.legacy_assigned_to_user_id,
  assigned_to_user_id = EXCLUDED.assigned_to_user_id,
  is_spam = EXCLUDED.is_spam,
  spam_status = EXCLUDED.spam_status,
  snoozed_until = EXCLUDED.snoozed_until,
  scheduled_send_at = EXCLUDED.scheduled_send_at,
  scheduled_send_actor_user_id = NULL,
  scheduled_send_trusted_service_principal = NULL,
  reply_suggestion_text = EXCLUDED.reply_suggestion_text,
  reply_suggestion_status = EXCLUDED.reply_suggestion_status,
  reply_suggestion_error = EXCLUDED.reply_suggestion_error,
  reply_suggestion_updated_at = EXCLUDED.reply_suggestion_updated_at,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  email_message_attachments: messageChildSql('email_message_attachments', [
    'filename_display', 'content_type', 'size_bytes', 'storage_path', 'content_sha256',
  ], `COALESCE(NULLIF(r.source_row->>'filename_display', ''), 'attachment'),
  NULLIF(r.source_row->>'content_type', ''),
  COALESCE(NULLIF(r.source_row->>'size_bytes', '')::bigint, 0),
  COALESCE(NULLIF(r.source_row->>'storage_path', ''), ''),
  NULLIF(r.source_row->>'content_sha256', '')`),
  email_message_tags: messageChildSql('email_message_tags', ['tag'], `COALESCE(NULLIF(r.source_row->>'tag', ''), 'untagged')`),
  email_categories: `INSERT INTO email_categories (
  workspace_id, source_sqlite_id, parent_source_sqlite_id, parent_id, name, sort_order,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, NULLIF(r.source_row->>'parent_id', '')::bigint,
  p.id, COALESCE(NULLIF(r.source_row->>'name', ''), 'Category ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'sort_order', '')::integer, 0),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_categories p
  ON p.workspace_id = $1
 AND p.source_sqlite_id = NULLIF(r.source_row->>'parent_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  parent_source_sqlite_id = EXCLUDED.parent_source_sqlite_id,
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_message_categories: messageCategorySql(),
  email_internal_notes: messageChildSql('email_internal_notes', ['body'], `COALESCE(NULLIF(r.source_row->>'body', ''), '')`),
  email_canned_responses: `INSERT INTO email_canned_responses (
  workspace_id, source_sqlite_id, title, body, account_source_sqlite_id, account_id, override_key,
  sort_order, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, COALESCE(NULLIF(r.source_row->>'title', ''), 'Response ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'body', ''), ''),
  NULLIF(r.source_row->>'account_id', '')::bigint, a.id, NULLIF(r.source_row->>'override_key', ''),
  COALESCE(NULLIF(r.source_row->>'sort_order', '')::integer, 0),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  override_key = EXCLUDED.override_key,
  sort_order = EXCLUDED.sort_order,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_account_signatures: `INSERT INTO email_account_signatures (
  workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, signature_html,
  source_row, imported_in_run_id, updated_at
)
SELECT
  $1, r.source_pk::bigint, (r.source_row->>'account_id')::bigint, a.id,
  NULLIF(r.source_row->>'signature_html', ''), r.source_row, $3, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = (r.source_row->>'account_id')::bigint
${rowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  signature_html = EXCLUDED.signature_html,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  email_remote_content_allowlist: simpleIdTableSql('email_remote_content_allowlist', ['scope', 'value'], [
    "COALESCE(NULLIF(r.source_row->>'scope', ''), 'sender')",
    "COALESCE(NULLIF(r.source_row->>'value', ''), '')",
  ]),
  email_read_receipt_log: messageChildSql('email_read_receipt_log', ['direction', 'recipient', 'at'], `COALESCE(NULLIF(r.source_row->>'direction', ''), 'inbound'),
  NULLIF(r.source_row->>'recipient', ''),
  NULLIF(r.source_row->>'at', '')::timestamptz`),
  email_thread_edges: threadEdgeSql(),
  email_thread_aliases: `INSERT INTO email_thread_aliases (
  workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, alias_thread_id, canonical_thread_id, confidence, source,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, r.source_pk::bigint, NULLIF(r.source_row->>'account_id', '')::bigint, a.id,
  r.source_row->>'alias_thread_id', r.source_row->>'canonical_thread_id',
  COALESCE(NULLIF(r.source_row->>'confidence', ''), 'high'),
  COALESCE(NULLIF(r.source_row->>'source', ''), 'manual'),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
${rowsWhere}
  AND NULLIF(r.source_row->>'alias_thread_id', '') IS NOT NULL
  AND NULLIF(r.source_row->>'canonical_thread_id', '') IS NOT NULL
  AND r.source_row->>'alias_thread_id' <> r.source_row->>'canonical_thread_id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  alias_thread_id = EXCLUDED.alias_thread_id,
  canonical_thread_id = EXCLUDED.canonical_thread_id,
  confidence = EXCLUDED.confidence,
  source = EXCLUDED.source,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
};

function sqliteBoolean(fieldName: string): string {
  return `CASE lower(NULLIF(r.source_row->>'${fieldName}', ''))
    WHEN '1' THEN true
    WHEN 'true' THEN true
    WHEN 'yes' THEN true
    WHEN '0' THEN false
    WHEN 'false' THEN false
    WHEN 'no' THEN false
    ELSE NULL
  END`;
}

function jsonbField(fieldName: string): string {
  return `CASE WHEN NULLIF(r.source_row->>'${fieldName}', '') IS NULL THEN NULL ELSE (r.source_row->>'${fieldName}')::jsonb END`;
}

function messageChildSql(tableName: string, columns: readonly string[], selectSql: string): string {
  return `INSERT INTO ${tableName} (
  workspace_id, source_sqlite_id, message_source_sqlite_id, message_id, ${columns.join(', ')},
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, r.source_pk::bigint, (r.source_row->>'message_id')::bigint, m.id,
  ${selectSql},
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = (r.source_row->>'message_id')::bigint
${rowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  message_id = EXCLUDED.message_id,
  ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(',\n  ')},
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function messageCategorySql(): string {
  return `INSERT INTO email_message_categories (
  workspace_id, source_sqlite_id, message_source_sqlite_id, category_source_sqlite_id,
  message_id, category_id, source_row, imported_in_run_id, updated_at
)
SELECT
  $1, r.source_pk::bigint, (r.source_row->>'message_id')::bigint, (r.source_row->>'category_id')::bigint,
  m.id, c.id, r.source_row, $3, now()
${rowsFrom}
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = (r.source_row->>'message_id')::bigint
LEFT JOIN email_categories c
  ON c.workspace_id = $1
 AND c.source_sqlite_id = (r.source_row->>'category_id')::bigint
${rowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  category_source_sqlite_id = EXCLUDED.category_source_sqlite_id,
  message_id = EXCLUDED.message_id,
  category_id = EXCLUDED.category_id,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`;
}

function simpleIdTableSql(tableName: string, columns: readonly string[], selects: readonly string[]): string {
  return `INSERT INTO ${tableName} (
  workspace_id, source_sqlite_id, ${columns.join(', ')}, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, ${selects.join(', ')}, r.source_row, $3,
  NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${idRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(',\n  ')},
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function threadEdgeSql(): string {
  return `INSERT INTO email_thread_edges (
  workspace_id, source_sqlite_id, parent_message_source_sqlite_id, child_message_source_sqlite_id,
  parent_message_id, child_message_id, source_row, imported_in_run_id, updated_at
)
SELECT
  $1, r.source_pk::bigint,
  (r.source_row->>'parent_message_id')::bigint,
  (r.source_row->>'child_message_id')::bigint,
  parent.id,
  child.id,
  r.source_row, $3, now()
${rowsFrom}
LEFT JOIN email_messages parent
  ON parent.workspace_id = $1
 AND parent.source_sqlite_id = (r.source_row->>'parent_message_id')::bigint
LEFT JOIN email_messages child
  ON child.workspace_id = $1
 AND child.source_sqlite_id = (r.source_row->>'child_message_id')::bigint
${rowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  parent_message_source_sqlite_id = EXCLUDED.parent_message_source_sqlite_id,
  child_message_source_sqlite_id = EXCLUDED.child_message_source_sqlite_id,
  parent_message_id = EXCLUDED.parent_message_id,
  child_message_id = EXCLUDED.child_message_id,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`;
}
