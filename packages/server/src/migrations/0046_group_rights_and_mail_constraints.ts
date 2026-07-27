import type { SqlMigration } from './types';

/**
 * Capability key remap (email_settings.manage → settings.manage) plus
 * optional per-binding visibility constraints for mail ACL.
 *
 * ACHTUNG, downSql ist KEINE exakte Inverse: Der Rename zurueck auf
 * `email_settings.manage` trifft jedes `settings.manage`, auch Grants, die erst
 * NACH dieser Migration ueber die Gruppen-UI vergeben wurden — deren Herkunft
 * ist nicht unterscheidbar. Fuer einen sofortigen Rollback nach dem Deploy ist
 * das korrekt; nach laengerem Produktivbetrieb mit neu konfigurierten Gruppen
 * muessen die Rechte danach geprueft werden (die Grants gehen nicht verloren,
 * sie landen wieder unter dem Legacy-Key).
 */
export const groupRightsAndMailConstraintsMigration: SqlMigration = {
  id: '0046_group_rights_and_mail_constraints',
  description:
    'Remap legacy group capability keys and add mail ACL binding visibility constraints',
  upSql: [
    // Transaction-local system context: the migrator applies one migration in a
    // single transaction as the app role, which is subject to FORCE ROW LEVEL
    // SECURITY on user_group_permissions (0037). Without this the UPDATE/DELETE
    // below match zero rows across all workspaces and silently no-op while the
    // migration is still recorded as applied. Mirrors 0033/0038/0039/0042.
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
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
  CONSTRAINT mail_acl_binding_constraints_size_check CHECK (
    cardinality(value_ids) <= 500
    AND cardinality(value_texts) <= 500
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
    // Same RLS reason as upSql — ohne Kontext liefe der Rollback-Rename leer.
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
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
