import type { SqlMigration } from './types';

/**
 * Treffsicherheit der KI-Entscheidung (Plan 050, docs/design/ai-decision-accuracy.md).
 *
 * Je produktiver Auflösung eines `ai.decide`-Knotens ein Ereignis, ohne Text:
 * nur Ids, Antwort, Ja-Wahrscheinlichkeit, Schwelle, Modellname und die
 * Rückmeldungsart des Knotens. Eine menschliche Korrektur (Spam-Status,
 * Antwort, Versand ohne Ausgangsprüfung) setzt override_kind/truth/override_at.
 * Ereignisse werden nach 365 Tagen gelöscht (audit.retention).
 */
export const aiDecisionEventsMigration: SqlMigration = {
  id: '0066_ai_decision_events',
  description: 'Adds text-free ai_decision_events for AI decision accuracy and threshold suggestions',
  upSql: [
    `CREATE TABLE IF NOT EXISTS ai_decision_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  workflow_source_id bigint NOT NULL,
  node_id text NOT NULL CHECK (char_length(node_id) <= 200),
  run_id bigint,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (char_length(direction) <= 40),
  answer text NOT NULL CHECK (answer IN ('ja', 'nein', 'unsicher', 'error')),
  probability smallint CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  threshold smallint NOT NULL CHECK (threshold BETWEEN 50 AND 99),
  model text CHECK (model IS NULL OR char_length(model) <= 200),
  feedback_signal text NOT NULL DEFAULT 'none'
    CHECK (feedback_signal IN ('none', 'spam', 'human_needed', 'send_ok')),
  override_kind text CHECK (override_kind IS NULL OR override_kind IN (
    'spam_to_clean', 'clean_to_spam', 'review_to_clean', 'review_to_spam', 'human_reply', 'sent_without_review')),
  truth text CHECK (truth IS NULL OR truth IN ('ja', 'nein')),
  override_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS ai_decision_events_node_idx
  ON ai_decision_events (workspace_id, workflow_source_id, node_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS ai_decision_events_open_message_idx
  ON ai_decision_events (workspace_id, message_id, created_at DESC)
  WHERE message_id IS NOT NULL AND override_at IS NULL;`,
    `ALTER TABLE ai_decision_events ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ai_decision_events FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ai_decision_events_workspace_isolation ON ai_decision_events;`,
    `CREATE POLICY ai_decision_events_workspace_isolation ON ai_decision_events
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS ai_decision_events_workspace_isolation ON ai_decision_events;',
    'DROP TABLE IF EXISTS ai_decision_events;',
  ],
};
