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
 *
 * A pre-upgrade draft already CLAIMED by an old worker is a second shape: its
 * scheduled_send_at is NULL (claiming nulls it) and its time lives only in a
 * sync_info `scheduled_send_claimed_at:{id}` row, so the predicate above misses it.
 * recoverOrphanedScheduledClaims would then refuse to restore it (both provenance
 * columns null) and delete the claim — silently unscheduling it. Give those the same
 * unstick+hold treatment and clear the stale claim so recovery has nothing to drop.
 */
export const scheduledSendProvenanceMigration: SqlMigration = {
  id: '0040_scheduled_send_provenance',
  description: 'Persist scheduled-send initiating user or trusted-service provenance',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_actor_user_id text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_trusted_service_principal text;',
    // Establish a transaction-local system context. The runner executes every statement
    // of one migration inside a single transaction as simplecrm_app, which is subject to
    // FORCE ROW LEVEL SECURITY on email_messages / sync_info. Without this the data
    // UPDATE/DELETE below match zero rows across all workspaces and silently no-op while
    // the migration is still recorded as applied. Mirrors 0033/0038/0039.
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    `UPDATE email_messages
      SET scheduled_send_at = NULL,
          outbound_hold = true,
          outbound_block_reason = COALESCE(outbound_block_reason, 'Geplanter Versand von vor dem Upgrade – bitte erneut planen und senden.')
      WHERE scheduled_send_at IS NOT NULL
        AND scheduled_send_actor_user_id IS NULL
        AND scheduled_send_trusted_service_principal IS NULL;`,
    // Claimed pre-upgrade drafts: scheduled_send_at already NULL, time only in the
    // sync_info claim row, both provenance columns null. Unstick + hold them too.
    `UPDATE email_messages m
      SET outbound_hold = true,
          outbound_block_reason = COALESCE(m.outbound_block_reason, 'Geplanter Versand von vor dem Upgrade – bitte erneut planen und senden.')
      FROM sync_info s
      WHERE s.workspace_id = m.workspace_id
        AND s.key LIKE 'scheduled_send_claimed_at:%'
        AND m.id = (CASE WHEN split_part(s.key, ':', 2) ~ '^[0-9]+$' THEN split_part(s.key, ':', 2)::bigint END)
        AND m.scheduled_send_at IS NULL
        AND m.scheduled_send_actor_user_id IS NULL
        AND m.scheduled_send_trusted_service_principal IS NULL;`,
    // Clear the now-handled claim rows so worker recovery cannot silently drop them.
    `DELETE FROM sync_info s
      USING email_messages m
      WHERE s.workspace_id = m.workspace_id
        AND s.key LIKE 'scheduled_send_claimed_at:%'
        AND m.id = (CASE WHEN split_part(s.key, ':', 2) ~ '^[0-9]+$' THEN split_part(s.key, ':', 2)::bigint END)
        AND m.scheduled_send_at IS NULL
        AND m.scheduled_send_actor_user_id IS NULL
        AND m.scheduled_send_trusted_service_principal IS NULL;`,
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
