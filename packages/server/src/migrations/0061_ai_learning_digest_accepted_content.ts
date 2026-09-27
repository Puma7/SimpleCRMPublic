import type { SqlMigration } from './types';

/**
 * Learnings: die übernommene Fassung (vom Admin ggf. bearbeitet) getrennt vom
 * KI-Vorschlag speichern. Bisher überschrieb das Übernehmen proposed_content;
 * der Verlauf zeigte dann nicht mehr, was die KI vorgeschlagen hatte.
 * Ältere übernommene Vorschläge behalten NULL (kein Nachtrag möglich).
 */
export const aiLearningDigestAcceptedContentMigration: SqlMigration = {
  id: '0061_ai_learning_digest_accepted_content',
  description: 'Store the accepted (possibly edited) knowledge base text separately from the AI proposal',
  upSql: [
    `ALTER TABLE ai_learning_digests ADD COLUMN IF NOT EXISTS accepted_content text
      CHECK (accepted_content IS NULL OR char_length(accepted_content) <= 100000);`,
  ],
  downSql: [
    'ALTER TABLE ai_learning_digests DROP COLUMN IF EXISTS accepted_content;',
  ],
};
