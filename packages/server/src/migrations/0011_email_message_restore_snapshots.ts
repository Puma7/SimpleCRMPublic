import type { SqlMigration } from './types';

export const emailMessageRestoreSnapshotsMigration: SqlMigration = {
  id: '0011_email_message_restore_snapshots',
  description: 'Persist previous message state for server-side trash restore',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS trash_prev_archived boolean;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS trash_prev_is_spam boolean;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS trash_prev_folder_kind text;',
  ],
  downSql: [
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS trash_prev_folder_kind;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS trash_prev_is_spam;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS trash_prev_archived;',
  ],
};
