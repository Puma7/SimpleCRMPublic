import type { SqlMigration } from './types';

export const autoReplyLimitsMigration: SqlMigration = {
  id: '0029_auto_reply_limits',
  description: 'Atomic per-message deduplication and daily recipient limits for server auto replies.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS email_auto_reply_reservations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  draft_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  account_id bigint NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  reply_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_message_id)
);`,
    `CREATE TABLE IF NOT EXISTS email_auto_reply_daily_counters (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  reply_day date NOT NULL,
  reply_count integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  last_source_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  last_draft_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_id, recipient, reply_day)
);`,
    'CREATE INDEX IF NOT EXISTS email_auto_reply_reservations_recipient_day_idx ON email_auto_reply_reservations (workspace_id, account_id, recipient, reply_day);',
    `ALTER TABLE email_auto_reply_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_auto_reply_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE email_auto_reply_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_auto_reply_daily_counters FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY email_auto_reply_reservations_workspace_isolation ON email_auto_reply_reservations
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY email_auto_reply_daily_counters_workspace_isolation ON email_auto_reply_daily_counters
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS email_auto_reply_daily_counters_workspace_isolation ON email_auto_reply_daily_counters;',
    'DROP POLICY IF EXISTS email_auto_reply_reservations_workspace_isolation ON email_auto_reply_reservations;',
    'DROP TABLE IF EXISTS email_auto_reply_daily_counters;',
    'DROP TABLE IF EXISTS email_auto_reply_reservations;',
  ],
};
