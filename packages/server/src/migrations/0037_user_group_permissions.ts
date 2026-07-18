import type { SqlMigration } from './types';

export const userGroupPermissionsMigration: SqlMigration = {
  id: '0037_user_group_permissions',
  description: 'Grant-only capability permissions for user groups',
  upSql: [
    `CREATE TABLE IF NOT EXISTS user_group_permissions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id bigint NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  permission text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, group_id, permission)
);`,
    'CREATE INDEX IF NOT EXISTS user_group_permissions_group_idx ON user_group_permissions (workspace_id, group_id);',
    'ALTER TABLE user_group_permissions ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE user_group_permissions FORCE ROW LEVEL SECURITY;',
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_group_permissions'
      AND policyname = 'user_group_permissions_workspace_isolation'
  ) THEN
    CREATE POLICY user_group_permissions_workspace_isolation ON user_group_permissions
      USING (app.can_access_workspace(workspace_id))
      WITH CHECK (app.can_access_workspace(workspace_id));
  END IF;
END $$;`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS user_group_permissions_group_idx;',
    'DROP TABLE IF EXISTS user_group_permissions;',
  ],
};
