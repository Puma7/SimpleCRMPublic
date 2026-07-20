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

---

## Zweite Review-Fix-Welle 2026-07-20

Base: `e850251`

### Bestaetigte Important Findings

1. Das Panel benoetigte globale User-/Mail-Listen und funktionierte fuer delegierte Manager ohne `users.manage` bzw. `mail.metadata.read` nicht.
2. Ein fehlgeschlagener ACL-Refetch konnte veralteten autorisierungsabhaengigen UI-State erhalten oder wiederherstellen.
3. Query-Bounds, RLS und Parallelmutationen waren noch nicht gegen echtes PostgreSQL belegt.
4. Der Browser-Test belegte weder alle Revoke-Refetches noch Live-/Replay-Isolation gegen einen zweiten Principal.
5. Parallele Creates sowie PATCH gegen DELETE hatten keine explizit verifizierte konfliktfeste Replace-Semantik.

### RED

- Delegations-API und Validierung:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-api.test.ts --runInBand`
  - Ergebnis: 2 Tests fehlgeschlagen; policy-scoped Resource-/Subject-Routes waren `404` und die neue Cursor-/Resource-Validierung fehlte.
  - Evidence: `.hermes/reports/task-7-review2-api-red.log`
- Shared-/HTTP-Transport:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/renderer-transport.test.ts --runInBand`
  - Ergebnis: neue Delegations-Options-Channels hatten kein HTTP-Mapping.
  - Evidence: `.hermes/reports/task-7-review2-transport-red.log`
- Row-Locking:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-port.test.ts --runInBand`
  - Ergebnis: PATCH und DELETE fuehrten kein `FOR UPDATE` auf der Binding-Zeile aus.
  - Evidence: `.hermes/reports/task-7-review2-locking-red.log`
- Echtes PostgreSQL:
  - Befehl: `pnpm exec jest --selectProjects integration --runTestsByPath tests/integration/server-mail-access-routes.test.ts --runInBand`
  - Ergebnis: 3 Tests fehlgeschlagen; `int8`-IDs waren nicht normalisiert, Resource-Optionen fehlten und ein erzwungenes paralleles Create lief in den Unique-Konflikt.
  - Evidence: `.hermes/reports/task-7-review2-postgres-red.log`
- Fail-closed UI:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/mail-delegation-panel.test.tsx --runInBand`
  - Ergebnis: 4 Tests fehlgeschlagen; das Panel verwendete weiterhin globale User-/Account-/Folder-Listen und invalidierte den State nicht fail-closed.
  - Evidence: `.hermes/reports/task-7-review2-panel-red.log`
- Server-Client Playwright:
  - Befehl: `pnpm exec playwright test --config tests/e2e/playwright.server-client.config.ts`
  - Ergebnis: echter Browser/HTTP-RED mit `500` auf beiden Resource-Options-Routes, da dem Harness-Port die neuen policy-scoped Methoden noch fehlten.
  - Evidence: `.hermes/reports/task-7-review2-e2e-red.log`

### GREEN

- API, Port und Transport:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-api.test.ts tests/unit/server-mail-delegation-port.test.ts tests/unit/renderer-transport.test.ts --runInBand`
  - Ergebnis: `Test Suites: 3 passed, 3 total`; `Tests: 152 passed, 152 total`.
  - Evidence: `.hermes/reports/task-7-review2-api-port-transport-green.log`
- Fail-closed Panel:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/mail-delegation-panel.test.tsx --runInBand`
  - Ergebnis: `Test Suites: 1 passed`; `Tests: 4 passed`; umfasst bounded Pagination, transienten Fehler, invertierte Responses, Retry, StrictMode und Unmount.
  - Evidence: `.hermes/reports/task-7-review2-panel-green.log`
- Reales PostgreSQL:
  - Befehl: `pnpm exec jest --selectProjects integration --runTestsByPath tests/integration/server-mail-access-routes.test.ts --runInBand`
  - Ergebnis: `Test Suites: 1 passed`; `Tests: 27 passed`; echte Migration, Kysely/pg-Queries, RLS und Paralleltransaktionen.
  - Evidence: `.hermes/reports/task-7-review2-postgres-green.log`
- Fokussierte Unit-Komposition:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/server-mail-delegation-api.test.ts tests/unit/server-mail-delegation-port.test.ts tests/unit/renderer-transport.test.ts tests/unit/mail-delegation-panel.test.tsx tests/unit/server-mail-job-event-acl.test.ts tests/unit/mail-settings-server-client-ui.test.tsx tests/unit/email-settings-navigation.test.ts --runInBand`
  - Ergebnis: `Test Suites: 7 passed, 7 total`; `Tests: 182 passed, 182 total`.
  - Evidence: `.hermes/reports/task-7-review2-focused-unit-attempt.log`
- Fokussierte Integration:
  - Befehl: `pnpm exec jest --selectProjects integration --runTestsByPath tests/integration/server-mail-access-routes.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  - Ergebnis: `Test Suites: 2 passed, 2 total`; `Tests: 28 passed, 28 total`.
  - Evidence: `.hermes/reports/task-7-review2-focused-integration-attempt.log`
- Vollstaendiger Server-Client Playwright:
  - Befehl: `pnpm exec playwright test --config tests/e2e/playwright.server-client.config.ts`
  - Ergebnis: `1 passed (4.5s)`; Profil `triage`, individuelles `mail.send`, echte HTTP-Mutation, Owner-Revoke, zielgefiltertes Live-Event, Account-/Folder-/Binding-Options-Refetch, sichtbares Entfernen und Replay-Isolation.
  - Evidence: `.hermes/reports/task-7-review2-e2e-green.log`
- Lint:
  - Befehl: `pnpm run lint`
  - Ergebnis: Exit `0`, `eslint . --ext ts,tsx --max-warnings 0`.
  - Evidence: `.hermes/reports/task-7-review2-lint-attempt.log`
- Server-Build:
  - Befehl: `pnpm --filter @simplecrm/server build`
  - Ergebnis: Exit `0`, `tsc -p tsconfig.json`.
  - Evidence: `.hermes/reports/task-7-review2-server-build-green.log`
- Root-Typecheck:
  - Befehl: `pnpm run typecheck`
  - Ergebnis: Exit `0`, vollstaendige Root-TS-Kette.
  - Evidence: `.hermes/reports/task-7-review2-root-typecheck-attempt.log`
- Whitespace:
  - Befehl: `git diff --check`
  - Ergebnis: Exit `0`, keine Beanstandung.
  - Evidence: `.hermes/reports/task-7-review2-git-diff-check.log`

### Implementierte Dateien

- Backend: `packages/server/src/api/types.ts`, `packages/server/src/api/mail-delegation-routes.ts`, `packages/server/src/api/openapi.ts`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts`.
- Shared/Transport: `shared/ipc/channels.ts`, `shared/ipc/email-schemas.ts`, `src/services/transport/channel-http-registry.ts`.
- UI: `src/components/email/settings/mail-delegation-panel.tsx`.
- Tests: `tests/unit/server-mail-delegation-api.test.ts`, `tests/unit/server-mail-delegation-port.test.ts`, `tests/unit/renderer-transport.test.ts`, `tests/unit/mail-delegation-panel.test.tsx`, `tests/integration/server-mail-access-routes.test.ts`, `tests/e2e/mail-delegation-server-client.spec.ts`.

### Architekturentscheidungen

- `GET /api/v1/email/access/resources` liefert getrennt paginierte Account- oder Folder-Optionen. Delegierte Manager sehen nur Ressourcen mit effektivem `mail.delegation.manage`; Account-Grants decken Folder ab, Folder-Grants nur den exakten Folder. Labels enthalten nur Account-Anzeigename bzw. Folder-Pfad.
- `GET /api/v1/email/access/subjects` ist an eine konkrete, zuvor validierte Ressource gebunden. Erst nach `mail.delegation.manage` werden aktive same-workspace User mit Rolle `user` als `id + display_name` oder same-workspace Gruppen als `id + name` geliefert. Globale `/auth/users`, Account- und Folder-Listen sind aus dem Panel entfernt.
- Alle drei Listenfamilien verwenden deterministische ID-Cursor, Default `50`, Maximum `100`, `limit + 1` und Fortschritts-/Wiederholungsschutz im Renderer. Das Panel laedt jede Seite kontrolliert bis `nextCursor: null`.
- Binding-Hydration bleibt bei hoechstens sechs Selects pro Seite: Binding, Permissions, Users, Groups, Accounts und Folders. Reale kleine und grosse Seiten benoetigen jeweils genau sechs Selects; alle `IN`-Mengen sind durch Page-Limit `100` begrenzt.
- Bei `email_acl.changed` leert das Panel synchron Ressourcen, Subjects, Bindings, Account-/Folder-/Subject-/Edit-ID, Profil und Permissions und sperrt Save. Nur die neueste vollstaendig erfolgreiche Resource-/Binding-/Subject-Generation aktiviert Save wieder; Fehler, spaete Responses und Unmount koennen keinen State zurueckspielen.
- Create nutzt den bestehenden NULLS-NOT-DISTINCT-Unique-Key per `ON CONFLICT ... DO UPDATE`; bestehende Zeilen werden mit `FOR UPDATE` serialisiert. Der danach ausgefuehrte Delete/Insert der vollstaendigen Permission-Menge liegt in derselben workspace-gebundenen Transaktion. PATCH/DELETE laden ebenfalls mit `FOR UPDATE` und geben bei verschwundener Zeile `binding_not_found` statt eines Throws zurueck.
- PostgreSQL-`int8`-Werte werden an der Port-Grenze auf sichere positive JavaScript-Integer normalisiert. Unzulaessige/null Werte fuer Pflicht-IDs brechen fail-closed ab.

### PostgreSQL-Fixture und Beweise

- Die bestehende Integration startet ein ephemeres lokales PostgreSQL, erzeugt eine nichtprivilegierte Rolle ohne `BYPASSRLS`, wendet die Repo-Migrationen bis einschliesslich `0038_mail_acl` an und instrumentiert reale Kysely-Queries ueber `log(event.level === 'query')`.
- Kleine Seite (`limit 2`) und grosse Seite (`limit 20`) verwenden jeweils sechs Selects. Vor den erlaubten Rows liegende nicht verwaltbare Bindings beweisen, dass die Manager-Autorisierung vor `LIMIT` im SQL-`WHERE EXISTS` erfolgt.
- Raw-RLS und hydratisierte Port-Antworten enthalten ausschliesslich die Session-Workspace. Options-Tests schliessen fremde Workspace-User, Gruppen und Ressourcen sowie Owner/Admin/disabled User aus.
- Ein temporaerer PostgreSQL-Trigger synchronisiert parallele Inserts derselben Subject-/Resource-Bindung und erzwingt die Unique-Race. Beide Aufrufe erfuellen sich, es bleibt genau eine Binding-ID mit einem vollstaendigen Grant-Satz.
- Paralleles PATCH/DELETE endet fuer beide Promises definiert als Erfolg oder `binding_not_found`; keine Operation wirft und kein `executeTakeFirstOrThrow` ist im Pfad verblieben. Trigger/Funktion, DB-Pools und der PostgreSQL-Kindprozess werden im `finally`/`afterAll` entfernt bzw. beendet.

### Playwright Start, Fixture und Cleanup

- Vite-Middleware und Fastify binden weiterhin ausschliesslich OS-Ports `0`. Der echte Renderer verwendet `createHttpRendererTransport`; Fastify verwendet echte Task-7-Routes, Event-WebSocket, Replay und denselben `filterMailEventForPrincipal` fuer live und replay.
- Der Manager-Principal hat Rolle `user`, keine Capabilities und nur den vom Delegations-Port modellierten `mail.delegation.manage`-Zugriff. Globale User-/Account-/Folder-Ports werfen bei Benutzung und blieben mit Zaehler `0` unberuehrt.
- Nach Revoke werden Account-Resource-, Folder-Resource- und Binding-Listenaufrufe separat als gestiegen beobachtet. Ohne verbleibende Ressource wird kein Subject-Options-IDOR ausgefuehrt; Account, Binding und Save verschwinden bzw. werden gesperrt.
- Ein zweiter gleichzeitig verbundener same-workspace Principal sammelt Browser-WebSocket-Nachrichten. Er erhaelt das zielgerichtete `email_acl.changed` weder live noch bei neuer Verbindung mit `since=0` aus dem Replay.
- Der Test schliesst beide beobachteten Sockets und die Panel-Seite und wartet auf `activeEventSubscriptions === 0`; `afterAll` schliesst Fastify, HTTP-Verbindungen, Node-HTTP-Server und Vite. Nach dem finalen Lauf blieb kein Harness-Listener. Der sichtbare Listener `127.0.0.1:5173` gehoert seit 2026-07-18 zu einem fremden Workspace und wurde nicht angefasst.

### Self-Review

- Subject-Leakage: Subject-Listen werden nie ohne konkrete same-workspace Ressource und erfolgreiche Manage-Pruefung ausgefuehrt; Responses enthalten keine Mailadresse, Rolle, Aktivstatus oder sonstige Userattribute.
- Resource-Option-IDOR: Nicht-Admin-Queries binden Workspace, Actor-User bzw. aktive Gruppenmitgliedschaft, `mail.delegation.manage` und Account-/Folder-Coverage im SQL. Unmanaged und cross-workspace IDs liefern keine Labels.
- SQL-Bounds/N+1: jede Route erzwingt `1..100`; Autorisierungsfilter und Cursor liegen vor `LIMIT`; Hydrierung arbeitet ausschliesslich mit page-bounded Bulk-IDs und ohne per-Binding Query.
- Deadlocks/Lost Updates: gleiche Bindings folgen einem Zeilenlock bzw. Unique-Index-Konflikt; die Permission-Replacement-Reihenfolge wird durch den Binding-Lock serialisiert. Es gibt keine gegenseitige Mehrzeilen-Lock-Reihenfolge im neuen Pfad; Transaktionen bleiben kurz und fuehren keine externen Calls aus.
- Event Live/Replay: ACL-Events bleiben serverseitig auf exakt `payload.targetUserId` gefiltert; der zweite Principal belegt dieselbe Filterung live und replay. Der letzte Grant-Entzug erreicht weiterhin den betroffenen Zielprincipal ueber die vor Delete expandierten aktiven User-IDs.
- Fail-closed UI: Event-Invalidierung ist synchron vor jedem Request, Generationen verwerfen spaete Ergebnisse, ein beliebiger Teilausfall laesst IDs/Edit/Permissions leer und Save gesperrt, Retry startet aus leerem State. Save validiert Resource und Subject nochmals gegen die zuletzt vollstaendig autorisierte Optionsmenge.
- Scope: keine Migration und keine Task-8-Datei wurde geaendert. `.superpowers/sdd/task-7-report.md` blieb unveraendert.

### Restbedenken Zweite Review-Fix-Welle

- Keine bestaetigten offenen Task-7-Findings. Der Browser-Harness verwendet deterministische In-Memory-Fachdaten-Ports, aber echten Browser-, HTTP-, API-, Live-/Replay- und UI-Code; die produktive Datenbanksemantik wird separat gegen das migrierte echte PostgreSQL-Harness belegt.

## Dritte Review-Fix-Welle (Base `ccc6c5f`)

### Umfang

- Ausschliesslich die zwei bestaetigten Findings wurden bearbeitet: stale Binding-State bei Subject-Wechseln im Delegationspanel und stale Account-State durch invertierte Requests nach `email_acl.changed`.
- Keine API-, Datenbank-, ACL-Policy- oder Task-8-Aenderung. `.superpowers/sdd/task-7-report.md` blieb unveraendert.

### RED

- Subject-Wechsel im Delegationspanel:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/mail-delegation-panel.test.tsx --runInBand`
  - Ergebnis: `Test Suites: 1 failed`; `Tests: 2 failed, 4 passed`. Nach Wechsel von User zu Gruppe bzw. von `user-1` zu `user-2` blieb der Edit-Modus samt alter Binding-ID und altem Grant-Satz aktiv (`Abbrechen` weiterhin sichtbar).
  - Evidence: `.hermes/reports/task-7-review3-panel-red.log`
- Account-Revoke-Race:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/use-email-accounts.test.tsx --runInBand`
  - Ergebnis: `Test Suites: 1 failed`; `Tests: 3 failed, 1 passed`. Der Hook abonnierte die ACL-Invalidierung nicht und eine zuletzt aufloesende alte StrictMode-Anfrage ersetzte Account `102` wieder durch den widerrufenen Account `101`.
  - Evidence: `.hermes/reports/task-7-review3-hook-red.log`

### GREEN

- Panel- und Hook-Regressionen:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/mail-delegation-panel.test.tsx tests/unit/use-email-accounts.test.tsx --runInBand`
  - Ergebnis: `Test Suites: 2 passed, 2 total`; `Tests: 11 passed, 11 total`. Abgedeckt sind Subject-Type-/Subject-ID-Wechsel als Create ohne alte ID, Viewer-Profil-Reset, Abbrechen, Ressourcenwechsel, normaler Initial-Load, leere und fehlerhafte Revoke-Refetches, invertierte Responses, Retry, StrictMode und Unmount.
  - Evidence: `.hermes/reports/task-7-review3-panel-hook-green.log`
- Fokussierte Panel-/Hook-/Mail-Shell-/Event-Suiten:
  - Befehl: `pnpm exec jest --selectProjects unit --runTestsByPath tests/unit/mail-delegation-panel.test.tsx tests/unit/use-email-accounts.test.tsx tests/unit/mail-settings-server-client-ui.test.tsx tests/unit/email-settings-navigation.test.ts tests/unit/renderer-transport.test.ts tests/unit/server-mail-job-event-acl.test.ts --runInBand`
  - Ergebnis: `Test Suites: 6 passed, 6 total`; `Tests: 176 passed, 176 total`.
  - Evidence: `.hermes/reports/task-7-review3-focused-unit-green.log`
- Server-Event-Integration:
  - Befehl: `pnpm exec jest --selectProjects integration --runTestsByPath tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  - Ergebnis: `Test Suites: 1 passed`; `Tests: 1 passed`.
  - Evidence: `.hermes/reports/task-7-review3-focused-integration-green.log`
- Vollstaendiger Server-Client Playwright:
  - Befehl: `pnpm exec playwright test -c tests/e2e/playwright.server-client.config.ts`
  - Ergebnis: `1 passed (4.7s)`. Profilwahl, individuelles Recht, HTTP-Revoke, sichtbares Entfernen, Account-/Folder-/Binding-Refetch, zielgefiltertes Live-/Replay-Event und Cleanup liefen im echten Browser-/HTTP-/WebSocket-Harness.
  - Evidence: `.hermes/reports/task-7-review3-playwright-green.log`
- Lint:
  - Befehl: `pnpm run lint`
  - Ergebnis: Exit `0`, `eslint . --ext ts,tsx --max-warnings 0`.
  - Evidence: `.hermes/reports/task-7-review3-lint.log`
- Server-Build:
  - Befehl: `pnpm --filter @simplecrm/server build`
  - Ergebnis: Exit `0`, `tsc -p tsconfig.json`.
  - Evidence: `.hermes/reports/task-7-review3-server-build.log`
- Root-Typecheck:
  - Befehl: `pnpm run typecheck`
  - Ergebnis: Exit `0`, vollstaendige Root-TS-Kette einschliesslich Core, Server, Desktop, Web und Electron.
  - Evidence: `.hermes/reports/task-7-review3-root-typecheck.log`
- Whitespace:
  - Befehl: `git diff --check`
  - Ergebnis: Exit `0`, keine Beanstandung.
  - Evidence: `.hermes/reports/task-7-review3-git-diff-check.log`

### Implementierung

- `mail-delegation-panel.tsx`: Subject-Type und Subject-ID besitzen explizite Change-Pfade. Jeder Wechsel entfernt `editingId`, setzt Profil `viewer` und ersetzt die Permissions durch den vollstaendigen zentralen Viewer-Satz. Save erzeugt dadurch ein neues Binding per POST statt das alte Binding per PATCH umzudeuten.
- `use-email-accounts.ts`: Jede Account-Anfrage erhaelt eine monoton steigende Generation. Nur die aktuelle Generation darf Accounts, Teammitglieder, Auswahl oder Loading-State schreiben. Ein Mount-Guard verhindert State-Aenderungen nach Unmount.
- Bei `email_acl.changed` werden Accounts, Teammitglieder, `selectedAccountId`, Folder-/Mail-View, Kategorie und selektierte Nachricht synchron fail-closed geleert bzw. auf `inbox` gesetzt. Danach startet ein neuer autorisierter Load; bei Fehler bleibt der State leer, waehrend `loadAccounts` als Retry erhalten bleibt.
- Tests: `tests/unit/mail-delegation-panel.test.tsx` erweitert; `tests/unit/use-email-accounts.test.tsx` neu. Ausfuehrliche Rohlogs liegen ausschliesslich unter `.hermes/reports/`.

### Self-Review

- Binding-Semantik: Weder Subject-Type noch Subject-ID koennen eine alte Binding-ID oder alte Einzelrechte uebernehmen. Resource-Wechsel und Abbrechen verwenden weiterhin ihre vorhandenen fail-safe Reset-Pfade.
- Event-Race: Invalidierung erhoeht die Generation vor dem Leeren und vor dem neuen Load. Alte Account- oder Team-Member-Promises koennen deshalb weder Daten noch Loading-State zurueckschreiben. Der bestehende Mail-Shell-Revision-Refresh darf spaeter eine weitere, neuere Generation starten, ohne widerrufenen State wiederzubeleben.
- Fehler/Retry: Ein fehlgeschlagener neuester Account-Load setzt keine alten Daten; die sofort geleerten Workspace-Auswahlen bleiben leer. Ein manueller oder revisionsgetriebener Retry kann nur mit seiner eigenen neuesten Generation setzen.
- StrictMode/Unmount: Effect-Cleanup markiert den Hook unmounted, erhoeht die Generation und beendet jedes Event-Abonnement genau einmal. Die zweite StrictMode-Montage startet mit einer neueren Generation; spaete Ergebnisse der ersten Montage werden verworfen.
- Leakage/Scope: Event-Inhalt, Transportfilter und Serverfilter wurden nicht geaendert. Es werden keine Subject-, Resource- oder Maildaten zusaetzlich exponiert. Keine Task-8-Datei, Migration oder der fremde alte Bericht wurde veraendert.

### Restbedenken Dritte Review-Fix-Welle

- Keine bestaetigten offenen Findings innerhalb der zwei verlangten Korrekturen. Der Account-Hook und die Mail-Shell besitzen weiterhin je einen ACL-getriebenen Refresh; die Generationenlogik macht diese absichtlich idempotent und race-sicher, verursacht unmittelbar nach einem Event aber moeglicherweise einen zusaetzlichen gebundenen Listen-Request.
