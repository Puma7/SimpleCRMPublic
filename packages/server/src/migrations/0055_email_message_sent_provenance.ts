import type { SqlMigration } from './types';

/**
 * Teilautomatisierung P3: Wer hat eine Mail verschickt? Herkunft eines
 * Entwurfs (KI-/Workflow-Knoten, von einem Menschen geändert) und die beim
 * Übergang zu folder_kind 'sent' bestimmte Kennzeichnung. Ältere Mails
 * bleiben ohne Wert (kein Kennzeichen). Keine Fremdschlüssel: Workflow- und
 * Nutzername sind als Schnappschuss (sent_by_label) gespeichert und
 * überleben das Löschen.
 */
export const emailMessageSentProvenanceMigration: SqlMigration = {
  id: '0055_email_message_sent_provenance',
  description: 'Add draft origin and sent-by provenance to email_messages',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS draft_origin_kind text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS draft_origin_workflow_id bigint;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS draft_origin_edited boolean NOT NULL DEFAULT false;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sent_by_kind text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sent_by_user_id text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sent_by_workflow_id bigint;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sent_by_label text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sent_outbound_review_skipped boolean NOT NULL DEFAULT false;',
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_draft_origin_kind_check'
  ) THEN
    ALTER TABLE email_messages ADD CONSTRAINT email_messages_draft_origin_kind_check
      CHECK (draft_origin_kind IS NULL OR draft_origin_kind IN ('ai', 'workflow'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_sent_by_kind_check'
  ) THEN
    ALTER TABLE email_messages ADD CONSTRAINT email_messages_sent_by_kind_check
      CHECK (sent_by_kind IS NULL OR sent_by_kind IN ('human', 'ai_auto', 'ai_approved', 'workflow', 'relay'));
  END IF;
END $$;`,
    // Ansicht „Gesendet (KI)“: gesendete Mails mit automatischer Herkunft je Konto.
    "CREATE INDEX IF NOT EXISTS email_messages_workspace_sent_by_kind_idx ON email_messages (workspace_id, account_id, sent_by_kind, date_received DESC) WHERE folder_kind = 'sent' AND sent_by_kind IS NOT NULL;",
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_workspace_sent_by_kind_idx;',
    'ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_sent_by_kind_check;',
    'ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_draft_origin_kind_check;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS sent_outbound_review_skipped;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS sent_by_label;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS sent_by_workflow_id;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS sent_by_user_id;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS sent_by_kind;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS draft_origin_edited;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS draft_origin_workflow_id;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS draft_origin_kind;',
  ],
};
