import type { SqlMigration } from './types';

/**
 * The mail-ACL job policy denies any mail job that carries neither an `actorUserId`
 * nor the trusted-service marker (resolveJobActor → MailAsyncAuthorizationError,
 * nonRetryable). But `workflow.execute` rows enqueued by the PRE-provenance
 * scheduleWorkflowDelay stored only workflow/message/delayed-job fields — no actorUserId,
 * no marker. After upgrade the worker therefore TERMINALLY fails every such pending row,
 * while its `workflow_delayed_jobs` record stays 'pending' with nothing to re-enqueue it
 * (no ticker scans pending delayed jobs) — the delayed workflow is stuck forever.
 *
 * Stamping these rows with the trusted-service marker would be UNSAFE — a service actor
 * skips every per-user ACL check (and the workflow.execute per-node delete/triage/
 * draft-create rechecks live in the user-actor branch), so a legacy job reaching an
 * email.delete_server node would delete server mail with zero authorization; and a
 * provenance-less row cannot be proven system-initiated (delayed continuations belong to
 * user-initiated runs too). So QUARANTINE instead (mirrors 0040's unstick-and-hold):
 * mark the orphaned delayed job 'failed' so it surfaces as needs-attention, then delete
 * the dead job_queue row that could only ever terminal-fail. Current code stamps
 * provenance on every new row, so this targets only pre-upgrade rows.
 */
export const quarantineLegacyProvenancelessJobsMigration: SqlMigration = {
  id: '0042_quarantine_legacy_provenanceless_jobs',
  description: 'Unstick + quarantine pre-upgrade provenance-less delayed workflow.execute jobs',
  upSql: [
    // 1) Mark the orphaned delayed rows failed (nothing will ever re-enqueue them), so
    //    the stuck 'pending' state becomes an explicit, admin-visible 'failed'.
    `UPDATE workflow_delayed_jobs d
        SET status = 'failed', updated_at = now()
       FROM job_queue q
      WHERE q.type = 'workflow.execute'
        AND q.workspace_id = d.workspace_id
        AND (q.payload->>'delayedJobId') ~ '^[0-9]+$'
        AND d.id = (q.payload->>'delayedJobId')::bigint
        AND d.status = 'pending'
        AND NULLIF(TRIM(COALESCE(q.payload->>'actorUserId', '')), '') IS NULL
        AND q.payload->>'__simplecrmTrustedServicePrincipal' IS DISTINCT FROM 'simplecrm:trusted-service:v1';`,
    // 2) Delete the dead job_queue rows — never runnable, would only terminal-fail.
    `DELETE FROM job_queue q
      WHERE q.type = 'workflow.execute'
        AND (q.payload->>'delayedJobId') ~ '^[0-9]+$'
        AND NULLIF(TRIM(COALESCE(q.payload->>'actorUserId', '')), '') IS NULL
        AND q.payload->>'__simplecrmTrustedServicePrincipal' IS DISTINCT FROM 'simplecrm:trusted-service:v1';`,
  ],
  // Data cleanup of dead rows is not reconstructable (mirrors 0040's non-reversible
  // unstick); the down direction is an intentional no-op.
  downSql: [
    'SELECT 1;',
  ],
};
