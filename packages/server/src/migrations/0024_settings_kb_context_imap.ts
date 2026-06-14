import type { SqlMigration } from './types';

export const settingsKbContextImapMigration: SqlMigration = {
  id: '0024_settings_kb_context_imap',
  description: 'Knowledge context on workflow_knowledge_bases and per-account IMAP delete opt-in.',
  upSql: [
    'ALTER TABLE workflow_knowledge_bases ADD COLUMN IF NOT EXISTS knowledge_context text;',
    'ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_delete_opt_in boolean NOT NULL DEFAULT false;',
  ],
  downSql: [
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS imap_delete_opt_in;',
    'ALTER TABLE workflow_knowledge_bases DROP COLUMN IF EXISTS knowledge_context;',
  ],
};
