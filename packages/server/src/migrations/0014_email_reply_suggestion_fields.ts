import type { SqlMigration } from './types';

export const emailReplySuggestionFieldsMigration: SqlMigration = {
  id: '0014_email_reply_suggestion_fields',
  description: 'Adds persisted AI reply suggestion state to email messages.',
  upSql: [
    `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_suggestion_text text`,
    `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_suggestion_status text`,
    `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_suggestion_error text`,
    `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_suggestion_updated_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS email_messages_reply_suggestion_pending_idx
      ON email_messages (workspace_id, reply_suggestion_updated_at)
      WHERE reply_suggestion_status = 'pending'`,
  ],
  downSql: [
    `DROP INDEX IF EXISTS email_messages_reply_suggestion_pending_idx`,
    `ALTER TABLE email_messages DROP COLUMN IF EXISTS reply_suggestion_updated_at`,
    `ALTER TABLE email_messages DROP COLUMN IF EXISTS reply_suggestion_error`,
    `ALTER TABLE email_messages DROP COLUMN IF EXISTS reply_suggestion_status`,
    `ALTER TABLE email_messages DROP COLUMN IF EXISTS reply_suggestion_text`,
  ],
};
