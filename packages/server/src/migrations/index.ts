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
