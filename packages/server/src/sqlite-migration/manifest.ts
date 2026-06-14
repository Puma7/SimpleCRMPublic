import type { SqliteMigrationPlan, SqliteMigrationTable } from './types';

const coreCrmTables: readonly SqliteMigrationTable[] = [
  {
    name: 'sync_info',
    category: 'crm',
    primaryKey: 'key',
    required: true,
    notes: 'Stores local sync metadata and must be imported before domain rows are reconciled.',
  },
  {
    name: 'customers',
    category: 'crm',
    primaryKey: 'id',
    required: true,
  },
  {
    name: 'products',
    category: 'crm',
    primaryKey: 'id',
    required: true,
  },
  {
    name: 'deals',
    category: 'crm',
    primaryKey: 'id',
    required: true,
    dependsOn: ['customers'],
  },
  {
    name: 'tasks',
    category: 'crm',
    primaryKey: 'id',
    required: true,
    dependsOn: ['customers'],
  },
  {
    name: 'deal_products',
    category: 'crm',
    primaryKey: 'id',
    required: true,
    dependsOn: ['deals', 'products'],
  },
  {
    name: 'calendar_events',
    category: 'crm',
    primaryKey: 'id',
    required: true,
    dependsOn: ['tasks'],
  },
  {
    name: 'customer_custom_fields',
    category: 'crm',
    primaryKey: 'id',
    required: true,
  },
  {
    name: 'customer_custom_field_values',
    category: 'crm',
    primaryKey: 'id',
    required: true,
    dependsOn: ['customers', 'customer_custom_fields'],
  },
  {
    name: 'activity_log',
    category: 'crm',
    primaryKey: 'id',
    required: true,
    dependsOn: ['customers', 'deals', 'tasks'],
  },
  {
    name: 'saved_views',
    category: 'crm',
    primaryKey: 'id',
    required: true,
  },
];

const jtlReferenceTables: readonly SqliteMigrationTable[] = [
  { name: 'jtl_firmen', category: 'jtl', primaryKey: 'kFirma', required: false },
  { name: 'jtl_warenlager', category: 'jtl', primaryKey: 'kWarenlager', required: false },
  { name: 'jtl_zahlungsarten', category: 'jtl', primaryKey: 'kZahlungsart', required: false },
  { name: 'jtl_versandarten', category: 'jtl', primaryKey: 'kVersandart', required: false },
];

const emailTables: readonly SqliteMigrationTable[] = [
  { name: 'email_accounts', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_account_mail_settings', category: 'mail', primaryKey: 'account_id', required: false, dependsOn: ['email_accounts'] },
  { name: 'email_folders', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_accounts'] },
  { name: 'email_messages', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_accounts', 'email_folders'] },
  { name: 'email_threads', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_categories', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_message_categories', category: 'mail', primaryKey: 'rowid', required: false, dependsOn: ['email_messages', 'email_categories'] },
  { name: 'email_message_tags', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_messages'] },
  { name: 'email_internal_notes', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_messages'] },
  { name: 'email_canned_responses', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_ai_profiles', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_ai_prompts', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_ai_profiles'] },
  { name: 'email_team_members', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_account_signatures', category: 'mail', primaryKey: 'account_id', required: false, dependsOn: ['email_accounts'] },
  { name: 'email_message_attachments', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_messages'] },
  { name: 'email_workflows', category: 'workflow', primaryKey: 'id', required: false },
  { name: 'email_workflow_versions', category: 'workflow', primaryKey: 'id', required: false, dependsOn: ['email_workflows'] },
  { name: 'email_workflow_runs', category: 'workflow', primaryKey: 'id', required: false, dependsOn: ['email_workflows'] },
  { name: 'email_message_workflow_applied', category: 'workflow', primaryKey: 'rowid', required: false, dependsOn: ['email_messages', 'email_workflows'] },
  { name: 'email_workflow_forward_dedup', category: 'workflow', primaryKey: 'rowid', required: false },
  { name: 'email_workflow_run_steps', category: 'workflow', primaryKey: 'id', required: false, dependsOn: ['email_workflow_runs'] },
  { name: 'workflow_knowledge_bases', category: 'workflow', primaryKey: 'id', required: false },
  { name: 'workflow_knowledge_chunks', category: 'workflow', primaryKey: 'id', required: false, dependsOn: ['workflow_knowledge_bases'] },
  { name: 'workflow_delayed_jobs', category: 'workflow', primaryKey: 'id', required: false },
  { name: 'email_remote_content_allowlist', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_read_receipt_log', category: 'mail', primaryKey: 'id', required: false, dependsOn: ['email_messages'] },
  { name: 'email_thread_edges', category: 'mail', primaryKey: 'rowid', required: false, dependsOn: ['email_messages'] },
  { name: 'email_thread_aliases', category: 'mail', primaryKey: 'rowid', required: false },
  { name: 'email_messages_fts', category: 'mail', primaryKey: 'rowid', required: false, notes: 'FTS content is validated separately because virtual tables cannot be copied like ordinary tables.' },
];

const accountAndSecurityTables: readonly SqliteMigrationTable[] = [
  { name: 'workspaces', category: 'auth', primaryKey: 'id', required: false, workspaceScoped: false },
  { name: 'users', category: 'auth', primaryKey: 'id', required: false, workspaceScoped: false },
  { name: 'workspace_members', category: 'auth', primaryKey: 'rowid', required: false },
  { name: 'user_account_access', category: 'auth', primaryKey: 'rowid', required: false },
  { name: 'auth_audit_log', category: 'auth', primaryKey: 'id', required: false },
  { name: 'pgp_identities', category: 'security', primaryKey: 'id', required: false },
  { name: 'pgp_peer_keys', category: 'security', primaryKey: 'id', required: false },
  { name: 'automation_api_keys', category: 'automation', primaryKey: 'id', required: false },
  { name: 'email_spam_list_entries', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_spam_learning_events', category: 'mail', primaryKey: 'id', required: false },
  { name: 'email_spam_feature_stats', category: 'mail', primaryKey: 'feature_key', required: false },
  { name: 'email_spam_decisions', category: 'mail', primaryKey: 'id', required: false },
];

export const sqliteServerEditionMigrationPlan: SqliteMigrationPlan = {
  id: 'server-edition-sqlite-import-v1',
  description: 'Resumable import plan for the current Electron SQLite schema into the server-edition PostgreSQL model.',
  tables: [
    ...coreCrmTables,
    ...jtlReferenceTables,
    ...emailTables,
    ...accountAndSecurityTables,
  ],
};

export function findSqliteMigrationTable(tableName: string): SqliteMigrationTable | undefined {
  return sqliteServerEditionMigrationPlan.tables.find((table) => table.name === tableName);
}

export function validateSqliteMigrationPlan(plan: SqliteMigrationPlan = sqliteServerEditionMigrationPlan): void {
  const seen = new Set<string>();

  for (const table of plan.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.name)) {
      throw new Error(`Invalid SQLite migration table name: ${table.name}`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table.primaryKey)) {
      throw new Error(`Invalid SQLite migration primary key for ${table.name}: ${table.primaryKey}`);
    }
    if (seen.has(table.name)) {
      throw new Error(`Duplicate SQLite migration table: ${table.name}`);
    }
    seen.add(table.name);

    for (const dependency of table.dependsOn ?? []) {
      if (!seen.has(dependency)) {
        throw new Error(`SQLite migration table ${table.name} depends on ${dependency} before it is imported`);
      }
    }
  }
}

validateSqliteMigrationPlan(sqliteServerEditionMigrationPlan);
