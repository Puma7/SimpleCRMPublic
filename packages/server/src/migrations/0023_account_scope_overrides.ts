import type { SqlMigration } from './types';

export const accountScopeOverridesMigration: SqlMigration = {
  id: '0023_account_scope_overrides',
  description: 'Account-scoped mail settings: thread namespaces and global plus account-specific overrides.',
  upSql: [
    'ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL;',
    'ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS account_source_sqlite_id bigint;',
    'ALTER TABLE email_threads DROP CONSTRAINT IF EXISTS email_threads_workspace_id_ticket_code_key;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_threads_workspace_account_ticket_idx ON email_threads (workspace_id, account_id, ticket_code);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_threads_workspace_global_ticket_idx ON email_threads (workspace_id, ticket_code) WHERE account_id IS NULL;',

    `CREATE TABLE IF NOT EXISTS email_account_mail_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_source_sqlite_id bigint NOT NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  ticket_prefix text NOT NULL,
  ticket_next_number bigint NOT NULL DEFAULT 1,
  ticket_number_padding integer NOT NULL DEFAULT 6,
  thread_namespace text NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_source_sqlite_id),
  UNIQUE (workspace_id, account_id),
  UNIQUE (workspace_id, ticket_prefix),
  UNIQUE (workspace_id, thread_namespace)
);`,
    'CREATE INDEX IF NOT EXISTS email_account_mail_settings_account_idx ON email_account_mail_settings (workspace_id, account_id);',
    'ALTER TABLE email_account_mail_settings ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE email_account_mail_settings FORCE ROW LEVEL SECURITY;',
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'email_account_mail_settings'
      AND policyname = 'email_account_mail_settings_workspace_isolation'
  ) THEN
    CREATE POLICY email_account_mail_settings_workspace_isolation ON email_account_mail_settings
      USING (app.can_access_workspace(workspace_id))
      WITH CHECK (app.can_access_workspace(workspace_id));
  END IF;
END $$;`,

    'ALTER TABLE email_thread_aliases ADD COLUMN IF NOT EXISTS account_source_sqlite_id bigint;',
    'ALTER TABLE email_thread_aliases ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_account_pair_all_idx ON email_thread_aliases (workspace_id, account_id, alias_thread_id, canonical_thread_id);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_account_pair_idx ON email_thread_aliases (workspace_id, account_id, alias_thread_id, canonical_thread_id) WHERE account_id IS NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_global_pair_idx ON email_thread_aliases (workspace_id, alias_thread_id, canonical_thread_id) WHERE account_id IS NULL;',

    'ALTER TABLE email_canned_responses ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE;',
    'ALTER TABLE email_canned_responses ADD COLUMN IF NOT EXISTS override_key text;',
    'CREATE INDEX IF NOT EXISTS email_canned_responses_scope_idx ON email_canned_responses (workspace_id, account_id, override_key, sort_order);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_canned_responses_account_override_key_idx ON email_canned_responses (workspace_id, account_id, override_key) WHERE override_key IS NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_canned_responses_global_override_key_idx ON email_canned_responses (workspace_id, override_key) WHERE account_id IS NULL AND override_key IS NOT NULL;',

    'ALTER TABLE email_ai_prompts ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE;',
    'ALTER TABLE email_ai_prompts ADD COLUMN IF NOT EXISTS override_key text;',
    'CREATE INDEX IF NOT EXISTS email_ai_prompts_scope_idx ON email_ai_prompts (workspace_id, account_id, override_key, sort_order);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_ai_prompts_account_override_key_idx ON email_ai_prompts (workspace_id, account_id, override_key) WHERE override_key IS NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_ai_prompts_global_override_key_idx ON email_ai_prompts (workspace_id, override_key) WHERE account_id IS NULL AND override_key IS NOT NULL;',

    'ALTER TABLE workflow_knowledge_bases ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE;',
    'ALTER TABLE workflow_knowledge_bases ADD COLUMN IF NOT EXISTS override_key text;',
    'CREATE INDEX IF NOT EXISTS workflow_knowledge_bases_scope_idx ON workflow_knowledge_bases (workspace_id, account_id, override_key);',

    'ALTER TABLE email_workflows ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE;',
    'ALTER TABLE email_workflows ADD COLUMN IF NOT EXISTS override_key text;',
    'CREATE INDEX IF NOT EXISTS email_workflows_scope_idx ON email_workflows (workspace_id, account_id, override_key, trigger_name, enabled, priority);',
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_workflows_scope_idx;',
    'DROP INDEX IF EXISTS workflow_knowledge_bases_scope_idx;',
    'DROP INDEX IF EXISTS email_thread_aliases_workspace_global_pair_idx;',
    'DROP INDEX IF EXISTS email_thread_aliases_workspace_account_pair_idx;',
    'DROP INDEX IF EXISTS email_thread_aliases_workspace_account_pair_all_idx;',
    'DROP INDEX IF EXISTS email_account_mail_settings_account_idx;',
    'DROP INDEX IF EXISTS email_ai_prompts_global_override_key_idx;',
    'DROP INDEX IF EXISTS email_ai_prompts_account_override_key_idx;',
    'DROP INDEX IF EXISTS email_ai_prompts_scope_idx;',
    'DROP INDEX IF EXISTS email_canned_responses_global_override_key_idx;',
    'DROP INDEX IF EXISTS email_canned_responses_account_override_key_idx;',
    'DROP INDEX IF EXISTS email_canned_responses_scope_idx;',
    'DROP INDEX IF EXISTS email_threads_workspace_global_ticket_idx;',
    'DROP INDEX IF EXISTS email_threads_workspace_account_ticket_idx;',
  ],
};
