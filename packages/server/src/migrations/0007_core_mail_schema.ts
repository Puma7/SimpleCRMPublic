import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'email_accounts',
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
  'email_account_mail_settings',
  'email_remote_content_allowlist',
  'email_read_receipt_log',
  'email_thread_edges',
  'email_thread_aliases',
] as const;

export const coreMailSchemaMigration: SqlMigration = {
  id: '0007_core_mail_schema',
  description: 'Server edition core mail schema: accounts, folders, threads, messages, categories, tags, notes, attachments.',
  upSql: [
    'CREATE SEQUENCE IF NOT EXISTS email_account_signatures_server_source_sqlite_id_seq;',
    `CREATE TABLE IF NOT EXISTS email_accounts (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  display_name text NOT NULL,
  email_address text NOT NULL,
  imap_host text NOT NULL,
  imap_port integer NOT NULL DEFAULT 993,
  imap_tls boolean NOT NULL DEFAULT true,
  imap_username text NOT NULL,
  keytar_account_key text,
  imap_password_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_tls boolean NOT NULL DEFAULT true,
  smtp_username text,
  smtp_use_imap_auth boolean NOT NULL DEFAULT true,
  smtp_keytar_account_key text,
  smtp_password_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  protocol text NOT NULL DEFAULT 'imap',
  pop3_host text,
  pop3_port integer DEFAULT 995,
  pop3_tls boolean NOT NULL DEFAULT true,
  oauth_provider text,
  oauth_refresh_keytar_key text,
  oauth_refresh_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  sent_folder_path text DEFAULT 'Sent',
  sync_spam_folder_path text,
  sync_archive_folder_path text,
  imap_sync_sent boolean NOT NULL DEFAULT false,
  imap_sync_archive boolean NOT NULL DEFAULT false,
  imap_sync_spam boolean NOT NULL DEFAULT false,
  imap_sync_seen_on_open boolean NOT NULL DEFAULT true,
  vacation_enabled boolean NOT NULL DEFAULT false,
  vacation_subject text,
  vacation_body_text text,
  request_read_receipt boolean NOT NULL DEFAULT false,
  default_remote_content_policy text NOT NULL DEFAULT 'blocked',
  respond_to_read_receipts text NOT NULL DEFAULT 'never',
  read_receipt_trusted_domains text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_accounts_workspace_address_idx ON email_accounts (workspace_id, lower(email_address));',
    `CREATE TABLE IF NOT EXISTS email_account_mail_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_source_sqlite_id bigint NOT NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  ticket_prefix text NOT NULL,
  ticket_next_number bigint NOT NULL DEFAULT 1,
  ticket_number_padding integer NOT NULL DEFAULT 6,
  thread_namespace text NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_source_sqlite_id),
  UNIQUE (workspace_id, account_id),
  UNIQUE (workspace_id, ticket_prefix),
  UNIQUE (workspace_id, thread_namespace)
);`,
    'CREATE INDEX IF NOT EXISTS email_account_mail_settings_account_idx ON email_account_mail_settings (workspace_id, account_id);',
    `CREATE TABLE IF NOT EXISTS email_folders (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  account_source_sqlite_id bigint NOT NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  path text NOT NULL,
  delimiter text DEFAULT '/',
  uidvalidity bigint,
  uidvalidity_str text,
  last_uid bigint NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  pop3_uidl_str text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, account_source_sqlite_id, path)
);`,
    'CREATE INDEX IF NOT EXISTS email_folders_workspace_account_idx ON email_folders (workspace_id, account_id);',
    `CREATE TABLE IF NOT EXISTS email_team_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'agent',
  signature_html text,
  sort_order integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS email_threads (
  id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ticket_code text NOT NULL,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL,
  root_message_source_sqlite_id bigint,
  root_message_id bigint,
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  has_unread boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  subject_normalized text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);`,
    'CREATE UNIQUE INDEX IF NOT EXISTS email_threads_workspace_account_ticket_idx ON email_threads (workspace_id, account_id, ticket_code);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_threads_workspace_global_ticket_idx ON email_threads (workspace_id, ticket_code) WHERE account_id IS NULL;',
    'CREATE INDEX IF NOT EXISTS email_threads_workspace_last_idx ON email_threads (workspace_id, last_message_at DESC);',
    `CREATE TABLE IF NOT EXISTS email_messages (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  account_source_sqlite_id bigint NOT NULL,
  folder_source_sqlite_id bigint NOT NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  folder_id bigint REFERENCES email_folders(id) ON DELETE CASCADE,
  uid bigint NOT NULL,
  message_id text,
  in_reply_to text,
  references_header text,
  subject text,
  from_json jsonb,
  to_json jsonb,
  cc_json jsonb,
  bcc_json jsonb,
  date_received timestamptz,
  snippet text,
  body_text text,
  body_html text,
  seen_local boolean NOT NULL DEFAULT false,
  done_local boolean NOT NULL DEFAULT false,
  sent_imap_sync_failed boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  soft_deleted boolean NOT NULL DEFAULT false,
  trash_prev_archived boolean,
  trash_prev_is_spam boolean,
  trash_prev_folder_kind text,
  outbound_hold boolean NOT NULL DEFAULT false,
  outbound_block_reason text,
  thread_id text,
  ticket_code text,
  customer_source_sqlite_id bigint,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  folder_kind text NOT NULL DEFAULT 'inbox',
  imap_thread_id text,
  has_attachments boolean NOT NULL DEFAULT false,
  attachments_json jsonb,
  auth_spf text,
  auth_dkim text,
  auth_dmarc text,
  auth_arc text,
  auth_dkim_domains text,
  auth_error text,
  rspamd_score double precision,
  rspamd_action text,
  rspamd_symbols text,
  rspamd_error text,
  security_checked_at timestamptz,
  draft_attachment_paths_json text,
  post_process_done boolean NOT NULL DEFAULT false,
  reply_parent_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  assigned_to text,
  legacy_assigned_to_user_id text,
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_spam boolean NOT NULL DEFAULT false,
  spam_status text NOT NULL DEFAULT 'clean',
  spam_score integer,
  spam_score_label text,
  spam_decision_source text,
  spam_score_breakdown_json jsonb,
  spam_decided_at timestamptz,
  snoozed_until timestamptz,
  scheduled_send_at timestamptz,
  pop3_uidl text,
  raw_headers text,
  raw_rfc822_b64 text,
  remote_content_policy text NOT NULL DEFAULT 'blocked',
  read_receipt_requested boolean NOT NULL DEFAULT false,
  pgp_status text,
  pgp_signer_fingerprint text,
  thread_confidence text,
  thread_resolver_version integer NOT NULL DEFAULT 0,
  normalized_subject text,
  server_thread_source text,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(subject, '') || ' ' ||
      coalesce(snippet, '') || ' ' ||
      coalesce(body_text, '') || ' ' ||
      coalesce(from_json::text, '') || ' ' ||
      coalesce(to_json::text, '') || ' ' ||
      coalesce(cc_json::text, '') || ' ' ||
      coalesce(bcc_json::text, '') || ' ' ||
      coalesce(ticket_code, '')
    )
  ) STORED,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, account_source_sqlite_id, folder_source_sqlite_id, uid)
);`,
    'CREATE INDEX IF NOT EXISTS email_messages_workspace_account_folder_date_idx ON email_messages (workspace_id, account_id, folder_kind, date_received DESC);',
    'CREATE INDEX IF NOT EXISTS email_messages_workspace_thread_idx ON email_messages (workspace_id, thread_id);',
    'CREATE INDEX IF NOT EXISTS email_messages_search_gin_idx ON email_messages USING gin (search_vector);',
    'CREATE INDEX IF NOT EXISTS email_messages_from_json_gin_idx ON email_messages USING gin (from_json);',
    'CREATE INDEX IF NOT EXISTS email_messages_spam_idx ON email_messages (workspace_id, account_id, spam_status) WHERE is_spam = true;',
    'CREATE INDEX IF NOT EXISTS email_messages_active_idx ON email_messages (workspace_id, date_received DESC) WHERE archived = false AND soft_deleted = false;',
    'CREATE INDEX IF NOT EXISTS email_messages_workspace_scheduled_send_idx ON email_messages (workspace_id, scheduled_send_at) WHERE uid < 0 AND folder_kind = \'draft\' AND scheduled_send_at IS NOT NULL AND outbound_hold = false;',
    `CREATE TABLE IF NOT EXISTS email_message_attachments (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  filename_display text NOT NULL,
  content_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  content_sha256 text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_message_attachments_message_idx ON email_message_attachments (workspace_id, message_id);',
    `CREATE TABLE IF NOT EXISTS email_message_tags (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  tag text NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, message_source_sqlite_id, tag)
);`,
    'CREATE INDEX IF NOT EXISTS email_message_tags_tag_idx ON email_message_tags (workspace_id, tag);',
    `CREATE TABLE IF NOT EXISTS email_categories (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  parent_source_sqlite_id bigint,
  parent_id bigint REFERENCES email_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_message_categories (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  category_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  category_id bigint REFERENCES email_categories(id) ON DELETE CASCADE,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, message_source_sqlite_id, category_source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_internal_notes (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  body text NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_canned_responses (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  override_key text,
  sort_order integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_canned_responses_scope_idx ON email_canned_responses (workspace_id, account_id, override_key, sort_order);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_canned_responses_account_override_key_idx ON email_canned_responses (workspace_id, account_id, override_key) WHERE override_key IS NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_canned_responses_global_override_key_idx ON email_canned_responses (workspace_id, override_key) WHERE account_id IS NULL AND override_key IS NOT NULL;',
    `CREATE TABLE IF NOT EXISTS email_account_signatures (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  account_source_sqlite_id bigint NOT NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  signature_html text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, account_source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_remote_content_allowlist (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  scope text NOT NULL,
  value text NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, scope, value)
);`,
    `CREATE TABLE IF NOT EXISTS email_read_receipt_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  direction text NOT NULL,
  recipient text,
  at timestamptz,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_thread_edges (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  parent_message_source_sqlite_id bigint NOT NULL,
  child_message_source_sqlite_id bigint NOT NULL,
  parent_message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  child_message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, parent_message_source_sqlite_id, child_message_source_sqlite_id)
);`,
`CREATE TABLE IF NOT EXISTS email_thread_aliases (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  alias_thread_id text NOT NULL,
  canonical_thread_id text NOT NULL,
  confidence text NOT NULL DEFAULT 'high',
  source text NOT NULL DEFAULT 'manual',
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  CHECK (alias_thread_id <> canonical_thread_id)
);`,
    'CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_account_pair_all_idx ON email_thread_aliases (workspace_id, account_id, alias_thread_id, canonical_thread_id);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_account_pair_idx ON email_thread_aliases (workspace_id, account_id, alias_thread_id, canonical_thread_id) WHERE account_id IS NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_global_pair_idx ON email_thread_aliases (workspace_id, alias_thread_id, canonical_thread_id) WHERE account_id IS NULL;',
    `ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_message_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_message_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_account_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_account_mail_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_remote_content_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_read_receipt_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_thread_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_thread_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE email_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE email_team_members FORCE ROW LEVEL SECURITY;
ALTER TABLE email_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE email_message_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE email_message_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE email_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE email_message_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE email_internal_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE email_canned_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE email_account_signatures FORCE ROW LEVEL SECURITY;
ALTER TABLE email_account_mail_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE email_remote_content_allowlist FORCE ROW LEVEL SECURITY;
ALTER TABLE email_read_receipt_log FORCE ROW LEVEL SECURITY;
ALTER TABLE email_thread_edges FORCE ROW LEVEL SECURITY;
ALTER TABLE email_thread_aliases FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversation_locks_message_fk'
  ) THEN
    ALTER TABLE conversation_locks
      ADD CONSTRAINT conversation_locks_message_fk
      FOREIGN KEY (message_id) REFERENCES email_messages(id) ON DELETE CASCADE;
  END IF;
END $$;`,
  ],
  downSql: [
    'ALTER TABLE conversation_locks DROP CONSTRAINT IF EXISTS conversation_locks_message_fk;',
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS email_thread_aliases;',
    'DROP TABLE IF EXISTS email_thread_edges;',
    'DROP TABLE IF EXISTS email_read_receipt_log;',
    'DROP TABLE IF EXISTS email_remote_content_allowlist;',
    'DROP TABLE IF EXISTS email_account_mail_settings;',
    'DROP TABLE IF EXISTS email_account_signatures;',
    'DROP TABLE IF EXISTS email_canned_responses;',
    'DROP TABLE IF EXISTS email_internal_notes;',
    'DROP TABLE IF EXISTS email_message_categories;',
    'DROP TABLE IF EXISTS email_categories;',
    'DROP TABLE IF EXISTS email_message_tags;',
    'DROP TABLE IF EXISTS email_message_attachments;',
    'DROP TABLE IF EXISTS email_messages;',
    'DROP TABLE IF EXISTS email_threads;',
    'DROP TABLE IF EXISTS email_team_members;',
    'DROP TABLE IF EXISTS email_folders;',
    'DROP TABLE IF EXISTS email_accounts;',
    'DROP SEQUENCE IF EXISTS email_account_signatures_server_source_sqlite_id_seq;',
  ],
};
