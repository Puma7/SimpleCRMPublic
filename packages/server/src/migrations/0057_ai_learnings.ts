import type { SqlMigration } from './types';

/**
 * Learnings mit Freigabe (TA-P5, docs/MAIL_TEILAUTOMATISIERUNG.md 3.4).
 *
 * `ai_learning_candidates` sammelt BEREINIGTE Texte (Zitat, Signatur und
 * personenbezogene Daten sind schon beim Sammeln entfernt) aus geänderten
 * KI-Entwürfen, menschlichen Antworten und Notizen. Längen sind je Text auf
 * 4 000 Zeichen begrenzt. Kandidaten sind Rohdaten auf Zeit: nach der
 * Entscheidung über einen Vorschlag werden die verarbeiteten gelöscht,
 * unverarbeitete spätestens nach 90 Tagen (audit.retention-Lauf).
 *
 * `ai_learning_digests` hält je Auswertung den Schnappschuss der Wissensbasis
 * (base_content), die vorgeschlagene neue Fassung und die KI-Operationen. Der
 * partielle Unique-Index erzwingt „höchstens ein offener Vorschlag je
 * Wissensbasis“ auch bei parallelen Auswertungen.
 *
 * Der Unique-Index auf sent_message_id macht das Sammeln beim Versand
 * idempotent (ein erneutes markDraftAsSent erzeugt keinen zweiten Eintrag).
 */
export const aiLearningsMigration: SqlMigration = {
  id: '0057_ai_learnings',
  description: 'Adds ai_learning_candidates and ai_learning_digests for reviewed knowledge-base learnings',
  upSql: [
    `CREATE TABLE IF NOT EXISTS ai_learning_digests (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id bigint NOT NULL REFERENCES workflow_knowledge_bases(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'failed')),
  trigger text NOT NULL CHECK (trigger IN ('manual', 'workflow')),
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE SET NULL,
  period_from timestamptz,
  period_to timestamptz NOT NULL,
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  base_content text NOT NULL DEFAULT '' CHECK (char_length(base_content) <= 100000),
  proposed_content text NOT NULL DEFAULT '' CHECK (char_length(proposed_content) <= 100000),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
  operations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text CHECK (error IS NULL OR char_length(error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz
);`,
    `CREATE INDEX IF NOT EXISTS ai_learning_digests_workspace_created_idx
  ON ai_learning_digests (workspace_id, created_at DESC);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ai_learning_digests_one_pending_idx
  ON ai_learning_digests (workspace_id, knowledge_base_id)
  WHERE status = 'pending';`,
    `CREATE TABLE IF NOT EXISTS ai_learning_candidates (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('draft_edit', 'human_reply', 'note')),
  account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL,
  source_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  sent_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  question_text text CHECK (question_text IS NULL OR char_length(question_text) <= 4000),
  ai_text text CHECK (ai_text IS NULL OR char_length(ai_text) <= 4000),
  human_text text CHECK (human_text IS NULL OR char_length(human_text) <= 4000),
  note_text text CHECK (note_text IS NULL OR char_length(note_text) <= 4000),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  digest_id bigint REFERENCES ai_learning_digests(id) ON DELETE SET NULL,
  processed_at timestamptz
);`,
    `CREATE INDEX IF NOT EXISTS ai_learning_candidates_open_idx
  ON ai_learning_candidates (workspace_id, created_at DESC)
  WHERE processed_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS ai_learning_candidates_digest_idx
  ON ai_learning_candidates (workspace_id, digest_id)
  WHERE digest_id IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ai_learning_candidates_sent_message_idx
  ON ai_learning_candidates (workspace_id, sent_message_id)
  WHERE sent_message_id IS NOT NULL;`,
    `ALTER TABLE ai_learning_digests ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ai_learning_digests FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ai_learning_digests_workspace_isolation ON ai_learning_digests;`,
    `CREATE POLICY ai_learning_digests_workspace_isolation ON ai_learning_digests
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `ALTER TABLE ai_learning_candidates ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ai_learning_candidates FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ai_learning_candidates_workspace_isolation ON ai_learning_candidates;`,
    `CREATE POLICY ai_learning_candidates_workspace_isolation ON ai_learning_candidates
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS ai_learning_candidates_workspace_isolation ON ai_learning_candidates;',
    'DROP TABLE IF EXISTS ai_learning_candidates;',
    'DROP POLICY IF EXISTS ai_learning_digests_workspace_isolation ON ai_learning_digests;',
    'DROP TABLE IF EXISTS ai_learning_digests;',
  ],
};
