import type { SqlMigration } from './types';

export const emailDraftApprovalFieldsMigration: SqlMigration = {
  id: '0044_email_draft_approval_fields',
  description: 'Add draft approval state for two-stage KI reply (ai.review_draft)',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS approval_state text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS approval_reason text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS auto_submitted smallint NOT NULL DEFAULT 0;',
    "CREATE INDEX IF NOT EXISTS email_messages_workspace_approval_pending_idx ON email_messages (workspace_id, id) WHERE uid < 0 AND folder_kind = 'draft' AND approval_state = 'pending' AND scheduled_send_at IS NULL;",
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_workspace_approval_pending_idx;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS auto_submitted;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS approval_reason;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS approval_state;',
  ],
};
