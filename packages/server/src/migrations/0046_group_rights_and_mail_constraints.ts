import type { SqlMigration } from './types';

/**
 * Capability key remap (email_settings.manage → settings.manage) plus
 * optional per-binding visibility constraints for mail ACL.
 */
export const groupRightsAndMailConstraintsMigration: SqlMigration = {
  id: '0046_group_rights_and_mail_constraints',
  description:
    'Remap legacy group capability keys and add mail ACL binding visibility constraints',
  upSql: [
    `UPDATE user_group_permissions
SET permission = 'settings.manage'
WHERE permission = 'email_settings.manage'
  AND NOT EXISTS (
    SELECT 1
    FROM user_group_permissions AS existing
    WHERE existing.workspace_id = user_group_permissions.workspace_id
      AND existing.group_id = user_group_permissions.group_id
      AND existing.permission = 'settings.manage'
  );`,
    `DELETE FROM user_group_permissions WHERE permission = 'email_settings.manage';`,
    `CREATE TABLE IF NOT EXISTS mail_acl_binding_constraints (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  binding_id bigint NOT NULL REFERENCES mail_acl_bindings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('assignment', 'category', 'tag')),
  mode text NOT NULL CHECK (mode IN ('allow', 'exclude', 'filter')),
  assignment_mode text CHECK (
    assignment_mode IS NULL
    OR assignment_mode IN ('any', 'assigned_to_me', 'assigned_to_my_groups', 'unassigned')
  ),
  value_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],
  value_texts text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_acl_binding_constraints_shape_check CHECK (
    (
      kind = 'assignment'
      AND mode = 'filter'
      AND assignment_mode IS NOT NULL
      AND cardinality(value_ids) = 0
      AND cardinality(value_texts) = 0
    )
    OR (
      kind = 'category'
      AND mode IN ('allow', 'exclude')
      AND assignment_mode IS NULL
      AND cardinality(value_texts) = 0
      AND cardinality(value_ids) > 0
    )
    OR (
      kind = 'tag'
      AND mode IN ('allow', 'exclude')
      AND assignment_mode IS NULL
      AND cardinality(value_ids) = 0
      AND cardinality(value_texts) > 0
    )
  ),
  CONSTRAINT mail_acl_binding_constraints_binding_fk
    FOREIGN KEY (binding_id) REFERENCES mail_acl_bindings(id) ON DELETE CASCADE
);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mail_acl_binding_constraints_unique_idx
  ON mail_acl_binding_constraints (binding_id, kind, mode);`,
    `CREATE INDEX IF NOT EXISTS mail_acl_binding_constraints_workspace_idx
  ON mail_acl_binding_constraints (workspace_id);`,
    `CREATE INDEX IF NOT EXISTS mail_acl_binding_constraints_binding_idx
  ON mail_acl_binding_constraints (binding_id);`,
    'ALTER TABLE mail_acl_binding_constraints ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE mail_acl_binding_constraints FORCE ROW LEVEL SECURITY;',
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mail_acl_binding_constraints'
      AND policyname = 'mail_acl_binding_constraints_workspace_isolation'
  ) THEN
    CREATE POLICY mail_acl_binding_constraints_workspace_isolation ON mail_acl_binding_constraints
      USING (app.can_access_workspace(workspace_id))
      WITH CHECK (app.can_access_workspace(workspace_id));
  END IF;
END $$;`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS mail_acl_binding_constraints_workspace_isolation ON mail_acl_binding_constraints;',
    'DROP TABLE IF EXISTS mail_acl_binding_constraints;',
    `UPDATE user_group_permissions
SET permission = 'email_settings.manage'
WHERE permission = 'settings.manage'
  AND NOT EXISTS (
    SELECT 1
    FROM user_group_permissions AS existing
    WHERE existing.workspace_id = user_group_permissions.workspace_id
      AND existing.group_id = user_group_permissions.group_id
      AND existing.permission = 'email_settings.manage'
  );`,
  ],
};
