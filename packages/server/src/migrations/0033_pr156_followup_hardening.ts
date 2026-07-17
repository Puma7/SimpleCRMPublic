import type { SqlMigration } from './types';

export const pr156FollowupHardeningMigration: SqlMigration = {
  id: '0033_pr156_followup_hardening',
  description: 'Workspace isolation and retry safety for validated PR 156 follow-ups',
  upSql: [
    `ALTER TABLE auth_mfa_email_codes ADD COLUMN workspace_id uuid;
UPDATE auth_mfa_email_codes AS code
SET workspace_id = app_user.workspace_id
FROM users AS app_user
WHERE app_user.id = code.user_id;
ALTER TABLE auth_mfa_email_codes
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT auth_mfa_email_codes_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;`,
    `CREATE INDEX auth_mfa_email_codes_workspace_user_active_idx
  ON auth_mfa_email_codes (workspace_id, user_id, expires_at DESC)
  WHERE consumed_at IS NULL;`,
    `ALTER TABLE auth_mfa_email_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_email_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_mfa_email_codes_workspace_isolation ON auth_mfa_email_codes
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `ALTER TABLE email_workflow_forward_dedup
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'sent'
  CHECK (delivery_status IN ('outbox', 'sent'));`,
  ],
  downSql: [
    'ALTER TABLE email_workflow_forward_dedup DROP COLUMN IF EXISTS delivery_status;',
    'DROP POLICY IF EXISTS auth_mfa_email_codes_workspace_isolation ON auth_mfa_email_codes;',
    `ALTER TABLE auth_mfa_email_codes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_mfa_email_codes DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS auth_mfa_email_codes_workspace_user_active_idx;
ALTER TABLE auth_mfa_email_codes DROP COLUMN IF EXISTS workspace_id;`,
  ],
};
