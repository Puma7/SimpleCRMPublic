import type { SqlMigration } from './types';

const extendedSearchVector = `to_tsvector(
      'simple',
      coalesce(subject, '') || ' ' ||
      coalesce(snippet, '') || ' ' ||
      coalesce(body_text, '') || ' ' ||
      coalesce(from_json::text, '') || ' ' ||
      coalesce(to_json::text, '') || ' ' ||
      coalesce(cc_json::text, '') || ' ' ||
      coalesce(ticket_code, '')
    )`;

const legacySearchVector = `to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body_text, ''))`;

export const emailMessageListSemanticsMigration: SqlMigration = {
  id: '0010_email_message_list_semantics',
  description: 'Server edition mail list semantics: snoozed messages and expanded message search vector.',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;',
    'DROP INDEX IF EXISTS email_messages_search_gin_idx;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS search_vector;',
    `ALTER TABLE email_messages ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (${extendedSearchVector}) STORED;`,
    'CREATE INDEX IF NOT EXISTS email_messages_search_gin_idx ON email_messages USING gin (search_vector);',
    'CREATE INDEX IF NOT EXISTS email_messages_snoozed_idx ON email_messages (workspace_id, snoozed_until) WHERE soft_deleted = false;',
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_snoozed_idx;',
    'DROP INDEX IF EXISTS email_messages_search_gin_idx;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS search_vector;',
    `ALTER TABLE email_messages ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (${legacySearchVector}) STORED;`,
    'CREATE INDEX IF NOT EXISTS email_messages_search_gin_idx ON email_messages USING gin (search_vector);',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS snoozed_until;',
  ],
};
