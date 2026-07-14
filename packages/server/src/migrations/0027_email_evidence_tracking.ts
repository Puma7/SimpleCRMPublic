import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'email_tracking_policies',
  'email_tracking_messages',
  'email_tracking_links',
  'email_tracking_events',
  'email_tracking_token_resolver',
] as const;

export const emailEvidenceTrackingMigration: SqlMigration = {
  id: '0027_email_evidence_tracking',
  description: 'Privacy-controlled outbound email evidence, opaque public tokens, and append-only events.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS email_tracking_policies (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  track_opens boolean NOT NULL DEFAULT false,
  track_links boolean NOT NULL DEFAULT false,
  collect_derived_metadata boolean NOT NULL DEFAULT false,
  collect_raw_metadata boolean NOT NULL DEFAULT false,
  raw_metadata_retention_days integer NOT NULL DEFAULT 7
    CHECK (raw_metadata_retention_days BETWEEN 1 AND 30),
  event_retention_days integer NOT NULL DEFAULT 365
    CHECK (event_retention_days BETWEEN 30 AND 3650),
  token_ttl_days integer NOT NULL DEFAULT 730
    CHECK (token_ttl_days BETWEEN 1 AND 3650),
  legal_basis text CHECK (legal_basis IS NULL OR legal_basis IN ('consent','legitimate_interest','contract','other')),
  privacy_notice_url text,
  compliance_acknowledged_at timestamptz,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    enabled = false OR (
      legal_basis IS NOT NULL
      AND nullif(btrim(privacy_notice_url), '') IS NOT NULL
      AND compliance_acknowledged_at IS NOT NULL
      AND (track_opens = true OR track_links = true)
    )
  ),
  CHECK (collect_raw_metadata = false OR collect_derived_metadata = true)
);`,
    `CREATE TABLE IF NOT EXISTS email_tracking_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL,
  message_id_header text,
  recipient_count integer NOT NULL CHECK (recipient_count BETWEEN 1 AND 1000),
  track_opens boolean NOT NULL,
  track_links boolean NOT NULL,
  collect_derived_metadata boolean NOT NULL,
  collect_raw_metadata boolean NOT NULL,
  token_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, message_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_tracking_messages_header_idx ON email_tracking_messages (workspace_id, message_id_header) WHERE message_id_header IS NOT NULL;',
    'CREATE INDEX IF NOT EXISTS email_tracking_messages_message_id_idx ON email_tracking_messages (message_id);',
    `CREATE TABLE IF NOT EXISTS email_tracking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tracking_message_id uuid NOT NULL REFERENCES email_tracking_messages(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 999),
  token_hash text NOT NULL UNIQUE,
  target_ciphertext bytea NOT NULL,
  target_nonce bytea NOT NULL,
  target_auth_tag bytea NOT NULL,
  target_url_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking_message_id, ordinal)
);`,
    `CREATE TABLE IF NOT EXISTS email_tracking_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tracking_message_id uuid NOT NULL REFERENCES email_tracking_messages(id) ON DELETE CASCADE,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  link_id uuid REFERENCES email_tracking_links(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'queued','sending','smtp_accepted','smtp_failed','delayed','bounced',
    'dsn_delivered','mdn_displayed','open_automated','open_probable',
    'click_automated','click','replied','revoked','expired'
  )),
  source text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('none','low','medium','high','verified')),
  automated boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_metadata_ciphertext bytea,
  raw_metadata_nonce bytea,
  raw_metadata_auth_tag bytea,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dedupe_key),
  CHECK (
    (raw_metadata_ciphertext IS NULL AND raw_metadata_nonce IS NULL AND raw_metadata_auth_tag IS NULL)
    OR
    (raw_metadata_ciphertext IS NOT NULL AND raw_metadata_nonce IS NOT NULL AND raw_metadata_auth_tag IS NOT NULL)
  )
);`,
    'CREATE INDEX IF NOT EXISTS email_tracking_events_message_time_idx ON email_tracking_events (workspace_id, message_id, occurred_at DESC);',
    'CREATE INDEX IF NOT EXISTS email_tracking_events_message_id_idx ON email_tracking_events (message_id);',
    'CREATE INDEX IF NOT EXISTS email_tracking_events_tracking_time_idx ON email_tracking_events (tracking_message_id, occurred_at DESC);',
    'CREATE INDEX IF NOT EXISTS email_tracking_events_retention_idx ON email_tracking_events (workspace_id, created_at);',
    `CREATE TABLE IF NOT EXISTS email_tracking_token_resolver (
  token_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tracking_message_id uuid NOT NULL REFERENCES email_tracking_messages(id) ON DELETE CASCADE,
  link_id uuid REFERENCES email_tracking_links(id) ON DELETE CASCADE,
  token_kind text NOT NULL CHECK (token_kind IN ('open','click')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((token_kind = 'open' AND link_id IS NULL) OR (token_kind = 'click' AND link_id IS NOT NULL))
);`,
    'CREATE INDEX IF NOT EXISTS email_tracking_token_resolver_expiry_idx ON email_tracking_token_resolver (expires_at);',
    `ALTER TABLE email_tracking_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_token_resolver ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_links FORCE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_events FORCE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_token_resolver FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
    `CREATE POLICY email_tracking_token_resolver_public_lookup ON email_tracking_token_resolver
  FOR SELECT
  USING (token_hash = nullif(current_setting('app.email_tracking_token_hash', true), ''));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS email_tracking_token_resolver_public_lookup ON email_tracking_token_resolver;',
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS email_tracking_token_resolver;',
    'DROP TABLE IF EXISTS email_tracking_events;',
    'DROP TABLE IF EXISTS email_tracking_links;',
    'DROP TABLE IF EXISTS email_tracking_messages;',
    'DROP TABLE IF EXISTS email_tracking_policies;',
  ],
};
