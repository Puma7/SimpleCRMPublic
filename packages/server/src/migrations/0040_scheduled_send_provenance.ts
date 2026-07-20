import type { SqlMigration } from './types';

/**
 * Adds initiating-user / trusted-service provenance to scheduled sends. Existing
 * rows are intentionally NOT back-filled: scheduled send did not ship to
 * production before this change, so there are no legacy `scheduled_send_at` rows
 * with null provenance to migrate. (There is no safe back-fill anyway — an
 * account has no owner column to reconstruct the initiating user, and stamping
 * the trusted-service marker would bypass per-user ACL.) If such legacy rows
 * ever did exist they would be excluded by the ticker's provenance filter and
 * would need to be explicitly marked failed here.
 */
export const scheduledSendProvenanceMigration: SqlMigration = {
  id: '0040_scheduled_send_provenance',
  description: 'Persist scheduled-send initiating user or trusted-service provenance',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_actor_user_id text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_trusted_service_principal text;',
    `CREATE INDEX IF NOT EXISTS email_messages_workspace_scheduled_send_actor_idx
      ON email_messages (workspace_id, scheduled_send_actor_user_id)
      WHERE scheduled_send_at IS NOT NULL AND scheduled_send_actor_user_id IS NOT NULL;`,
    `CREATE INDEX IF NOT EXISTS email_messages_workspace_scheduled_send_service_idx
      ON email_messages (workspace_id, scheduled_send_trusted_service_principal)
      WHERE scheduled_send_at IS NOT NULL AND scheduled_send_trusted_service_principal IS NOT NULL;`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_workspace_scheduled_send_service_idx;',
    'DROP INDEX IF EXISTS email_messages_workspace_scheduled_send_actor_idx;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS scheduled_send_trusted_service_principal;',
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS scheduled_send_actor_user_id;',
  ],
};
