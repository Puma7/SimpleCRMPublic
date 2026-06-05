import type { SqlMigration } from './types';

export const serverFoundationMigration: SqlMigration = {
  id: '0001_server_foundation',
  description: 'Server edition foundation: workspaces, users, refresh tokens, PG queue, RLS, locks.',
  upSql: [
    'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
    'CREATE SCHEMA IF NOT EXISTS app;',
    `CREATE OR REPLACE FUNCTION app.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid
$$;`,
    `CREATE OR REPLACE FUNCTION app.current_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;`,
    `CREATE OR REPLACE FUNCTION app.cross_workspace_access_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT lower(coalesce(current_setting('app.cross_workspace_access', true), 'off')) IN ('1', 'true', 'on')
    AND app.current_role() IN ('owner', 'admin', 'system')
$$;`,
    `CREATE OR REPLACE FUNCTION app.can_access_workspace(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT target_workspace_id = app.current_workspace_id()
    OR app.cross_workspace_access_enabled()
$$;`,
    `CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    'CREATE UNIQUE INDEX IF NOT EXISTS users_workspace_email_unique_idx ON users (workspace_id, lower(email));',
    `CREATE TABLE IF NOT EXISTS auth_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
  token_hash text NOT NULL UNIQUE,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS auth_invitations_live_email_idx
  ON auth_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;`,
    'CREATE INDEX IF NOT EXISTS auth_invitations_workspace_expires_idx ON auth_invitations (workspace_id, expires_at);',
    `CREATE TABLE IF NOT EXISTS user_account_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id bigint NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  can_read boolean NOT NULL DEFAULT true,
  can_send boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);`,
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS job_queue (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  run_after timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    'CREATE INDEX IF NOT EXISTS job_queue_ready_idx ON job_queue (run_after, id) WHERE locked_at IS NULL;',
    'CREATE INDEX IF NOT EXISTS job_queue_workspace_type_idx ON job_queue (workspace_id, type, run_after);',
    `CREATE TABLE IF NOT EXISTS conversation_locks (
  message_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'reply' CHECK (reason IN ('reply', 'forward', 'edit')),
  takeover_count integer NOT NULL DEFAULT 0
);`,
    `COMMENT ON TABLE conversation_locks IS
'Server-edition pessimistic mail lock. The email_messages FK is added when the PG mail schema lands.';`,
    'CREATE INDEX IF NOT EXISTS conversation_locks_workspace_idx ON conversation_locks (workspace_id, last_heartbeat_at);',
    `ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE user_account_access FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE job_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_locks FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY workspaces_workspace_isolation ON workspaces
  USING (app.can_access_workspace(id))
  WITH CHECK (app.can_access_workspace(id));`,
    `CREATE POLICY users_workspace_isolation ON users
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY auth_invitations_workspace_isolation ON auth_invitations
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY user_account_access_workspace_isolation ON user_account_access
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY refresh_tokens_workspace_isolation ON refresh_tokens
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY job_queue_workspace_isolation ON job_queue
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY conversation_locks_workspace_isolation ON conversation_locks
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS conversation_locks_workspace_isolation ON conversation_locks;',
    'DROP POLICY IF EXISTS job_queue_workspace_isolation ON job_queue;',
    'DROP POLICY IF EXISTS refresh_tokens_workspace_isolation ON refresh_tokens;',
    'DROP POLICY IF EXISTS user_account_access_workspace_isolation ON user_account_access;',
    'DROP POLICY IF EXISTS auth_invitations_workspace_isolation ON auth_invitations;',
    'DROP POLICY IF EXISTS users_workspace_isolation ON users;',
    'DROP POLICY IF EXISTS workspaces_workspace_isolation ON workspaces;',
    'DROP TABLE IF EXISTS conversation_locks;',
    'DROP TABLE IF EXISTS job_queue;',
    'DROP TABLE IF EXISTS refresh_tokens;',
    'DROP TABLE IF EXISTS user_account_access;',
    'DROP TABLE IF EXISTS auth_invitations;',
    'DROP TABLE IF EXISTS users;',
    'DROP TABLE IF EXISTS workspaces;',
    'DROP FUNCTION IF EXISTS app.can_access_workspace(uuid);',
    'DROP FUNCTION IF EXISTS app.cross_workspace_access_enabled();',
    'DROP FUNCTION IF EXISTS app.current_role();',
    'DROP FUNCTION IF EXISTS app.current_workspace_id();',
    'DROP SCHEMA IF EXISTS app;',
  ],
};
