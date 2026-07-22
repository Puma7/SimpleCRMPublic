# Scheduled-send provenance fix - 2026-07-20

## Implementation

- Added durable scheduled-send provenance columns: `scheduled_send_actor_user_id` and `scheduled_send_trusted_service_principal`, with migration `0040_scheduled_send_provenance`.
- User schedule and retry routes now persist and enqueue `actorUserId`; retry also queues an immediate scheduled-send job.
- Scheduled-send plans and stores preserve actor/trusted-service provenance through queue execution, restart, and direct ticker discovery.
- Scheduled-send execution now fails closed when provenance is absent and maps validated trusted-service provenance to downstream actor `system`.
- The in-process ticker now validates each due draft through `enforceMailJobPolicy` before claim/send.
- `mail.send.scheduled`, `mail.vacation.auto_reply`, and `workflow.dmarc_ingest` are `initiating_user_or_service`; canonical service payloads require the trusted marker, while actorUserId payloads recheck the current user's mail grants.
- Workflow auto-send producers that arm `scheduled_send_at` write canonical trusted-service provenance; terminal/import paths clear stale scheduled-send provenance.

## Evidence

- RED: focused suite failed before implementation; recorded in `.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`.
- GREEN focused: `pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/server-edition-foundation.test.ts --runInBand` passed with `3 passed, 428 tests`.
- Full gates: lint, typecheck, unit, mail coverage, build, and `git diff --check` passed.
- Integration gate was run and failed in an unrelated current-date fixture: `tests/integration/server-mail-access-routes.test.ts` expected a snoozed row until `2026-07-20T12:00:00Z`, but the recorded UTC time was `2026-07-20T12:13:17Z`.

## Self-review

- No implicit scheduled-send fallback to `system` remains; `system` is only used after input or persisted trusted-service provenance is present.
- Unmarked and forged service payloads fail closed for the covered mail job policies.
- Revoked, disabled, or degranted actor scheduled-send jobs are blocked before handler execution.
- Stale provenance is cleared on send finalization, cancellation/give-up paths, compose draft creation, relay sent insertion, mail sync insertion, and core import conflict update.

## Follow-up: scheduled-send mutation serialization

- Root cause fixed: `scheduleDraftSend` and `retryScheduledSendDraft` now lock the exact draft row in the mutation transaction, then check `scheduled_send_claimed_at:<draftId>` before writing `scheduled_send_at`, changing provenance, clearing scheduled-send metadata, or causing route queue side effects.
- Active claims return deterministic `scheduled_send_claimed`, mapped by routes to HTTP `409` / `email_scheduled_send_claimed`.
- The row lock orders mutations against `claimDueDrafts`: a mutation that starts first makes the claim path skip the locked row; a claim that starts first commits the claim marker before the mutation can proceed, so schedule/cancel/retry fail closed.
- Regression evidence added to `.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`: RED showed missing lock/check and wrong 404 mapping; GREEN focused suite passed with `3 passed, 430 tests`.
- Follow-up gates run: focused scheduled/provenance suite passed, lint passed, typecheck passed after missing import fix, integration passed, and `git diff --check` passed.

## Follow-up: scheduled-send approval serialization

- Root cause fixed: `scheduleDraftSend` no longer validates outbound workflows before the locked mutation. It now locks the draft row, checks the active scheduled-send claim marker, then performs schedule validation with `persistence: 'none'`.
- The outbound validation API now has an explicit persistence mode. Existing callers keep the default persisting behavior; schedule-time validation receives an allowed result with `manualApprovalPersistenceRequired` only when enabled outbound workflows existed and passed.
- Manual outbound approval persistence moved to `mail-outbound-approval-store` so schedule can write the approval marker using the same locked transaction and draft snapshot before setting `scheduled_send_at`/provenance.
- Cancellation (`sendAt: null`) still skips outbound validation and approval persistence, and active claims still return `scheduled_send_claimed` before any validation call or queue side effect.
- Regression evidence added to `.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`: RED source-order test proved validation was before claim checking; GREEN integration proved claimed drafts do not validate/mutate and successful schedules use the real validation port non-persistently before atomic approval persistence.
- Gates run: focused scheduled/provenance suite, targeted integration file, full integration, lint, typecheck, full unit, mail coverage, build, and `git diff --check` all passed.
- Self-review: no implicit `system` fallback was added; the only new `system`-role activity is the existing workspace transaction context. The approval marker can only be written after a successful dry-run validation in the locked schedule transaction or by the existing default outbound validation path.
