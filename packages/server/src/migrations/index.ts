import { serverFoundationMigration } from './0001_server_foundation';
import { securityFoundationMigration } from './0002_security_foundation';
import { sqliteImportFoundationMigration } from './0003_sqlite_import_foundation';
import { sqliteImportStagingMigration } from './0004_sqlite_import_staging';
import { coreCrmSchemaMigration } from './0005_core_crm_schema';
import { extendedCrmSchemaMigration } from './0006_extended_crm_schema';
import { coreMailSchemaMigration } from './0007_core_mail_schema';
import { workflowSecuritySchemaMigration } from './0008_workflow_security_schema';
import { sqliteImportValidationMigration } from './0009_sqlite_import_validation';
import { emailMessageListSemanticsMigration } from './0010_email_message_list_semantics';
import { emailMessageRestoreSnapshotsMigration } from './0011_email_message_restore_snapshots';
import { emailAccountServerSettingsMigration } from './0012_email_account_server_settings';
import { emailComposeDraftFieldsMigration } from './0013_email_compose_draft_fields';
import { emailReplySuggestionFieldsMigration } from './0014_email_reply_suggestion_fields';
import { taskCustomerOptionalMigration } from './0015_task_customer_optional';
import { taskAssignmentAndUserGroupsMigration } from './0016_task_assignment_and_user_groups';
import { aiUsageEventsMigration } from './0017_ai_usage_events';
import { aiReplyFeedbackMigration } from './0018_ai_reply_feedback';
import { taskAssignmentScopeResetMigration } from './0019_task_assignment_scope_reset';
import { authLoginSecurityMigration } from './0020_auth_login_security';
import { returnsSchemaMigration } from './0021_returns_schema';
import { returnsPortalSettingsMigration } from './0022_returns_portal_settings';
import { accountScopeOverridesMigration } from './0023_account_scope_overrides';
import { settingsKbContextImapMigration } from './0024_settings_kb_context_imap';
import { emailMessageThreadLookupMigration } from './0025_email_message_thread_lookup';
import { assertValidMigrationSet, joinMigrationSql } from './types';
import type { SqlMigration } from './types';

export const serverMigrations: readonly SqlMigration[] = [
  serverFoundationMigration,
  securityFoundationMigration,
  sqliteImportFoundationMigration,
  sqliteImportStagingMigration,
  coreCrmSchemaMigration,
  extendedCrmSchemaMigration,
  coreMailSchemaMigration,
  workflowSecuritySchemaMigration,
  sqliteImportValidationMigration,
  emailMessageListSemanticsMigration,
  emailMessageRestoreSnapshotsMigration,
  emailAccountServerSettingsMigration,
  emailComposeDraftFieldsMigration,
  emailReplySuggestionFieldsMigration,
  taskCustomerOptionalMigration,
  taskAssignmentAndUserGroupsMigration,
  aiUsageEventsMigration,
  aiReplyFeedbackMigration,
  taskAssignmentScopeResetMigration,
  authLoginSecurityMigration,
  returnsSchemaMigration,
  returnsPortalSettingsMigration,
  accountScopeOverridesMigration,
  settingsKbContextImapMigration,
  emailMessageThreadLookupMigration,
];

assertValidMigrationSet(serverMigrations);

export function collectMigrationSql(direction: 'up' | 'down' = 'up'): string {
  const migrations = direction === 'up' ? serverMigrations : [...serverMigrations].reverse();
  return joinMigrationSql(migrations.flatMap((migration) => (
    direction === 'up' ? migration.upSql : migration.downSql
  )));
}

export * from './runner';
export type { SqlMigration } from './types';
