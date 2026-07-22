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

## Review-Fix 2026-07-20 (Base `6e286e7`)

Die zwei bestaetigten Review-Findings wurden isoliert behoben. Dieser Abschnitt
ersetzt fuer Synchronisation, Overflow und Telemetrie-Health die entsprechenden
Aussagen der Erstimplementierung oben.

### RED

- Invocation:
  `pnpm exec jest --runTestsByPath tests/unit/server-mail-acl-rollout.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand`
- Observable: Exit `1`; `11 failed`, `46 passed`.
- Reproduziert wurden fehlende Shared/Exclusive-Wartebeziehungen, fehlende
  Health-Spalten, Bigint-Overflow, unsichtbare Zero-Row-Updates und durch
  Counterfehler ersetzte Allow-/Deny-Entscheidungen.
- Artifact: `.hermes/reports/task-8-review-fix-red.log`.

### GREEN

- Fokussierter Abschlusslauf: Exit `0`; `2 passed` Suites, `58 passed` Tests.
- Artifact: `.hermes/reports/task-8-review-fix-focused-green.log`.
- Full Unit: `265` Suites, `2398` Tests, eine Snapshot-Pruefung, Exit `0`.
- Full Integration: `25` Suites, `345` Tests, Exit `0`.
- Mail Coverage: `179` Suites; `1166` passed, `1` skipped; 91.91 % Lines und
  80.08 % Branches, Exit `0`.
- Lint, Build und Root-Typecheck: jeweils Exit `0`.

### Linearisierung

- Jede userbezogene Rollout-Evaluation haelt einen PostgreSQL Shared Advisory
  Transaction Lock von Mode-Read ueber Legacy/New-Abfragen und Counter-Write bis
  zur reifizierten Allow-/Deny-Entscheidung.
- Transition und Reset nehmen denselben workspace-abgeleiteten Advisory Key
  exklusiv. Tests mit getrennten Kysely-Pools beweisen, dass sie auf alle zuvor
  gestarteten Shared-Evaluationen warten.
- Der Key ist `hashtextextended('simplecrm:mail-acl-rollout:' || workspace_uuid,
  0)`: Die feste Namespace-Praefix verhindert beabsichtigte Ueberschneidungen
  mit anderen Lock-Familien. Eine 64-Bit-Hashkollision wuerde zwei Workspaces nur
  konservativ serialisieren, nie Berechtigungen vermischen.
- Der explizite Evaluation-Context reicht dieselbe Kysely-Transaktion an State-,
  Legacy- und New-ACL-Port weiter. Der echte `maxConnections=1`-Test beweist,
  dass keine verschachtelte Pool-Ausleihe und damit kein Pool-Deadlock entsteht.
- Erwartete Denies werden innerhalb der Transaktion als Wert gefuehrt und erst
  nach Commit wieder als `MailAccessDeniedError` geworfen. Dadurch werden Deny-
  Beobachtungen nicht zurueckgerollt.

### Telemetrie-Health

- `0039_mail_acl_rollout` enthaelt nun `telemetry_healthy`, einen durch CHECK
  begrenzten `diagnostic_code` und `diagnostic_at`. `0038_mail_acl.ts` bleibt
  unveraendert gegen `6e286e7`.
- Counter rechnen vor dem Bigint-Cast als `numeric`, saturieren bei
  `9223372036854775807` und markieren das Beobachtungsfenster mit
  `counter_saturated` ungesund. Negative oder ueberlaufende Werte werden nicht
  gespeichert.
- Zero-Row-Updates liefern explizit `counter_update_zero_rows`. Unerwartete
  SQL-Fehler werden ueber einen Savepoint isoliert und best-effort als
  `counter_update_failed` persistiert. Der injizierte Reporter erhaelt nur den
  begrenzten Code, keine Workspace-, User-, Resource-, Route- oder Mail-ID.
- Telemetriefehler und selbst Fehler beim Persistieren oder Melden der Diagnose
  ersetzen weder Allow noch Deny. Nicht vergleichbare Rechte bestimmen zuerst
  die New-ACL-Entscheidung und schreiben erst danach best-effort Telemetrie.
- Readiness verlangt `telemetryHealthy=true`. Transition liefert bei ungesundem
  Fenster deterministisch `telemetry_unhealthy`; der auditierte Shadow-Reset
  setzt Counter, Observation und Diagnose atomar auf ein neues gesundes Fenster.

### Review-Fix Self-Review

- Security-Downgrade: Nach erfolgreichem Exclusive-Enforce kann keine spaeter
  linearisierte Evaluation mehr Shadow lesen oder Legacy aufrufen.
- Lost Updates: Shared-Evaluationen duerfen parallel laufen; die atomaren
  Row-Updates behalten alle Mismatches. Exclusive Adminpfade warten auf alle.
- RLS/Cross-Tenant: Context und SQL sind workspace-gebunden; ein realer falsch
  gescopter RLS-Test liefert Zero-Row, veraendert keinen anderen Workspace und
  behaelt die ACL-Entscheidung.
- Cache-Staleness: Weiterhin kein Mode-Cache; der Mode-Read liegt im gehaltenen
  Shared Lock.
- Performance: Shadow haelt eine kurze DB-Transaktion ueber die beiden ACL-
  Abfragen. Enforce nimmt ebenfalls kurz den Shared Key, ruft aber weiterhin
  keinen Legacy-Port auf.
- No-Regression: Keine SQLite-/Desktop-Aenderung, kein Drop von
  `user_account_access`, keine Aenderung an Migration `0038`.

### Review-Fix Restbedenken

- Der Build zeigt weiterhin nur die bereits dokumentierten Vite-Warnungen zur
  Browser-Externalisierung von Node-Modulen und zur Chunk-Groesse.

## Atomic Audit / Durable Latch Review-Fix 2026-07-20 (Base `43d273c`)

Die zwei validierten Folgefindings sind implementiert und verifiziert. Wegen
der koordinierten parallelen Workflow-ACL-Welle ist dieser Stand bewusst noch
nicht gestaged oder committed.

### RED

- Invocation:
  `pnpm exec jest --runTestsByPath tests/unit/server-mail-acl-rollout.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand`
- Observable: Exit `1`; `8 failed`, `52 passed`.
- Reproduziert wurden die fehlende `in_flight`-Spalte, nicht-atomare
  Rollout-Mutation/Auditierung, unsichtbare laufende Auswertungen, fehlende
  Session-Lock-Finalisierung und durch Verbindungsverlust nicht geschuetzte
  ACL-Entscheidungen.
- Artifact: `.hermes/reports/task-8-atomic-latch-red.log`.

### GREEN

- Fokussierter Abschlusslauf: `2` Suites, `63` Tests, Exit `0`.
- Artifact: `.hermes/reports/task-8-atomic-latch-focused-green.log`.
- Finaler kombinierter Lauf nach Abschluss der parallelen Workflow-ACL-Welle:
  `5` Suites, `493` Tests, Exit `0`.
- Artifact: `.hermes/reports/task-8-atomic-latch-combined-focused.log`.
- Full Unit: `265` Suites, `2401` Tests, eine Snapshot-Pruefung, Exit `0`.
- Full Integration: `25` Suites, `350` Tests, Exit `0`.
- Mail Coverage: `179` Suites; `1166` passed, `1` skipped; 91.91 % Lines und
  80.08 % Branches, Exit `0`.
- Lint, Build und Root-Typecheck: jeweils Exit `0`.

### Atomare Administration und Audit

- `resetShadowCounters` und `transitionToEnforce` nehmen weiterhin den
  workspace-abgeleiteten exklusiven Rollout-Lock und schreiben Mutation plus
  Hashchain-Audit in derselben Workspace-Transaktion.
- Der bestehende Audit-Hash-/Lock-/Insert-Code wurde als
  `recordPostgresAuditEvent` faktorisiert und unveraendert von normalem
  Audit-Port und Rollout-Administration verwendet. Es gibt keinen zweiten
  Hashalgorithmus.
- Die Route reicht `actorUserId` in die atomare Operation und schreibt kein
  nachgelagertes Audit mehr. Ein erzwungener Audit-INSERT-Fehler rollt Reset
  und Enforce vollstaendig zurueck. Retry und konkurriertes Enforce erzeugen
  genau einen erfolgreichen, verifizierbaren Hashchain-Eintrag.

### Durable In-Flight Latch

- `0039_mail_acl_rollout` und das typisierte Schema enthalten den einzigen
  neuen aggregierten Zustand `in_flight bigint`; `0038_mail_acl.ts` bleibt mit
  SHA-256 `3048f74add211b1f36b49b54baaf84d5f3a1d66fc6561e5614766f76c87600cd`
  byte-identisch zu `43d273c`.
- Shadow-Auswertungen pinnen genau eine Kysely/PostgreSQL-Verbindung, nehmen
  einen sessionweiten Shared Advisory Lock und committen zuerst die
  `in_flight`-Registrierung. Vergleich und Counter-/Latch-Finalisierung laufen
  in folgenden Workspace-Transaktionen auf derselben Verbindung.
- Nur erfolgreiche Counter-Finalisierung dekrementiert den Latch. Statement-,
  Commit-, RLS-Zero-Row- oder Verbindungsfehler lassen ihn offen; die bereits
  berechnete Allow-/Deny-Entscheidung bleibt unveraendert. Readiness verlangt
  `inFlight=0`; Enforce liefert bei offenem Latch `evaluations_in_flight`.
- `pg_advisory_unlock_shared` wird im `finally` auf der gepinnten Verbindung
  geprueft. Der echte `maxConnections=1`-Test weist den expliziten Unlock und
  danach null gehaltene Session-Locks nach. Bei Prozess-/Connection-Verlust
  gibt PostgreSQL den Session-Lock frei, waehrend der vorher committe Latch die
  Readiness weiterhin blockiert.
- Reset wartet auf denselben Lock exklusiv. Erst nach Lock-Erwerb sind
  verbleibende Latches nachweislich stale; Reset loescht sie zusammen mit
  Counter, Observation und Diagnose atomar und auditiert.

### Self-Review

- Security-Downgrade/Cache: Fehlende oder korrupte States bleiben enforce;
  Enforce registriert keinen Latch und ruft Legacy nie auf. Es gibt weiterhin
  keinen Mode-Cache oder App-Downgrade.
- Locking/Deadlock: Registration, Vergleich und Finalisierung leihen auf einem
  `maxConnections=1`-Pool keine zweite Verbindung. Session-Shared und
  Transaction-Exclusive verwenden denselben 64-Bit-Key; die Audit-Hashchain
  wird danach in stabiler Lock-Reihenfolge gesperrt.
- Lost Updates/Overflow: `in_flight` und Counter werden atomar unter Row-Lock
  aktualisiert; Counter bleiben saturierend. Ein Latch wird niemals unter null
  dekrementiert und nur bei erfolgreicher Finalisierung geschlossen.
- RLS/Cross-Tenant: Jede Teiltransaktion setzt erneut den Workspace-Kontext;
  Latch, Counter, Mutation und Audit sind workspace-gebunden. Der echte
  falsch gescopten Finalisierungstest veraendert keinen anderen Workspace.
- Datenminimierung: Rollout-State und Readiness enthalten nur Aggregate,
  Mode, Zeitstempel, Diagnose und `inFlight`; keine User-, Mail-, Resource-,
  Route- oder Inhaltsdaten.
- Performance: Shadow verwendet eine gepinnte Verbindung ueber drei kurze
  Transaktionen; mehrere Auswertungen teilen den Advisory Lock. Enforce bleibt
  new-ACL-only und fuehrt keine In-flight-Registrierung aus.

### Restbedenken / Koordination

- Keine fachlichen offenen Findings in den zwei beauftragten Review-Punkten.
- Der Build zeigt weiterhin die bestehenden Vite-Warnungen zur
  Browser-Externalisierung und Chunk-Groesse.
- Die parallele Workflow-ACL-Welle ist abgeschlossen. Der gemeinsame finale
  Stand einschliesslich der geteilten Integrationstestdatei wurde mit dem
  kombinierten fokussierten Lauf verifiziert.
- Der gesamte Worktree ist gemaess Koordination weiterhin unstaged; dieser
  Task-8-Stand wurde weder gestaged noch committed.
