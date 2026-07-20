# Mailbox ACL Task 8 Report

Datum: 2026-07-20
Branch: `codex/server-first-mail-acl`
Base: `e188c5e`

## Status

Implementiert. Mailbox-ACL-Enforcement wird ueber einen zentralen
Rollout-Decorator vor `MailAccessService` gesteuert. Shadow nutzt fuer die sechs
vergleichbaren Migration-0038-Rechte die Legacy-Entscheidung aus
`user_account_access` als Runtime-Entscheidung und zaehlt Mismatches aggregiert.
Enforce und nicht vergleichbare Rechte nutzen ausschliesslich die neue ACL.

Die historische Migration `packages/server/src/migrations/0038_mail_acl.ts`
wurde exakt auf Base `e188c5e` zurueckgesetzt. Rollout-State liegt nur in der
neuen Migration `0039_mail_acl_rollout`.

## RED

- Neue RED-Tests wurden zuerst in `tests/unit/server-mail-acl-rollout.test.ts`
  und `tests/integration/server-mail-access-routes.test.ts` fuer Shadow vs.
  Enforce, Mapping, nicht vergleichbare Rechte, Owner/Admin, Scope-Mismatches,
  Workspace-Isolation, Counter-Atomizitaet, korrupte/fehlende States, neue vs.
  bestehende Workspaces, Admin-Transition und Legacy-Port-Nichtaufruf in enforce
  angelegt.
- Das erste fokussierte Ausfuehren war RED, weil Rollout-Service, Postgres-Port,
  API-Route und Migration `0039` noch fehlten. Dieser initiale RED-Lauf wurde im
  Terminal beobachtet; ein separater RED-Log wurde nicht dauerhaft gesichert.

## GREEN

- Fokussierte Rollout-Suite:
  - Invocation: `pnpm exec jest --runTestsByPath tests/unit/server-mail-acl-rollout.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand`
  - Observable: `Test Suites: 2 passed, 2 total`; `Tests: 48 passed, 48 total`
  - Artifact: `.hermes/reports/task-8-focused-rollout-after-final-review.log`
- Lint:
  - Invocation: `pnpm run lint`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-lint.log`
- Unit:
  - Invocation: `pnpm run test:unit`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-test-unit.log`
- Integration:
  - Invocation: `pnpm run test:integration`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-test-integration.log`
- Mail Coverage:
  - Invocation: `pnpm run test:mail:coverage`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-test-mail-coverage.log`
- Build:
  - Invocation: `pnpm run build`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-build.log`
- Root-Typecheck:
  - Invocation: `pnpm run typecheck`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-root-typecheck.log`
- Whitespace:
  - Invocation: `git diff --check`
  - Observable: Exit `0`
  - Artifact: `.hermes/reports/task-8-git-diff-check.log`

## Implementierte Dateien

- Rollout-Service und Ports:
  `packages/server/src/mail-access/rollout-service.ts`,
  `packages/server/src/mail-access/postgres-mail-acl-rollout-state-port.ts`,
  `packages/server/src/mail-access/types.ts`
- Migration, Schema und RLS:
  `packages/server/src/migrations/0039_mail_acl_rollout.ts`,
  `packages/server/src/migrations/index.ts`,
  `packages/server/src/db/schema.ts`,
  `packages/server/src/security/rls-isolation-check.ts`
- API und Komposition:
  `packages/server/src/api/mail-acl-rollout-routes.ts`,
  `packages/server/src/api/server-api.ts`,
  `packages/server/src/api/types.ts`,
  `packages/server/src/api/openapi.ts`,
  `packages/server/src/server.ts`
- Tests:
  `tests/unit/server-mail-acl-rollout.test.ts`,
  `tests/integration/server-mail-access-routes.test.ts` plus notwendige
  bestehende Route-/Manifest-Fixture-Anpassungen.

## Architekturentscheidungen

- `0038_mail_acl.ts` bleibt unveraendert; `0039_mail_acl_rollout` erzeugt
  `mail_acl_rollout_state`, RLS/FORCE RLS und backfillt nur beim Migrationslauf
  bereits vorhandene Workspaces auf `shadow`.
- Fehlende Row bedeutet runtime `enforce`; dadurch starten nach der Migration neu
  angelegte Workspaces ohne explizite Rollout-Row direkt in enforce.
- Vergleichbar sind ausschliesslich:
  `mail.metadata.read`, `mail.content.read`, `mail.attachment.read` -> `can_read`;
  `mail.draft.create`, `mail.draft.edit`, `mail.send` -> `can_send`.
- Shadow `assertPermission` entscheidet mit Legacy aus
  same-workspace `user_account_access`; neue ACL wird nur verglichen. Enforce ruft
  den Legacy-Port nicht auf.
- Shadow `resolveScope` vergleicht Legacy-Accountscope gegen neue
  Account-/Folder-/Message-Grants in beiden Richtungen und gibt den
  accountgebundenen Legacy-Scope zur SQL-Pagination zurueck.
- Counters sind bigint und atomar per `UPDATE counter = counter + delta`.
  Persistiert werden nur `evaluated`, `legacy_allow_new_deny`,
  `legacy_deny_new_allow`, `not_comparable`, Mode und Zeitstempel.
- Owner/Admin bleiben nach Workspace-Resource-Bindung bypassed und unzaehlt.
  System-, Service- und Inbound-Principals bleiben im Task-6-new-ACL-Pfad.
- Admin-API ist workspace-scoped, owner/admin-only, auditierbar, one-way
  `shadow -> enforce`, blockiert bei `evaluated=0` oder Mismatches und erlaubt
  Counter-Reset nur im Shadow-Modus.

## Self-Review

- Security-Downgrade: Enforce ist Default fuer fehlende und diagnostisch
  korrupte States; es gibt keinen App-Pfad fuer enforce->shadow.
- Falsches Mapping: Die sechs vergleichbaren Rechte sind explizit codiert und
  getestet; alle anderen Rechte sind new-ACL-enforced und erhoehen nur
  `notComparable`.
- Counter-Leaks: Keine User-, Resource-, Route-, Mail-IDs oder Inhalte werden in
  Rollout-State oder Counter-Metadaten gespeichert.
- Lost Updates/Overflow: Counters verwenden `bigint`, nonnegative Checks und
  atomare SQL-Increments; Concurrency ist per PostgreSQL-Test abgedeckt.
- Cross-Tenant/RLS: Rollout-State ist workspace-keyed, RLS-geschuetzt und im
  RLS-Isolation-Check registriert. Legacy-Vergleich filtert `workspace_id`.
- Cache-Staleness: Kein Rollout-Mode-Cache eingefuehrt; jede Entscheidung liest
  den aktuellen State.
- Performance: Shadow macht fuer vergleichbare Pruefungen je eine Legacy- und
  neue ACL-Abfrage plus ein aggregiertes Counter-Update; Enforce bleibt ohne
  Legacy-Abfrage.
- No-Regression: `user_account_access` bleibt erhalten; 0038 wird nicht
  veraendert; lokale SQLite-/Desktop-Varianten wurden nicht erweitert.

## Restbedenken

- Der initiale RED-Lauf wurde nicht als eigener Log persistiert; die
  anschliessenden GREEN- und Gate-Artefakte sind unter `.hermes/reports/`
  vorhanden.
- `pnpm run build` meldet bestehende Vite-Warnungen zur Browser-Externalisierung
  von Node-Modulen und zur Chunk-Groesse. Sie sind unabhaengig von Task 8 und
  wurden nicht repariert.
