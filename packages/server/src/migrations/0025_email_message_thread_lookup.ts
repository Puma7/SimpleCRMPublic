import type { SqlMigration } from './types';

/**
 * Functional indexes for reference threading during sync. The sync thread
 * resolver looks up conversation siblings by the NORMALIZED Message-ID /
 * In-Reply-To (strip <>, trim, lowercase), so a plain (workspace, message_id)
 * index cannot serve the predicate — the index expression must match the
 * normalized expression the resolver builds (see resolveReferenceThreadForSync).
 */
export const emailMessageThreadLookupMigration: SqlMigration = {
  id: '0025_email_message_thread_lookup',
  description: 'Functional indexes on normalized Message-ID / In-Reply-To for sync reference threading.',
  upSql: [
    `CREATE INDEX IF NOT EXISTS email_messages_ws_acct_norm_msgid_idx
      ON email_messages (
        workspace_id,
        account_id,
        lower(btrim(replace(replace(coalesce(message_id, ''), '<', ''), '>', '')))
      )
      WHERE message_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS email_messages_ws_acct_norm_irt_idx
      ON email_messages (
        workspace_id,
        account_id,
        lower(btrim(replace(replace(coalesce(in_reply_to, ''), '<', ''), '>', '')))
      )
      WHERE in_reply_to IS NOT NULL`,
  ],
  downSql: [
    `DROP INDEX IF EXISTS email_messages_ws_acct_norm_msgid_idx`,
    `DROP INDEX IF EXISTS email_messages_ws_acct_norm_irt_idx`,
  ],
};
