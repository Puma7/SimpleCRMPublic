import type { SqlMigration } from './types';

/**
 * Anhang-Suche: Excel (xlsx, xls, xlsb), OpenDocument, RTF, DOC und PPTX werden
 * jetzt gelesen. Anhänge dieser Formate wurden bisher als „versucht, kein
 * Text“ markiert. `text_extractor_version` hält fest, mit welcher Version ein
 * Anhang zuletzt versucht wurde; Anhänge ohne Text und mit älterer Version
 * holt die Hintergrund-Auswertung einmal nach (mail-attachment-text.ts).
 * Bestehende Zeilen starten mit 0.
 */
export const attachmentTextExtractorVersionMigration: SqlMigration = {
  id: '0059_attachment_text_extractor_version',
  description: 'Track the attachment text extractor version so newly supported formats are extracted once more',
  upSql: [
    'ALTER TABLE email_message_attachments ADD COLUMN IF NOT EXISTS text_extractor_version smallint NOT NULL DEFAULT 0;',
  ],
  downSql: [
    'ALTER TABLE email_message_attachments DROP COLUMN IF EXISTS text_extractor_version;',
  ],
};
