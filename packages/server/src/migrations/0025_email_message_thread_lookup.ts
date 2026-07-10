import type { SqlMigration } from './types';

/**
 * Functional indexes for reference threading during sync. The sync thread
 * resolver looks up conversation siblings by the NORMALIZED Message-ID /
 * In-Reply-To (trim, strip a single outer <> pair, lowercase), so a plain
 * (workspace, message_id) index cannot serve the predicate.
 *
 * The normalized expression below is FROZEN LITERAL SQL on purpose: migrations
 * are checksummed (see checksumMigration / planServerMigrations), so deriving
 * `upSql` from the runtime `normalizedMessageIdSql()` helper would make any later
 * edit to that helper change this already-applied migration's checksum and block
 * upgrades. Parity with the resolver's helper is asserted by a unit test instead
 * (see tests/unit/mail-thread-normalization-sql.test.ts); if normalization must
 * change, add a NEW migration with a new index rather than editing this one.
 */
export const emailMessageThreadLookupMigration: SqlMigration = {
  id: '0025_email_message_thread_lookup',
  description: 'Functional indexes on normalized Message-ID / In-Reply-To for sync reference threading.',
  upSql: [
    `CREATE INDEX IF NOT EXISTS email_messages_ws_acct_norm_msgid_idx
      ON email_messages (
        workspace_id,
        account_id,
        lower(regexp_replace(regexp_replace(btrim(coalesce(message_id, '')), '^<', ''), '>$', ''))
      )
      WHERE message_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS email_messages_ws_acct_norm_irt_idx
      ON email_messages (
        workspace_id,
        account_id,
        lower(regexp_replace(regexp_replace(btrim(coalesce(in_reply_to, '')), '^<', ''), '>$', ''))
      )
      WHERE in_reply_to IS NOT NULL`,
  ],
  downSql: [
    `DROP INDEX IF EXISTS email_messages_ws_acct_norm_msgid_idx`,
    `DROP INDEX IF EXISTS email_messages_ws_acct_norm_irt_idx`,
  ],
};
