import type { SqlMigration } from './types';

/**
 * Plan 048: genutztes Wissen am KI-Entwurf („Wissensbasis › Abschnitt“), damit
 * die Freigabe es anzeigen kann. Nur Titel, kein Wissensinhalt.
 */
export const emailMessageAiSourcesMigration: SqlMigration = {
  id: '0065_email_message_ai_sources',
  description: 'Knowledge sources label on AI drafts (shown in the approval banner)',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS ai_sources text;',
  ],
  downSql: [
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS ai_sources;',
  ],
};
