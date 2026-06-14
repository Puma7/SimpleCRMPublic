export type WorkflowSecurityImportPgClient = Readonly<{
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
}>;

export type WorkflowSecurityImportInput = Readonly<{
  workspaceId: string;
  runId: string;
}>;

export type WorkflowSecurityImportCommand = Readonly<{
  tableName: string;
  sql: string;
  params: readonly unknown[];
}>;

const importOrder = [
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
] as const;

export async function runPostgresWorkflowSecurityImport(
  client: WorkflowSecurityImportPgClient,
  input: WorkflowSecurityImportInput,
): Promise<void> {
  for (const command of buildWorkflowSecurityImportCommands(input)) {
    await client.query(command.sql, command.params);
  }
}

export function buildWorkflowSecurityImportCommands(
  input: WorkflowSecurityImportInput,
): readonly WorkflowSecurityImportCommand[] {
  if (!input.workspaceId.trim()) {
    throw new Error('workspaceId is required for workflow/security import');
  }
  if (!input.runId.trim()) {
    throw new Error('runId is required for workflow/security import');
  }

  return importOrder.map((tableName) => ({
    tableName,
    sql: importSqlByTable[tableName],
    params: [input.workspaceId, tableName, input.runId],
  }));
}

const rowsFrom = 'FROM sqlite_import_rows r';
const rowsWhere = `WHERE r.workspace_id = $1
  AND r.table_name = $2
  AND r.imported_in_run_id = $3`;
const idRowsFilter = `${rowsFrom}
${rowsWhere}
  AND r.source_row ? 'id'`;

const importSqlByTable: Record<typeof importOrder[number], string> = {
  email_ai_profiles: `INSERT INTO email_ai_profiles (
  workspace_id, source_sqlite_id, label, provider, base_url, model, embedding_model,
  legacy_keytar_account, is_default, sort_order, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'label', ''), 'AI profile ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'provider', ''), 'custom'),
  COALESCE(NULLIF(r.source_row->>'base_url', ''), 'http://localhost'),
  COALESCE(NULLIF(r.source_row->>'model', ''), 'unknown'),
  NULLIF(r.source_row->>'embedding_model', ''),
  NULLIF(r.source_row->>'keytar_account', ''),
  COALESCE(${sqliteBoolean('is_default')}, false),
  COALESCE(NULLIF(r.source_row->>'sort_order', '')::integer, 0),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${idRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  label = EXCLUDED.label,
  provider = EXCLUDED.provider,
  base_url = EXCLUDED.base_url,
  model = EXCLUDED.model,
  embedding_model = EXCLUDED.embedding_model,
  legacy_keytar_account = EXCLUDED.legacy_keytar_account,
  is_default = EXCLUDED.is_default,
  sort_order = EXCLUDED.sort_order,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_ai_prompts: `INSERT INTO email_ai_prompts (
  workspace_id, source_sqlite_id, label, user_template, target, profile_source_sqlite_id,
  profile_id, account_source_sqlite_id, account_id, override_key, sort_order, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'label', ''), 'AI prompt ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'user_template', ''), ''),
  COALESCE(NULLIF(r.source_row->>'target', ''), 'full_body'),
  NULLIF(r.source_row->>'profile_id', '')::bigint,
  p.id,
  NULLIF(r.source_row->>'account_id', '')::bigint,
  a.id,
  NULLIF(r.source_row->>'override_key', ''),
  COALESCE(NULLIF(r.source_row->>'sort_order', '')::integer, 0),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_ai_profiles p
  ON p.workspace_id = $1
 AND p.source_sqlite_id = NULLIF(r.source_row->>'profile_id', '')::bigint
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  label = EXCLUDED.label,
  user_template = EXCLUDED.user_template,
  target = EXCLUDED.target,
  profile_source_sqlite_id = EXCLUDED.profile_source_sqlite_id,
  profile_id = EXCLUDED.profile_id,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  override_key = EXCLUDED.override_key,
  sort_order = EXCLUDED.sort_order,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_workflows: `INSERT INTO email_workflows (
  workspace_id, source_sqlite_id, name, trigger_name, enabled, priority, definition_json,
  graph_json, cron_expr, schedule_account_source_sqlite_id, schedule_account_id,
  account_source_sqlite_id, account_id, override_key,
  execution_mode, engine_version, legacy_created_by_user_id, created_by_user_id, source_row, imported_in_run_id,
  created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'name', ''), 'Workflow ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'trigger', ''), 'manual'),
  COALESCE(${sqliteBoolean('enabled')}, true),
  COALESCE(NULLIF(r.source_row->>'priority', '')::integer, 100),
  COALESCE(NULLIF(r.source_row->>'definition_json', '')::jsonb, '{}'::jsonb),
  ${jsonbField('graph_json')},
  NULLIF(r.source_row->>'cron_expr', ''),
  NULLIF(r.source_row->>'schedule_account_id', '')::bigint,
  schedule_account.id,
  NULLIF(r.source_row->>'account_id', '')::bigint,
  scope_account.id,
  NULLIF(r.source_row->>'override_key', ''),
  COALESCE(NULLIF(r.source_row->>'execution_mode', ''), 'graph'),
  COALESCE(NULLIF(r.source_row->>'engine_version', '')::integer, 1),
  NULLIF(r.source_row->>'created_by_user_id', ''),
  NULL,
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts schedule_account
  ON schedule_account.workspace_id = $1
 AND schedule_account.source_sqlite_id = NULLIF(r.source_row->>'schedule_account_id', '')::bigint
LEFT JOIN email_accounts scope_account
  ON scope_account.workspace_id = $1
 AND scope_account.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  name = EXCLUDED.name,
  trigger_name = EXCLUDED.trigger_name,
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  definition_json = EXCLUDED.definition_json,
  graph_json = EXCLUDED.graph_json,
  cron_expr = EXCLUDED.cron_expr,
  schedule_account_source_sqlite_id = EXCLUDED.schedule_account_source_sqlite_id,
  schedule_account_id = EXCLUDED.schedule_account_id,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  override_key = EXCLUDED.override_key,
  execution_mode = EXCLUDED.execution_mode,
  engine_version = EXCLUDED.engine_version,
  legacy_created_by_user_id = EXCLUDED.legacy_created_by_user_id,
  created_by_user_id = EXCLUDED.created_by_user_id,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  email_workflow_versions: workflowChildSql('email_workflow_versions', [
    'label', 'graph_json', 'definition_json',
  ], `COALESCE(NULLIF(r.source_row->>'label', ''), 'Version ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'graph_json', '')::jsonb, '{}'::jsonb),
  COALESCE(NULLIF(r.source_row->>'definition_json', '')::jsonb, '{}'::jsonb)`),
  email_workflow_runs: `INSERT INTO email_workflow_runs (
  workspace_id, source_sqlite_id, workflow_source_sqlite_id, message_source_sqlite_id,
  workflow_id, message_id, direction, status, log_json, source_row, imported_in_run_id,
  started_at, finished_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'workflow_id')::bigint,
  NULLIF(r.source_row->>'message_id', '')::bigint, w.id, m.id,
  COALESCE(NULLIF(r.source_row->>'direction', ''), 'inbound'),
  COALESCE(NULLIF(r.source_row->>'status', ''), 'pending'),
  ${jsonbField('log_json')},
  r.source_row, $3, NULLIF(r.source_row->>'started_at', '')::timestamptz,
  NULLIF(r.source_row->>'finished_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_workflows w
  ON w.workspace_id = $1
 AND w.source_sqlite_id = (r.source_row->>'workflow_id')::bigint
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = NULLIF(r.source_row->>'message_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  workflow_source_sqlite_id = EXCLUDED.workflow_source_sqlite_id,
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  workflow_id = EXCLUDED.workflow_id,
  message_id = EXCLUDED.message_id,
  direction = EXCLUDED.direction,
  status = EXCLUDED.status,
  log_json = EXCLUDED.log_json,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  started_at = EXCLUDED.started_at,
  finished_at = EXCLUDED.finished_at,
  updated_at = now()`,
  email_workflow_run_steps: runStepSql(),
  email_message_workflow_applied: messageWorkflowJoinSql('email_message_workflow_applied', 'applied_at'),
  email_workflow_forward_dedup: workflowForwardDedupSql(),
  workflow_knowledge_bases: `INSERT INTO workflow_knowledge_bases (
  workspace_id, source_sqlite_id, name, description, account_source_sqlite_id, account_id, override_key,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'name', ''), 'Knowledge base ' || (r.source_row->>'id')),
  NULLIF(r.source_row->>'description', ''),
  NULLIF(r.source_row->>'account_id', '')::bigint,
  a.id,
  NULLIF(r.source_row->>'override_key', ''),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  override_key = EXCLUDED.override_key,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  workflow_knowledge_chunks: knowledgeChunkSql(),
  workflow_delayed_jobs: delayedJobSql(),
  email_spam_list_entries: spamListSql(),
  email_spam_learning_events: spamLearningSql(),
  email_spam_feature_stats: `INSERT INTO email_spam_feature_stats (
  workspace_id, feature_key, spam_count, ham_count, source_row, imported_in_run_id, updated_at
)
SELECT
  $1, r.source_pk,
  COALESCE(NULLIF(r.source_row->>'spam_count', '')::integer, 0),
  COALESCE(NULLIF(r.source_row->>'ham_count', '')::integer, 0),
  r.source_row, $3, COALESCE(NULLIF(r.source_row->>'updated_at', '')::timestamptz, now())
${rowsFrom}
${rowsWhere}
ON CONFLICT (workspace_id, feature_key)
DO UPDATE SET
  spam_count = EXCLUDED.spam_count,
  ham_count = EXCLUDED.ham_count,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = EXCLUDED.updated_at`,
  email_spam_decisions: spamDecisionSql(),
  pgp_identities: pgpIdentitiesSql(),
  pgp_peer_keys: pgpPeerKeysSql(),
};

function sqliteBoolean(fieldName: string): string {
  return `CASE lower(NULLIF(r.source_row->>'${fieldName}', ''))
    WHEN '1' THEN true
    WHEN 'true' THEN true
    WHEN 'yes' THEN true
    WHEN '0' THEN false
    WHEN 'false' THEN false
    WHEN 'no' THEN false
    ELSE NULL
  END`;
}

function jsonbField(fieldName: string): string {
  return `CASE WHEN NULLIF(r.source_row->>'${fieldName}', '') IS NULL THEN NULL ELSE (r.source_row->>'${fieldName}')::jsonb END`;
}

function workflowChildSql(tableName: string, columns: readonly string[], selectSql: string): string {
  return `INSERT INTO ${tableName} (
  workspace_id, source_sqlite_id, workflow_source_sqlite_id, workflow_id, ${columns.join(', ')},
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'workflow_id')::bigint, w.id,
  ${selectSql},
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_workflows w
  ON w.workspace_id = $1
 AND w.source_sqlite_id = (r.source_row->>'workflow_id')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  workflow_source_sqlite_id = EXCLUDED.workflow_source_sqlite_id,
  workflow_id = EXCLUDED.workflow_id,
  ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(',\n  ')},
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function runStepSql(): string {
  return `INSERT INTO email_workflow_run_steps (
  workspace_id, source_sqlite_id, run_source_sqlite_id, run_id, node_id, node_type,
  status, port, duration_ms, message, detail_json, source_row, imported_in_run_id,
  created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'run_id')::bigint, wr.id,
  COALESCE(NULLIF(r.source_row->>'node_id', ''), ''),
  COALESCE(NULLIF(r.source_row->>'node_type', ''), ''),
  COALESCE(NULLIF(r.source_row->>'status', ''), 'pending'),
  NULLIF(r.source_row->>'port', ''),
  COALESCE(NULLIF(r.source_row->>'duration_ms', '')::integer, 0),
  NULLIF(r.source_row->>'message', ''),
  ${jsonbField('detail_json')},
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_workflow_runs wr
  ON wr.workspace_id = $1
 AND wr.source_sqlite_id = (r.source_row->>'run_id')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  run_source_sqlite_id = EXCLUDED.run_source_sqlite_id,
  run_id = EXCLUDED.run_id,
  node_id = EXCLUDED.node_id,
  node_type = EXCLUDED.node_type,
  status = EXCLUDED.status,
  port = EXCLUDED.port,
  duration_ms = EXCLUDED.duration_ms,
  message = EXCLUDED.message,
  detail_json = EXCLUDED.detail_json,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function messageWorkflowJoinSql(tableName: string, timestampField: string): string {
  return `INSERT INTO ${tableName} (
  workspace_id, source_sqlite_id, message_source_sqlite_id, workflow_source_sqlite_id,
  message_id, workflow_id, source_row, imported_in_run_id, ${timestampField}, updated_at
)
SELECT
  $1, r.source_pk::bigint, (r.source_row->>'message_id')::bigint,
  (r.source_row->>'workflow_id')::bigint, m.id, w.id, r.source_row, $3,
  NULLIF(r.source_row->>'${timestampField}', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = (r.source_row->>'message_id')::bigint
LEFT JOIN email_workflows w
  ON w.workspace_id = $1
 AND w.source_sqlite_id = (r.source_row->>'workflow_id')::bigint
${rowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  workflow_source_sqlite_id = EXCLUDED.workflow_source_sqlite_id,
  message_id = EXCLUDED.message_id,
  workflow_id = EXCLUDED.workflow_id,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  ${timestampField} = EXCLUDED.${timestampField},
  updated_at = now()`;
}

function workflowForwardDedupSql(): string {
  return `INSERT INTO email_workflow_forward_dedup (
  workspace_id, source_sqlite_id, message_source_sqlite_id, workflow_source_sqlite_id,
  message_id, workflow_id, dest, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, r.source_pk::bigint, (r.source_row->>'message_id')::bigint,
  (r.source_row->>'workflow_id')::bigint, m.id, w.id,
  COALESCE(NULLIF(r.source_row->>'dest', ''), ''),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = (r.source_row->>'message_id')::bigint
LEFT JOIN email_workflows w
  ON w.workspace_id = $1
 AND w.source_sqlite_id = (r.source_row->>'workflow_id')::bigint
${rowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  workflow_source_sqlite_id = EXCLUDED.workflow_source_sqlite_id,
  message_id = EXCLUDED.message_id,
  workflow_id = EXCLUDED.workflow_id,
  dest = EXCLUDED.dest,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function knowledgeChunkSql(): string {
  return `INSERT INTO workflow_knowledge_chunks (
  workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id,
  title, content, source_path, embedding_json, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'knowledge_base_id')::bigint, kb.id,
  NULLIF(r.source_row->>'title', ''),
  COALESCE(NULLIF(r.source_row->>'content', ''), ''),
  NULLIF(r.source_row->>'source_path', ''),
  ${jsonbField('embedding_json')},
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN workflow_knowledge_bases kb
  ON kb.workspace_id = $1
 AND kb.source_sqlite_id = (r.source_row->>'knowledge_base_id')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  knowledge_base_source_sqlite_id = EXCLUDED.knowledge_base_source_sqlite_id,
  knowledge_base_id = EXCLUDED.knowledge_base_id,
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  source_path = EXCLUDED.source_path,
  embedding_json = EXCLUDED.embedding_json,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function delayedJobSql(): string {
  return `INSERT INTO workflow_delayed_jobs (
  workspace_id, source_sqlite_id, workflow_source_sqlite_id, message_source_sqlite_id,
  workflow_id, message_id, resume_node_id, execute_at, context_json, status,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, (r.source_row->>'workflow_id')::bigint,
  NULLIF(r.source_row->>'message_id', '')::bigint, w.id, m.id,
  NULLIF(r.source_row->>'resume_node_id', ''),
  COALESCE(NULLIF(r.source_row->>'execute_at', '')::timestamptz, now()),
  ${jsonbField('context_json')},
  COALESCE(NULLIF(r.source_row->>'status', ''), 'pending'),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_workflows w
  ON w.workspace_id = $1
 AND w.source_sqlite_id = (r.source_row->>'workflow_id')::bigint
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = NULLIF(r.source_row->>'message_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  workflow_source_sqlite_id = EXCLUDED.workflow_source_sqlite_id,
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  workflow_id = EXCLUDED.workflow_id,
  message_id = EXCLUDED.message_id,
  resume_node_id = EXCLUDED.resume_node_id,
  execute_at = EXCLUDED.execute_at,
  context_json = EXCLUDED.context_json,
  status = EXCLUDED.status,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function spamListSql(): string {
  return `INSERT INTO email_spam_list_entries (
  workspace_id, source_sqlite_id, list_type, pattern_type, pattern, account_source_sqlite_id,
  account_id, note, source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'list_type', ''), 'block'),
  COALESCE(NULLIF(r.source_row->>'pattern_type', ''), 'email'),
  COALESCE(NULLIF(r.source_row->>'pattern', ''), ''),
  NULLIF(r.source_row->>'account_id', '')::bigint,
  a.id,
  NULLIF(r.source_row->>'note', ''),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz,
  COALESCE(NULLIF(r.source_row->>'updated_at', '')::timestamptz, now())
${rowsFrom}
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = NULLIF(r.source_row->>'account_id', '')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  list_type = EXCLUDED.list_type,
  pattern_type = EXCLUDED.pattern_type,
  pattern = EXCLUDED.pattern,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  account_id = EXCLUDED.account_id,
  note = EXCLUDED.note,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at`;
}

function spamLearningSql(): string {
  return `INSERT INTO email_spam_learning_events (
  workspace_id, source_sqlite_id, message_source_sqlite_id, account_source_sqlite_id,
  message_id, account_id, label, source, feature_keys_json, source_row, imported_in_run_id,
  created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, NULLIF(r.source_row->>'message_id', '')::bigint,
  (r.source_row->>'account_id')::bigint, m.id, a.id,
  COALESCE(NULLIF(r.source_row->>'label', ''), 'spam'),
  COALESCE(NULLIF(r.source_row->>'source', ''), 'import'),
  ${jsonbField('feature_keys_json')},
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = NULLIF(r.source_row->>'message_id', '')::bigint
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = (r.source_row->>'account_id')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  message_id = EXCLUDED.message_id,
  account_id = EXCLUDED.account_id,
  label = EXCLUDED.label,
  source = EXCLUDED.source,
  feature_keys_json = EXCLUDED.feature_keys_json,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function spamDecisionSql(): string {
  return `INSERT INTO email_spam_decisions (
  workspace_id, source_sqlite_id, message_source_sqlite_id, account_source_sqlite_id,
  message_id, account_id, score, status, source, breakdown_json, model_version,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, NULLIF(r.source_row->>'message_id', '')::bigint,
  (r.source_row->>'account_id')::bigint, m.id, a.id,
  COALESCE(NULLIF(r.source_row->>'score', '')::integer, 0),
  COALESCE(NULLIF(r.source_row->>'status', ''), 'clean'),
  COALESCE(NULLIF(r.source_row->>'source', ''), 'import'),
  ${jsonbField('breakdown_json')},
  COALESCE(NULLIF(r.source_row->>'model_version', '')::integer, 1),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${rowsFrom}
LEFT JOIN email_messages m
  ON m.workspace_id = $1
 AND m.source_sqlite_id = NULLIF(r.source_row->>'message_id', '')::bigint
LEFT JOIN email_accounts a
  ON a.workspace_id = $1
 AND a.source_sqlite_id = (r.source_row->>'account_id')::bigint
${rowsWhere}
  AND r.source_row ? 'id'
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  message_source_sqlite_id = EXCLUDED.message_source_sqlite_id,
  account_source_sqlite_id = EXCLUDED.account_source_sqlite_id,
  message_id = EXCLUDED.message_id,
  account_id = EXCLUDED.account_id,
  score = EXCLUDED.score,
  status = EXCLUDED.status,
  source = EXCLUDED.source,
  breakdown_json = EXCLUDED.breakdown_json,
  model_version = EXCLUDED.model_version,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function pgpIdentitiesSql(): string {
  return `INSERT INTO pgp_identities (
  workspace_id, source_sqlite_id, legacy_user_id, email, fingerprint, public_key_armor,
  has_private_key, legacy_keytar_private_key_handle, expires_at, is_primary,
  source_row, imported_in_run_id, created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint, NULLIF(r.source_row->>'user_id', ''),
  COALESCE(NULLIF(r.source_row->>'email', ''), ''),
  COALESCE(NULLIF(r.source_row->>'fingerprint', ''), ''),
  COALESCE(NULLIF(r.source_row->>'public_key_armor', ''), ''),
  COALESCE(${sqliteBoolean('has_private_key')}, false),
  NULLIF(r.source_row->>'keytar_private_key_handle', ''),
  NULLIF(r.source_row->>'expires_at', '')::timestamptz,
  COALESCE(${sqliteBoolean('is_primary')}, false),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${idRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  legacy_user_id = EXCLUDED.legacy_user_id,
  email = EXCLUDED.email,
  fingerprint = EXCLUDED.fingerprint,
  public_key_armor = EXCLUDED.public_key_armor,
  has_private_key = EXCLUDED.has_private_key,
  legacy_keytar_private_key_handle = EXCLUDED.legacy_keytar_private_key_handle,
  expires_at = EXCLUDED.expires_at,
  is_primary = EXCLUDED.is_primary,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}

function pgpPeerKeysSql(): string {
  return `INSERT INTO pgp_peer_keys (
  workspace_id, source_sqlite_id, email, fingerprint, public_key_armor, source,
  verified_at, legacy_verified_by_user_id, trust_level, source_row, imported_in_run_id,
  created_at, updated_at
)
SELECT
  $1, (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'email', ''), ''),
  COALESCE(NULLIF(r.source_row->>'fingerprint', ''), ''),
  COALESCE(NULLIF(r.source_row->>'public_key_armor', ''), ''),
  COALESCE(NULLIF(r.source_row->>'source', ''), 'import'),
  NULLIF(r.source_row->>'verified_at', '')::timestamptz,
  NULLIF(r.source_row->>'verified_by_user_id', ''),
  COALESCE(NULLIF(r.source_row->>'trust_level', ''), 'unknown'),
  r.source_row, $3, NULLIF(r.source_row->>'created_at', '')::timestamptz, now()
${idRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  email = EXCLUDED.email,
  fingerprint = EXCLUDED.fingerprint,
  public_key_armor = EXCLUDED.public_key_armor,
  source = EXCLUDED.source,
  verified_at = EXCLUDED.verified_at,
  legacy_verified_by_user_id = EXCLUDED.legacy_verified_by_user_id,
  trust_level = EXCLUDED.trust_level,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`;
}
