import type { SqlMigration } from './types';

export const emailComposeDraftFieldsMigration: SqlMigration = {
  id: '0013_email_compose_draft_fields',
  description: 'Add compose draft recipient, attachment, reply, and scheduled-send fields',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bcc_json jsonb;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS draft_attachment_paths_json text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS post_process_done boolean NOT NULL DEFAULT false;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_parent_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz;',
    'CREATE INDEX IF NOT EXISTS email_messages_workspace_scheduled_send_idx ON email_messages (workspace_id, scheduled_send_at) WHERE uid < 0 AND folder_kind = \'draft\' AND scheduled_send_at IS NOT NULL AND outbound_hold = false;',
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_workspace_scheduled_send_idx;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS scheduled_send_at;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS reply_parent_message_id;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS post_process_done;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS draft_attachment_paths_json;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS bcc_json;',
  ],
};
