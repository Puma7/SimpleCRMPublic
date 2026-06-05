import type { SqlMigration } from './types';

export const emailAccountServerSettingsMigration: SqlMigration = {
  id: '0012_email_account_server_settings',
  description: 'Add server-editable mail account settings fields',
  upSql: [
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sync_spam_folder_path text;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sync_archive_folder_path text;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_sync_sent boolean NOT NULL DEFAULT false;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_sync_archive boolean NOT NULL DEFAULT false;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_sync_spam boolean NOT NULL DEFAULT false;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS vacation_enabled boolean NOT NULL DEFAULT false;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS vacation_subject text;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS vacation_body_text text;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS request_read_receipt boolean NOT NULL DEFAULT false;',
  ],
  downSql: [
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS request_read_receipt;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS vacation_body_text;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS vacation_subject;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS vacation_enabled;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS imap_sync_spam;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS imap_sync_archive;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS imap_sync_sent;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS sync_archive_folder_path;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS sync_spam_folder_path;',
  ],
};
