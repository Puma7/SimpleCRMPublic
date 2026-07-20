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
