import type { SqlMigration } from './types';

export const mailAclRolloutMigration: SqlMigration = {
  id: '0039_mail_acl_rollout',
  description: 'Mailbox ACL rollout mode, readiness counters, and shadow backfill',
  upSql: [
    `CREATE TABLE IF NOT EXISTS mail_acl_rollout_state (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('shadow', 'enforce')),
  evaluated bigint NOT NULL DEFAULT 0 CHECK (evaluated >= 0),
  legacy_allow_new_deny bigint NOT NULL DEFAULT 0 CHECK (legacy_allow_new_deny >= 0),
  legacy_deny_new_allow bigint NOT NULL DEFAULT 0 CHECK (legacy_deny_new_allow >= 0),
  not_comparable bigint NOT NULL DEFAULT 0 CHECK (not_comparable >= 0),
  observation_started_at timestamptz,
  observation_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_acl_rollout_observation_window_check CHECK (
    (observation_started_at IS NULL AND observation_updated_at IS NULL)
    OR
    (observation_started_at IS NOT NULL AND observation_updated_at IS NOT NULL)
  )
);`,
    `ALTER TABLE mail_acl_rollout_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_acl_rollout_state FORCE ROW LEVEL SECURITY;`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mail_acl_rollout_state'
      AND policyname = 'mail_acl_rollout_state_workspace_isolation'
  ) THEN
    CREATE POLICY mail_acl_rollout_state_workspace_isolation ON mail_acl_rollout_state
      USING (app.can_access_workspace(workspace_id))
      WITH CHECK (app.can_access_workspace(workspace_id));
  END IF;
END $$;`,
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    `INSERT INTO mail_acl_rollout_state (workspace_id, mode, updated_at)
SELECT id, 'shadow', now()
FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS mail_acl_rollout_state;',
  ],
};
