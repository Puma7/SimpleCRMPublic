# Mailbox ACL Task 7 Report

Datum: 2026-07-20
Branch: `codex/server-first-mail-acl`
Base: `0181a43`

## RED

- API/Transport/UI/Port-RED wurde vor der Implementierung über neue Tests aufgebaut:
  - `tests/unit/server-mail-delegation-api.test.ts`: `/api/v1/email/access/bindings` fehlte, erwartete RED-Symptome waren 404/`not_found`.
  - `tests/unit/mail-delegation-panel.test.tsx`: `src/components/email/settings/mail-delegation-panel.tsx` fehlte.
  - `tests/unit/server-mail-delegation-port.test.ts`: `createPostgresMailDelegationPort` fehlte.
  - `tests/unit/renderer-transport.test.ts`: Delegations-IPC-Channels/HTTP-Mapping fehlten.
- Nach Implementierungsbeginn wurden weitere RED-Artefakte festgehalten:
  - `.hermes/reports/task-7-focused-jest-1.log`: 3 Suites failed, u.a. Audit-Sanitization-Test zu streng, UI-DOM-Mehrfachtreffer, Port-Fake/Port-Verhalten.
  - `.hermes/reports/task-7-focused-jest-2.log`: Port-Fake/Privilege-Escalation-Code noch falsch.
  - `.hermes/reports/task-7-policy-event-jest.log`: Policy-Manifest klassifizierte `email_acl.changed` noch fälschlich als generisches Mail-Event.

## GREEN

- Fokussierte finale Suite:
  - Invocation: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-api.test.ts tests/unit/server-mail-delegation-port.test.ts tests/unit/mail-delegation-panel.test.tsx tests/unit/renderer-transport.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-policy-manifest.test.ts --runInBand`
  - Observable: `Test Suites: 6 passed, 6 total`; `Tests: 172 passed, 172 total`
  - Artifact: `.hermes/reports/task-7-focused-jest-after-nplus1.log`
- Lint:
  - Invocation: `pnpm run lint`
  - Observable: exit 0, `eslint . --ext ts,tsx --max-warnings 0`
  - Artifact: `.hermes/reports/task-7-lint-after-nplus1.log`
- Server-Build:
  - Invocation: `pnpm --filter @simplecrm/server run build`
  - Observable: exit 0, `tsc -p tsconfig.json`
  - Artifact: `.hermes/reports/task-7-server-build-after-nplus1.log`
- Root-Typecheck:
  - Invocation: `pnpm run typecheck`
  - Observable: exit 0, `tsc -b packages/core packages/server packages/desktop && tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit`
  - Artifact: `.hermes/reports/task-7-root-typecheck-after-nplus1.log`
- Whitespace/Conflict-Marker:
  - Invocation: `git diff --check`
  - Observable: exit 0, keine Ausgabe
  - Artifact: `.hermes/reports/task-7-git-diff-check-after-nplus1.log`

## Implementierte Dateien

- Backend API/Port: `packages/server/src/api/mail-delegation-routes.ts`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts`
- API-Komposition/Typen/OpenAPI: `packages/server/src/api/server-api.ts`, `packages/server/src/api/types.ts`, `packages/server/src/api/openapi.ts`, `packages/server/src/server.ts`
- ACL-Events/Policy: `packages/server/src/mail-access/async-policy-enforcer.ts`, `packages/server/src/mail-access/policy-manifest.ts`, `packages/server/src/db/postgres-event-port.ts`
- Shared/Renderer-Transport: `shared/ipc/channels.ts`, `shared/ipc/email-schemas.ts`, `src/services/transport/channel-http-registry.ts`, `src/services/transport/server-event-filters.ts`, `src/services/transport/index.ts`
- UI: `src/components/email/settings/mail-delegation-panel.tsx`, `src/components/email/settings-panels.tsx`, `src/components/email/settings-tab-ids.ts`, `src/components/email/workspace-context.tsx`, `src/components/email/hooks/use-email-accounts.ts`
- Tests: `tests/unit/server-mail-delegation-api.test.ts`, `tests/unit/server-mail-delegation-port.test.ts`, `tests/unit/mail-delegation-panel.test.tsx`, plus Erweiterungen in `renderer-transport`, `server-mail-job-event-acl`, `server-mail-policy-manifest`.

## Architekturentscheidungen

- Keine neue Migration: verwendet ausschließlich `mail_acl_bindings` und `mail_acl_binding_permissions` aus Migration 0038.
- Profile werden vor Persistenz zu expliziten bekannten `MailPermission`-Keys expandiert; `profile` bleibt Response-Metadatum und wird nicht als zusätzliche DB-Spalte gespeichert.
- Binding-Mutation ersetzt den expliziten Grant-Satz atomar in einer workspace-gebundenen Transaktion; leere Permission-Sets löschen das Binding.
- Owner/Admin verwalten ohne ACL-Datensatz; Owner/Admin als Subject werden durch den Port abgewiesen.
- Delegierte Manager benötigen `mail.delegation.manage` auf der Zielressource und dürfen nur Permission-Keys vergeben, die sie dort selbst effektiv halten.
- ACL-Invalidierung ist ein spezialbehandeltes `email_acl.changed` Event mit Payload-Allowlist `bindingId`, `targetUserId`, `state`; Live und Replay verwenden denselben `filterMailEventForPrincipal`-Pfad.
- Group-Subjects expandieren im Port auf aktive Gruppenmitglieder, damit auch der letzte Grant-Entzug beim betroffenen Nutzer ankommt.
- Standalone/local bekommt keine SQLite-ACL-Fläche: die neuen Delegations-IPC-Kanäle sind `DesktopServerOnlyInvokeChannels`, der Tab ist `serverOnly`.

## Self-Review

- IDOR: Binding-IDs werden im Port immer mit `workspace_id` geladen; Ressourcen werden vor Mutation gegen `email_accounts`/`email_folders` derselben Workspace geprüft.
- Cross-Tenant: `withWorkspaceTransaction` setzt Workspace-Session; Subject, Account, Folder und Binding-Lookups sind workspace-scoped.
- Self-Escalation: Nicht-Admin-Manager werden auf `mail.delegation.manage` plus Grant-Subset geprüft; `privilege_escalation` ist getrennt von fehlendem Manage-Recht.
- Revoke-Event-Leakage: ACL-Events werden serverseitig nur an `payload.targetUserId === principal.userId` ausgeliefert; Admin/Owner erhalten keine workspace-weite ACL-Event-Sicht.
- Stale UI/Races: Delegationspanel refetcht nach Save/Delete und auf ACL-Event; Kontoauswahl verwirft nach Account-Refetch nicht mehr sichtbare Account-IDs.
- N+1: Delegations-List lädt für nicht-admin Actors den effektiven Grant-Satz einmal und filtert danach im Speicher; Binding-Hydration lädt Labels/Permissions pro sichtbarem Binding.

## Restbedenken

- Playwright wurde nicht ausgeführt: der vorhandene `tests/e2e`-Harness startet die Electron-Standalone-App, in der der server-only Delegations-Tab absichtlich ausgeblendet ist. Harness-Scan: `.hermes/reports/task-7-playwright-harness-scan.log`.
- Die initialen RED-Symptome vor der ersten Implementierung wurden im Terminal beobachtet; die dauerhaft gespeicherten RED-Artefakte beginnen mit `.hermes/reports/task-7-focused-jest-1.log`.
