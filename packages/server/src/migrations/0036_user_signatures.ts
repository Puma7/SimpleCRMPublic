import type { SqlMigration } from './types';

export const userSignaturesMigration: SqlMigration = {
  id: '0036_user_signatures',
  description: 'Per-user public name and per-user, per-account email signatures',
  upSql: [
    // Public-facing alias a user can drop into signatures via {{user.publicName}}.
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS public_name text;',

    `CREATE TABLE IF NOT EXISTS user_account_signatures (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  signature_html text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, account_id)
);`,
    'ALTER TABLE user_account_signatures ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE user_account_signatures FORCE ROW LEVEL SECURITY;',
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_account_signatures'
      AND policyname = 'user_account_signatures_workspace_isolation'
  ) THEN
    CREATE POLICY user_account_signatures_workspace_isolation ON user_account_signatures
      USING (app.can_access_workspace(workspace_id))
      WITH CHECK (app.can_access_workspace(workspace_id));
  END IF;
END $$;`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS user_account_signatures;',
    'ALTER TABLE users DROP COLUMN IF EXISTS public_name;',
  ],
};
