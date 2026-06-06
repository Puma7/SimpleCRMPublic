import type { SqlMigration } from './types';

export const aiReplyFeedbackMigration: SqlMigration = {
  id: '0018_ai_reply_feedback',
  description: 'Adds ai_reply_feedback + draft AI-suggestion snapshot to learn from human edits.',
  upSql: [
    // Snapshot of the AI-generated draft body at creation time, so we can measure
    // how much a human changed it before sending.
    `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS ai_suggestion_snapshot text;`,
    `CREATE TABLE IF NOT EXISTS ai_reply_feedback (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id bigint,
  node_type text NOT NULL,
  suggestion_len integer NOT NULL,
  sent_len integer NOT NULL,
  changed_ratio double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS ai_reply_feedback_workspace_created_idx ON ai_reply_feedback (workspace_id, created_at DESC);`,
    `ALTER TABLE ai_reply_feedback ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ai_reply_feedback FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY ai_reply_feedback_workspace_isolation ON ai_reply_feedback
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    `DROP POLICY IF EXISTS ai_reply_feedback_workspace_isolation ON ai_reply_feedback`,
    `DROP INDEX IF EXISTS ai_reply_feedback_workspace_created_idx`,
    `DROP TABLE IF EXISTS ai_reply_feedback`,
    `ALTER TABLE email_messages DROP COLUMN IF EXISTS ai_suggestion_snapshot`,
  ],
};
