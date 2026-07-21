import type { SqlMigration } from './types';

// Historical migrations must not change when the runtime permission catalog grows.
const MAIL_ACL_PERMISSION_KEYS_0038 = Object.freeze([
  'mail.metadata.read',
  'mail.content.read',
  'mail.attachment.read',
  'mail.attachment.suspicious_download',
  'mail.triage',
  'mail.comment',
  'mail.draft.create',
  'mail.draft.edit',
  'mail.send',
  'mail.send_as',
  'mail.delete',
  'mail.export',
  'mail.account.manage',
  'mail.delegation.manage',
] as const);

const permissionCheckSql = MAIL_ACL_PERMISSION_KEYS_0038
  .map((permission) => `'${permission}'`)
  .join(', ');

export const mailAclMigration: SqlMigration = {
  id: '0038_mail_acl',
  description: 'Mailbox ACL bindings, permission grants, and legacy account-access backfill',
  upSql: [
    'CREATE UNIQUE INDEX IF NOT EXISTS users_workspace_id_unique_idx ON users (workspace_id, id);',
    'CREATE UNIQUE INDEX IF NOT EXISTS user_groups_workspace_id_unique_idx ON user_groups (workspace_id, id);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_workspace_id_unique_idx ON email_accounts (workspace_id, id);',
    `CREATE UNIQUE INDEX IF NOT EXISTS email_folders_workspace_account_id_unique_idx
  ON email_folders (workspace_id, account_id, id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS email_messages_workspace_account_folder_id_unique_idx
  ON email_messages (workspace_id, account_id, folder_id, id);`,
    `CREATE TABLE IF NOT EXISTS mail_acl_bindings (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('account', 'folder', 'message')),
  account_id bigint NOT NULL,
  folder_id bigint,
  message_id bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  subject_user_id uuid GENERATED ALWAYS AS (
    CASE WHEN subject_type = 'user' THEN subject_id::uuid END
  ) STORED,
  subject_group_id bigint GENERATED ALWAYS AS (
    CASE WHEN subject_type = 'group' THEN subject_id::bigint END
  ) STORED,
  CONSTRAINT mail_acl_bindings_subject_shape_check CHECK (
    (subject_type = 'user' AND subject_id = subject_user_id::text AND subject_group_id IS NULL)
    OR
    (subject_type = 'group' AND subject_id = subject_group_id::text AND subject_user_id IS NULL)
  ),
  CONSTRAINT mail_acl_bindings_resource_shape_check CHECK (
    (resource_type = 'account' AND folder_id IS NULL AND message_id IS NULL)
    OR
    (resource_type = 'folder' AND folder_id IS NOT NULL AND message_id IS NULL)
    OR
    (resource_type = 'message' AND folder_id IS NOT NULL AND message_id IS NOT NULL)
  ),
  CONSTRAINT mail_acl_bindings_subject_user_fk
    FOREIGN KEY (workspace_id, subject_user_id) REFERENCES users(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mail_acl_bindings_subject_group_fk
    FOREIGN KEY (workspace_id, subject_group_id) REFERENCES user_groups(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mail_acl_bindings_account_fk
    FOREIGN KEY (workspace_id, account_id) REFERENCES email_accounts(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mail_acl_bindings_folder_fk
    FOREIGN KEY (workspace_id, account_id, folder_id)
    REFERENCES email_folders(workspace_id, account_id, id) ON DELETE CASCADE,
  -- ON UPDATE CASCADE: a message-level binding references the message's CURRENT
  -- (account_id, folder_id), but a message legitimately moves — updateRelayedMessageContent
  -- reroutes a failed relay retry to a new account/folder, and the SQLite importer
  -- rewrites account_id/folder_id on re-import conflict. Without CASCADE the composite
  -- key vanishes and the move is rejected once a binding exists. Cascading keeps the
  -- per-message grant pointing at the same message (message_id fixed) at its new
  -- location, so both the SQL scope and the in-memory grant matcher (which compares
  -- current account/folder) stay correct. Folder/account bindings have NULL columns
  -- here (MATCH SIMPLE) and are untouched, so a folder grant does not follow the message.
  CONSTRAINT mail_acl_bindings_message_fk
    FOREIGN KEY (workspace_id, account_id, folder_id, message_id)
    REFERENCES email_messages(workspace_id, account_id, folder_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT mail_acl_bindings_created_by_fk
    FOREIGN KEY (workspace_id, created_by)
    REFERENCES users(workspace_id, id) ON DELETE SET NULL (created_by)
);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mail_acl_bindings_subject_resource_unique_idx
  ON mail_acl_bindings (
    workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id
  ) NULLS NOT DISTINCT;`,
    `CREATE INDEX IF NOT EXISTS mail_acl_bindings_workspace_subject_idx
  ON mail_acl_bindings (workspace_id, subject_type, subject_id);`,
    `CREATE INDEX IF NOT EXISTS mail_acl_bindings_workspace_account_idx
  ON mail_acl_bindings (workspace_id, account_id);`,
    `CREATE INDEX IF NOT EXISTS mail_acl_bindings_workspace_folder_idx
  ON mail_acl_bindings (workspace_id, folder_id);`,
    `CREATE INDEX IF NOT EXISTS mail_acl_bindings_workspace_message_idx
  ON mail_acl_bindings (workspace_id, message_id);`,
    `CREATE TABLE IF NOT EXISTS mail_acl_binding_permissions (
  binding_id bigint NOT NULL REFERENCES mail_acl_bindings(id) ON DELETE CASCADE,
  permission_key text NOT NULL CHECK (permission_key IN (${permissionCheckSql})),
  PRIMARY KEY (binding_id, permission_key)
);`,
    `ALTER TABLE mail_acl_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_acl_binding_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_acl_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE mail_acl_binding_permissions FORCE ROW LEVEL SECURITY;`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mail_acl_bindings'
      AND policyname = 'mail_acl_bindings_workspace_isolation'
  ) THEN
    CREATE POLICY mail_acl_bindings_workspace_isolation ON mail_acl_bindings
      USING (app.can_access_workspace(workspace_id))
      WITH CHECK (app.can_access_workspace(workspace_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mail_acl_binding_permissions'
      AND policyname = 'mail_acl_binding_permissions_workspace_isolation'
  ) THEN
    CREATE POLICY mail_acl_binding_permissions_workspace_isolation ON mail_acl_binding_permissions
      USING (EXISTS (
        SELECT 1 FROM mail_acl_bindings AS binding
        WHERE binding.id = binding_id
          AND app.can_access_workspace(binding.workspace_id)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM mail_acl_bindings AS binding
        WHERE binding.id = binding_id
          AND app.can_access_workspace(binding.workspace_id)
      ));
  END IF;
END $$;`,
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    `INSERT INTO mail_acl_bindings (
  workspace_id,
  subject_type,
  subject_id,
  resource_type,
  account_id,
  created_at,
  updated_at
)
SELECT
  workspace_id,
  'user',
  user_id::text,
  'account',
  account_id,
  created_at,
  created_at
FROM user_account_access
WHERE can_read OR can_send
ON CONFLICT DO NOTHING;`,
    `INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
SELECT binding.id, permission.permission_key
FROM user_account_access AS legacy
JOIN mail_acl_bindings AS binding
  ON binding.workspace_id = legacy.workspace_id
  AND binding.subject_type = 'user'
  AND binding.subject_id = legacy.user_id::text
  AND binding.resource_type = 'account'
  AND binding.account_id = legacy.account_id
  AND binding.folder_id IS NULL
  AND binding.message_id IS NULL
CROSS JOIN LATERAL (
  VALUES
    ('mail.metadata.read', legacy.can_read),
    ('mail.content.read', legacy.can_read),
    ('mail.attachment.read', legacy.can_read),
    ('mail.draft.create', legacy.can_send),
    ('mail.draft.edit', legacy.can_send),
    ('mail.send', legacy.can_send)
) AS permission(permission_key, granted)
WHERE permission.granted
ON CONFLICT DO NOTHING;`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS mail_acl_binding_permissions;',
    'DROP TABLE IF EXISTS mail_acl_bindings;',
    'DROP INDEX IF EXISTS email_messages_workspace_account_folder_id_unique_idx;',
    'DROP INDEX IF EXISTS email_folders_workspace_account_id_unique_idx;',
    'DROP INDEX IF EXISTS email_accounts_workspace_id_unique_idx;',
    'DROP INDEX IF EXISTS user_groups_workspace_id_unique_idx;',
    'DROP INDEX IF EXISTS users_workspace_id_unique_idx;',
  ],
};
