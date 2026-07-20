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

---

## Review-Fix 2026-07-20

Base: `b247869`

### Bestaetigte Review-Blocker

1. Es fehlte ein ausfuehrbarer Browser-E2E-Pfad fuer den Server-Client.
2. Die Binding-Liste war unbeschraenkt und hydrierte Permissions/Labels mit etwa `1 + 3N` Queries.
3. Das Panel behielt nach `email_acl.changed` veraltete Account-/Folder-/Edit-IDs und war nicht gegen ueberholte Responses abgesichert.

### RED

- Query-Count und Pagination:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-port.test.ts --runInBand`
  - Beobachtung: Query-Count erwartete `6`, erhielt bereits bei zwei Bindings `7`; Cursor `2`/Limit `2` lieferte weiterhin alle sechs Bindings und keinen `nextCursor`.
  - Evidence: `.hermes/reports/task-7-review-query-count-red.log`
- API und Transport:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-port.test.ts tests/unit/server-mail-delegation-api.test.ts tests/unit/renderer-transport.test.ts --runInBand`
  - Beobachtung: Cursor/Limit wurden nicht an den Port gegeben, `cursor=0` wurde akzeptiert und der Renderer verlor `nextCursor`.
  - Evidence: `.hermes/reports/task-7-review-nplus1-pagination-red.log`
- UI-Pagination und stale ACL-State:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/mail-delegation-panel.test.tsx --runInBand`
  - Beobachtung: zweite Binding-Seite (`Bob`) fehlte; beim invertierten Refresh-Rennen blieb der Folder ungueltig statt auf `203` zu wechseln und Edit-State sicher zu verwerfen.
  - Evidence: `.hermes/reports/task-7-review-ui-pagination-stale-red.log`
- StrictMode/Unmount:
  - Gleicher fokussierter UI-Befehl.
  - Beobachtung: nach StrictMode-Effect-Replay blieb der Mounted-Guard `false`; der zweite Load konnte `Alice` nicht mehr anwenden.
  - Evidence: `.hermes/reports/task-7-review-strictmode-unmount-red.log`
- Playwright:
  - Befehl: `pnpm exec playwright test -c tests/e2e/playwright.server-client.config.ts`
  - Beobachtung: der zuerst geschriebene Test erhielt ohne Browser-Harness fuer `/` einen nicht erfolgreichen HTTP-Response.
  - Evidence: `.hermes/reports/task-7-review-playwright-red.log`

### GREEN

- Fokussierte Unit-Suiten:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-api.test.ts tests/unit/server-mail-delegation-port.test.ts tests/unit/mail-delegation-panel.test.tsx tests/unit/renderer-transport.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-policy-manifest.test.ts --runInBand`
  - Ergebnis: `Test Suites: 6 passed, 6 total`; `Tests: 178 passed, 178 total`.
  - Evidence: `.hermes/reports/task-7-review-focused-unit-green.log`
- Event-Integration:
  - Befehl: `pnpm exec jest --selectProjects integration --runTestsByPath tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  - Ergebnis: `Test Suites: 1 passed, 1 total`; `Tests: 1 passed, 1 total`.
  - Evidence: `.hermes/reports/task-7-review-event-integration-green.log`
- Server-Client Playwright:
  - Befehl: `pnpm exec playwright test -c tests/e2e/playwright.server-client.config.ts`
  - Ergebnis: `1 passed (4.9s)`; Profilwahl, exakter Triage-Permission-Satz plus individuelles `mail.send`, Owner-Widerruf, gefiltertes Live-Event, autorisierter Account-/Folder-/Binding-Refetch und Socket-Unsubscribe wurden beobachtet.
  - Evidence: `.hermes/reports/task-7-review-playwright-final.log`
- Lint:
  - Befehl: `pnpm run lint`
  - Ergebnis: Exit `0`, `eslint . --ext ts,tsx --max-warnings 0`.
  - Evidence: `.hermes/reports/task-7-review-lint.log`
- Server-Build:
  - Befehl: `pnpm --filter @simplecrm/server run build`
  - Ergebnis: Exit `0`, `tsc -p tsconfig.json`.
  - Evidence: `.hermes/reports/task-7-review-server-build.log`
- Root-Typecheck:
  - Befehl: `pnpm run typecheck`
  - Ergebnis: Exit `0`, vollstaendige Root-TS-Kette.
  - Evidence: `.hermes/reports/task-7-review-root-typecheck.log`
- Whitespace:
  - Befehl: `git diff --check`
  - Ergebnis: Exit `0`, keine Ausgabe.
  - Evidence: `.hermes/reports/task-7-review-git-diff-check.log`

### Implementierung und Architektur

- `GET /api/v1/email/access/bindings` verwendet einen validierten positiven ID-Cursor, Default-Limit `50`, festes Maximum `100`, deterministische `id ASC`-Reihenfolge und `limit + 1` fuer `nextCursor`.
- Die delegierte Manager-Sichtbarkeit wird vor Pagination durch ein workspace-gebundenes SQL-`EXISTS` auf eigene Benutzer-/Gruppen-Grants mit `mail.delegation.manage` eingeschraenkt. Account-Grants decken Account und Folder, Folder-Grants nur den exakten Folder ab.
- Eine Seite benoetigt eine Binding-Query und hoechstens fuenf Bulkqueries fuer Permissions, User, Groups, Accounts und Folders. Die Query-Anzahl bleibt bei zwei und zwanzig sichtbaren Bindings konstant `6`.
- Shared Schema und HTTP-Transport erhalten `{ items, nextCursor }`; das Panel laedt Seiten sequenziell bis `nextCursor: null` und verwirft nicht-fortschreitende oder wiederholte Cursor.
- ACL-Refreshes tragen eine monotone Request-Generation. Nur die neueste Response darf State anwenden; Unmount und StrictMode-Replay invalidieren alte Generationen.
- Nach jedem autorisierten Refresh werden `accountId`, `folderId`, Subject und Edit-Binding gegen die neue Option-Menge geprueft. Ungueltige Edit-States setzen Profil/Permissions zurueck. Save ist waehrend Refresh gesperrt und validiert Account-/Folder-IDs unmittelbar vor dem Transport erneut.

### Playwright-Harness Start, Fixture und Cleanup

- `tests/e2e/mail-delegation-server-client.spec.ts` startet Vite als Middleware hinter einem Node-HTTP-Server mit OS-Port `0` und Fastify ebenfalls mit OS-Port `0`; keine festen Ports und keine Kindprozesse.
- `tests/e2e/server-client-harness/main.tsx` rendert das echte `MailDelegationPanel`, setzt eine servergebundene Auth-Session und konfiguriert den echten `createHttpRendererTransport`.
- Fastify verwendet die echten Task-7-Routen, den echten In-Memory-Server-Eventbus, WebSocket-Transport sowie Live-Eventfilter. Deterministische API-Ports bilden nur die Testdaten und den Widerrufszustand ab.
- Der Test schliesst die Browserseite explizit und wartet auf `activeEventSubscriptions === 0`. `afterAll` schliesst Fastify, alle HTTP-Verbindungen, den Node-HTTP-Server und Vite.

### Self-Review

- Pagination-Luecken: Manager-Sichtbarkeit und optionale Resource-Filter liegen vor Cursor/Limit; der Cursor stammt immer vom letzten ausgegebenen Row der uebervollen Seite. API und Shared Schema lehnen `0`, Nicht-Zahlen und Limits ueber `100` ab.
- Query-Komplexitaet: keine per-Binding-Hydration; alle `IN`-Mengen sind durch die Page-Groesse begrenzt. Bestehende Workspace-/Subject-/Account-/Folder-Indizes aus Migration `0038` werden genutzt; keine Migration geaendert.
- IDOR/Cross-Tenant: Port bleibt in `withWorkspaceTransaction`; alle Bulk-Labelqueries enthalten `workspace_id`, die Manager-Subquery bindet Workspace, Actor und Ressource.
- Event-Race: Live und Replay bleiben im gemeinsamen serverseitigen Filter. Renderer-Generationen verhindern, dass ein aelterer Refresh einen neueren Widerruf rueckgaengig macht; Save sendet nach Removal keine alten IDs.
- Prozess-Cleanup: keine Spawn-Prozesse; ephemere Listener und WebSocket-Subscription werden im Test beobachtbar geschlossen.

### Restbedenken Review-Fix

- Keine bestaetigten offenen Task-7-Blocker. Der Browser-E2E verwendet echte API-/HTTP-/WebSocket-Komposition mit deterministischen In-Memory-Ports; die PostgreSQL-Queryform wird separat durch Port-/Query-Count-Tests und Server-Build abgedeckt.
