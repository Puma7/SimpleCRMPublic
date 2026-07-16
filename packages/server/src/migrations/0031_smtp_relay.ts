import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'smtp_relays',
  'smtp_relay_credentials',
  'smtp_relay_allowed_accounts',
  'smtp_relay_submissions',
] as const;

export const smtpRelayMigration: SqlMigration = {
  id: '0031_smtp_relay',
  description: 'Workspace-scoped SMTP relay endpoints, credentials, allowed accounts, and submission audit.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS smtp_relays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  allow_arbitrary_recipients boolean NOT NULL DEFAULT false,
  max_recipients integer NOT NULL DEFAULT 50 CHECK (max_recipients BETWEEN 1 AND 1000),
  max_message_bytes integer NOT NULL DEFAULT 26214400 CHECK (max_message_bytes > 0),
  rate_limit_per_min integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_min >= 1),
  tracking_mode text NOT NULL DEFAULT 'rule' CHECK (tracking_mode IN ('off','rule','always')),
  tracking_subject_patterns text,
  allow_header_override boolean NOT NULL DEFAULT true,
  followup_workflow_id bigint REFERENCES email_workflows(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, label)
);`,
    `CREATE TABLE IF NOT EXISTS smtp_relay_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  relay_id uuid NOT NULL REFERENCES smtp_relays(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_hash text NOT NULL,
  secret_id text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username)
);`,
    'CREATE INDEX IF NOT EXISTS smtp_relay_credentials_password_hash_idx ON smtp_relay_credentials (password_hash);',
    'CREATE INDEX IF NOT EXISTS smtp_relay_credentials_relay_id_idx ON smtp_relay_credentials (relay_id);',
    `CREATE TABLE IF NOT EXISTS smtp_relay_allowed_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  relay_id uuid NOT NULL REFERENCES smtp_relays(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  from_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (relay_id, account_id)
);`,
    `CREATE TABLE IF NOT EXISTS smtp_relay_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  relay_id uuid NOT NULL REFERENCES smtp_relays(id) ON DELETE CASCADE,
  credential_id uuid REFERENCES smtp_relay_credentials(id) ON DELETE SET NULL,
  account_id bigint NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  tracking_applied boolean NOT NULL DEFAULT false,
  tracking_rule_reason text,
  status text NOT NULL CHECK (status IN ('received','relayed','failed')),
  smtp_message_id_header text,
  dedup_key text,
  recipient_count integer NOT NULL,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, relay_id, dedup_key)
);`,
    'CREATE INDEX IF NOT EXISTS smtp_relay_submissions_relay_created_idx ON smtp_relay_submissions (relay_id, created_at);',
    'CREATE INDEX IF NOT EXISTS smtp_relay_submissions_message_id_idx ON smtp_relay_submissions (message_id);',
    `ALTER TABLE smtp_relays ENABLE ROW LEVEL SECURITY;
ALTER TABLE smtp_relay_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE smtp_relay_allowed_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE smtp_relay_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE smtp_relays FORCE ROW LEVEL SECURITY;
ALTER TABLE smtp_relay_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE smtp_relay_allowed_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE smtp_relay_submissions FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
  ],
  downSql: [
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS smtp_relay_submissions;',
    'DROP TABLE IF EXISTS smtp_relay_allowed_accounts;',
    'DROP TABLE IF EXISTS smtp_relay_credentials;',
    'DROP TABLE IF EXISTS smtp_relays;',
  ],
};
