import type { SqlMigration } from './types';

export const securityFoundationMigration: SqlMigration = {
  id: '0002_security_foundation',
  description: 'Server edition security foundation: encrypted secrets, login failures, audit events.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  key_id text NOT NULL DEFAULT 'default',
  algorithm text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, name)
);`,
    'CREATE INDEX IF NOT EXISTS secrets_workspace_kind_idx ON secrets (workspace_id, kind);',
    `CREATE TABLE IF NOT EXISTS auth_login_failures (
  id bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email_normalized text NOT NULL,
  ip_address inet NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL,
  penalty_kind text NOT NULL CHECK (penalty_kind IN ('none', 'temporary', 'permanent')),
  lock_until timestamptz,
  user_agent text
);`,
    'CREATE INDEX IF NOT EXISTS auth_login_failures_email_idx ON auth_login_failures (email_normalized, failed_at DESC);',
    'CREATE INDEX IF NOT EXISTS auth_login_failures_ip_idx ON auth_login_failures (ip_address, failed_at DESC);',
    'CREATE UNIQUE INDEX IF NOT EXISTS auth_login_failures_email_ip_unique_idx ON auth_login_failures (email_normalized, ip_address);',
    `CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    'CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx ON audit_events (workspace_id, created_at DESC);',
    'CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (workspace_id, action, created_at DESC);',
    `CREATE TABLE IF NOT EXISTS server_events (
  sequence bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  actor_user_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    'CREATE INDEX IF NOT EXISTS server_events_workspace_sequence_idx ON server_events (workspace_id, sequence);',
    'CREATE INDEX IF NOT EXISTS server_events_workspace_created_idx ON server_events (workspace_id, created_at DESC);',
    `ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_login_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_login_failures FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE server_events FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY secrets_workspace_isolation ON secrets
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY auth_login_failures_workspace_isolation ON auth_login_failures
  USING (workspace_id IS NULL OR app.can_access_workspace(workspace_id))
  WITH CHECK (workspace_id IS NULL OR app.can_access_workspace(workspace_id));`,
    `CREATE POLICY audit_events_workspace_isolation ON audit_events
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY server_events_workspace_isolation ON server_events
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS server_events_workspace_isolation ON server_events;',
    'DROP POLICY IF EXISTS audit_events_workspace_isolation ON audit_events;',
    'DROP POLICY IF EXISTS auth_login_failures_workspace_isolation ON auth_login_failures;',
    'DROP POLICY IF EXISTS secrets_workspace_isolation ON secrets;',
    'DROP INDEX IF EXISTS auth_login_failures_email_ip_unique_idx;',
    'DROP TABLE IF EXISTS server_events;',
    'DROP TABLE IF EXISTS audit_events;',
    'DROP TABLE IF EXISTS auth_login_failures;',
    'DROP TABLE IF EXISTS secrets;',
  ],
};
