import type { SqlMigration } from './types';

/**
 * Mail search overhaul (Suche Phase 3): attachment text search, trigram
 * indexes for tolerant ILIKE fallback and a body_text backfill for HTML-only
 * mail (the generated search_vector regenerates itself from body_text).
 *
 * pg_trgm is trusted on postgres:18 and installable by the non-superuser
 * app role (CREATE ON DATABASE); docker/postgres-init pre-creates it for
 * fresh containers as well. No CONCURRENTLY — migrations run inside a
 * transaction as simplecrm_app.
 */
export const mailSearchOverhaulMigration: SqlMigration = {
  id: '0026_mail_search_overhaul',
  description:
    'Attachment content_text + search_vector, pg_trgm indexes, HTML-only body_text backfill.',
  upSql: [
    'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
    'ALTER TABLE email_message_attachments ADD COLUMN IF NOT EXISTS content_text text;',
    'ALTER TABLE email_message_attachments ADD COLUMN IF NOT EXISTS text_extracted_at timestamptz;',
    `ALTER TABLE email_message_attachments ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
  to_tsvector('simple',
    coalesce(filename_display, '') || ' ' ||
    coalesce(content_text, '')
  )
) STORED;`,
    'CREATE INDEX IF NOT EXISTS email_message_attachments_search_gin_idx ON email_message_attachments USING gin (search_vector);',
    'CREATE INDEX IF NOT EXISTS email_message_attachments_filename_trgm_idx ON email_message_attachments USING gin (filename_display gin_trgm_ops);',
    'CREATE INDEX IF NOT EXISTS email_message_attachments_content_trgm_idx ON email_message_attachments USING gin (content_text gin_trgm_ops);',
    'CREATE INDEX IF NOT EXISTS email_messages_subject_trgm_idx ON email_messages USING gin (subject gin_trgm_ops);',
    'CREATE INDEX IF NOT EXISTS email_messages_body_text_trgm_idx ON email_messages USING gin (body_text gin_trgm_ops);',
    `UPDATE email_messages SET body_text = left(
  regexp_replace(
    regexp_replace(body_html, '<(style|script)[^>]*>.*?</\\1>', ' ', 'gis'),
    '<[^>]+>', ' ', 'g'
  ),
  500000
)
WHERE (body_text IS NULL OR body_text = '')
  AND body_html IS NOT NULL AND body_html <> '';`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_body_text_trgm_idx;',
    'DROP INDEX IF EXISTS email_messages_subject_trgm_idx;',
    'DROP INDEX IF EXISTS email_message_attachments_content_trgm_idx;',
    'DROP INDEX IF EXISTS email_message_attachments_filename_trgm_idx;',
    'DROP INDEX IF EXISTS email_message_attachments_search_gin_idx;',
    'ALTER TABLE email_message_attachments DROP COLUMN IF EXISTS search_vector;',
    'ALTER TABLE email_message_attachments DROP COLUMN IF EXISTS text_extracted_at;',
    'ALTER TABLE email_message_attachments DROP COLUMN IF EXISTS content_text;',
    // pg_trgm bleibt installiert (kann von anderen Objekten genutzt werden).
  ],
};
