import type { SqlMigration } from './types';

export const taskAssignmentAndUserGroupsMigration: SqlMigration = {
  id: '0016_task_assignment_and_user_groups',
  description: 'Adds user groups and task assignment (global/user/group) with workspace RLS.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS user_groups (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);`,
    `CREATE TABLE IF NOT EXISTS user_group_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id bigint NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);`,
    `CREATE INDEX IF NOT EXISTS user_group_members_workspace_user_idx ON user_group_members (workspace_id, user_id);`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_scope text NOT NULL DEFAULT 'global' CHECK (assignment_scope IN ('global', 'user', 'group'))`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_group_id bigint REFERENCES user_groups(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS tasks_workspace_assigned_user_idx ON tasks (workspace_id, assigned_user_id) WHERE assigned_user_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS tasks_workspace_assigned_group_idx ON tasks (workspace_id, assigned_group_id) WHERE assigned_group_id IS NOT NULL`,
    `ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE user_group_members ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE user_groups FORCE ROW LEVEL SECURITY;`,
    `ALTER TABLE user_group_members FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY user_groups_workspace_isolation ON user_groups
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY user_group_members_workspace_isolation ON user_group_members
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    `DROP POLICY IF EXISTS user_group_members_workspace_isolation ON user_group_members`,
    `DROP POLICY IF EXISTS user_groups_workspace_isolation ON user_groups`,
    `DROP INDEX IF EXISTS tasks_workspace_assigned_group_idx`,
    `DROP INDEX IF EXISTS tasks_workspace_assigned_user_idx`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS assigned_group_id`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS assigned_user_id`,
    `ALTER TABLE tasks DROP COLUMN IF EXISTS assignment_scope`,
    `DROP INDEX IF EXISTS user_group_members_workspace_user_idx`,
    `DROP TABLE IF EXISTS user_group_members`,
    `DROP TABLE IF EXISTS user_groups`,
  ],
};
