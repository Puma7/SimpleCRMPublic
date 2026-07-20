import type { SqlMigration } from './types';

/**
 * Adds initiating-user / trusted-service provenance to scheduled sends. Scheduled
 * send did not ship to production before this change, so in practice there are no
 * legacy `scheduled_send_at` rows with null provenance. There is also no safe way
 * to reconstruct the initiating user (an account has no owner column) or to stamp
 * the trusted-service marker (that would bypass per-user ACL). But any such
 * pre-upgrade row (e.g. from a beta/staging build) would be excluded by the
 * ticker's provenance filter AND rejected by the worker — pending forever with no
 * send and no failure surfaced. So defensively unstick them: clear the schedule
 * and hold the draft with a reason, turning the silent stuck state into an
 * explicit "needs attention" the user can reschedule from.
 */
export const scheduledSendProvenanceMigration: SqlMigration = {
  id: '0040_scheduled_send_provenance',
  description: 'Persist scheduled-send initiating user or trusted-service provenance',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_actor_user_id text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_trusted_service_principal text;',
    `UPDATE email_messages
      SET scheduled_send_at = NULL,
          outbound_hold = true,
          outbound_block_reason = COALESCE(outbound_block_reason, 'Geplanter Versand von vor dem Upgrade – bitte erneut planen und senden.')
      WHERE scheduled_send_at IS NOT NULL
        AND scheduled_send_actor_user_id IS NULL
        AND scheduled_send_trusted_service_principal IS NULL;`,
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
