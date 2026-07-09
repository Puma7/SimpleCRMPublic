import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'email_ai_profiles',
  'email_ai_prompts',
  'email_workflows',
  'email_workflow_versions',
  'email_workflow_runs',
  'email_workflow_run_steps',
  'email_message_workflow_applied',
  'email_workflow_forward_dedup',
  'workflow_knowledge_bases',
  'workflow_knowledge_chunks',
  'workflow_delayed_jobs',
  'email_spam_list_entries',
  'email_spam_learning_events',
  'email_spam_feature_stats',
  'email_spam_decisions',
  'pgp_identities',
  'pgp_peer_keys',
  'automation_api_keys',
] as const;

export const workflowSecuritySchemaMigration: SqlMigration = {
  id: '0008_workflow_security_schema',
  description: 'Server edition workflow, AI, spam, PGP, and automation schema.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS email_ai_profiles (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  label text NOT NULL,
  provider text NOT NULL DEFAULT 'custom',
  base_url text NOT NULL,
  model text NOT NULL,
  embedding_model text,
  legacy_keytar_account text,
  secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_ai_profiles_workspace_default_idx ON email_ai_profiles (workspace_id, is_default, sort_order);',
    `CREATE TABLE IF NOT EXISTS email_ai_prompts (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  label text NOT NULL,
  user_template text NOT NULL,
  target text NOT NULL DEFAULT 'full_body',
  profile_source_sqlite_id bigint,
  profile_id bigint REFERENCES email_ai_profiles(id) ON DELETE SET NULL,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  override_key text,
  sort_order integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_ai_prompts_scope_idx ON email_ai_prompts (workspace_id, account_id, override_key, sort_order);',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_ai_prompts_account_override_key_idx ON email_ai_prompts (workspace_id, account_id, override_key) WHERE override_key IS NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS email_ai_prompts_global_override_key_idx ON email_ai_prompts (workspace_id, override_key) WHERE account_id IS NULL AND override_key IS NOT NULL;',
    `CREATE TABLE IF NOT EXISTS email_workflows (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  name text NOT NULL,
  trigger_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  definition_json jsonb NOT NULL,
  graph_json jsonb,
  cron_expr text,
  schedule_account_source_sqlite_id bigint,
  schedule_account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  override_key text,
  execution_mode text NOT NULL DEFAULT 'graph',
  engine_version integer NOT NULL DEFAULT 1,
  legacy_created_by_user_id text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_workflows_trigger_idx ON email_workflows (workspace_id, trigger_name, enabled, priority);',
    'CREATE INDEX IF NOT EXISTS email_workflows_scope_idx ON email_workflows (workspace_id, account_id, override_key, trigger_name, enabled, priority);',
    `CREATE TABLE IF NOT EXISTS email_workflow_versions (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  workflow_source_sqlite_id bigint NOT NULL,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  label text NOT NULL,
  graph_json jsonb NOT NULL,
  definition_json jsonb NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_workflow_runs (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  workflow_source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  direction text NOT NULL,
  status text NOT NULL,
  log_json jsonb,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_workflow_runs_message_idx ON email_workflow_runs (workspace_id, message_id);',
    `CREATE TABLE IF NOT EXISTS email_workflow_run_steps (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  run_source_sqlite_id bigint NOT NULL,
  run_id bigint REFERENCES email_workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL,
  port text,
  duration_ms integer NOT NULL DEFAULT 0,
  message text,
  detail_json jsonb,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_message_workflow_applied (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  workflow_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, message_source_sqlite_id, workflow_source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_workflow_forward_dedup (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint NOT NULL,
  workflow_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE CASCADE,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  dest text NOT NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, message_source_sqlite_id, workflow_source_sqlite_id, dest)
);`,
    `CREATE TABLE IF NOT EXISTS workflow_knowledge_bases (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  name text NOT NULL,
  description text,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  override_key text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS workflow_knowledge_bases_scope_idx ON workflow_knowledge_bases (workspace_id, account_id, override_key);',
    `CREATE TABLE IF NOT EXISTS workflow_knowledge_chunks (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  knowledge_base_source_sqlite_id bigint NOT NULL,
  knowledge_base_id bigint REFERENCES workflow_knowledge_bases(id) ON DELETE CASCADE,
  title text,
  content text NOT NULL,
  source_path text,
  embedding_json jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS workflow_knowledge_chunks_search_idx ON workflow_knowledge_chunks USING gin (search_vector);',
    `CREATE TABLE IF NOT EXISTS workflow_delayed_jobs (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  workflow_source_sqlite_id bigint NOT NULL,
  message_source_sqlite_id bigint,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  resume_node_id text,
  execute_at timestamptz NOT NULL,
  context_json jsonb,
  status text NOT NULL DEFAULT 'pending',
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS workflow_delayed_jobs_ready_idx ON workflow_delayed_jobs (workspace_id, status, execute_at);',
    `CREATE TABLE IF NOT EXISTS email_spam_list_entries (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  list_type text NOT NULL CHECK (list_type IN ('allow', 'block')),
  pattern_type text NOT NULL CHECK (pattern_type IN ('email', 'domain')),
  pattern text NOT NULL,
  account_source_sqlite_id bigint,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  note text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS email_spam_list_lookup_idx ON email_spam_list_entries (workspace_id, account_id, list_type, pattern_type, pattern);',
    `CREATE TABLE IF NOT EXISTS email_spam_learning_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  message_source_sqlite_id bigint,
  account_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label IN ('spam', 'ham')),
  source text NOT NULL,
  feature_keys_json jsonb,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_spam_feature_stats (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  spam_count integer NOT NULL DEFAULT 0,
  ham_count integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, feature_key)
);`,
    `CREATE TABLE IF NOT EXISTS email_spam_decisions (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  message_source_sqlite_id bigint,
  account_source_sqlite_id bigint NOT NULL,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE,
  score integer NOT NULL,
  status text NOT NULL CHECK (status IN ('clean', 'review', 'spam')),
  source text NOT NULL,
  breakdown_json jsonb,
  model_version integer NOT NULL DEFAULT 1,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS pgp_identities (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  legacy_user_id text,
  email text NOT NULL,
  fingerprint text NOT NULL,
  public_key_armor text NOT NULL,
  has_private_key boolean NOT NULL DEFAULT false,
  legacy_keytar_private_key_handle text,
  private_key_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  expires_at timestamptz,
  is_primary boolean NOT NULL DEFAULT false,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, fingerprint)
);`,
    `CREATE TABLE IF NOT EXISTS pgp_peer_keys (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint,
  email text NOT NULL,
  fingerprint text NOT NULL,
  public_key_armor text NOT NULL,
  source text NOT NULL,
  verified_at timestamptz,
  verified_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  legacy_verified_by_user_id text,
  trust_level text NOT NULL DEFAULT 'unknown',
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, fingerprint)
);`,
    `CREATE TABLE IF NOT EXISTS automation_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    `ALTER TABLE email_ai_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_ai_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_message_workflow_applied ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_forward_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_delayed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_spam_list_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_spam_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_spam_feature_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_spam_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgp_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgp_peer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_ai_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE email_ai_prompts FORCE ROW LEVEL SECURITY;
ALTER TABLE email_workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_run_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE email_message_workflow_applied FORCE ROW LEVEL SECURITY;
ALTER TABLE email_workflow_forward_dedup FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_knowledge_bases FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_knowledge_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_delayed_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE email_spam_list_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE email_spam_learning_events FORCE ROW LEVEL SECURITY;
ALTER TABLE email_spam_feature_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE email_spam_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE pgp_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE pgp_peer_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE automation_api_keys FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
  ],
  downSql: [
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS automation_api_keys;',
    'DROP TABLE IF EXISTS pgp_peer_keys;',
    'DROP TABLE IF EXISTS pgp_identities;',
    'DROP TABLE IF EXISTS email_spam_decisions;',
    'DROP TABLE IF EXISTS email_spam_feature_stats;',
    'DROP TABLE IF EXISTS email_spam_learning_events;',
    'DROP TABLE IF EXISTS email_spam_list_entries;',
    'DROP TABLE IF EXISTS workflow_delayed_jobs;',
    'DROP TABLE IF EXISTS workflow_knowledge_chunks;',
    'DROP TABLE IF EXISTS workflow_knowledge_bases;',
    'DROP TABLE IF EXISTS email_workflow_forward_dedup;',
    'DROP TABLE IF EXISTS email_message_workflow_applied;',
    'DROP TABLE IF EXISTS email_workflow_run_steps;',
    'DROP TABLE IF EXISTS email_workflow_runs;',
    'DROP TABLE IF EXISTS email_workflow_versions;',
    'DROP TABLE IF EXISTS email_workflows;',
    'DROP TABLE IF EXISTS email_ai_prompts;',
    'DROP TABLE IF EXISTS email_ai_profiles;',
  ],
};
