# Task 6 Report: Enforce mailbox ACL for jobs and events

## Status

Abgeschlossen. Mail-Jobs werden in beiden Worker-Pfaden direkt vor dem
fachlichen Handler zentral gegen `SERVER_JOB_POLICIES` revalidiert. Live- und
Replay-Events werden pro authentifiziertem Principal ueber
`MAIL_EVENT_POLICY_MANIFEST` gefiltert und Mail-Event-Payloads vor der
WebSocket-Serialisierung minimiert.

`.superpowers/sdd/progress.md` wurde nicht geaendert.

## Dateien

- `packages/server/src/mail-access/async-policy-enforcer.ts`
- `packages/server/src/jobs/worker.ts`
- `packages/server/src/jobs/postgres-job-queue-worker.ts`
- `packages/server/src/jobs/graphile-worker.ts`
- `packages/server/src/jobs/types.ts`
- `packages/server/src/db/postgres-job-queue-port.ts`
- `packages/server/src/api/fastify-adapter.ts`
- `packages/server/src/api/mail-routes.ts`
- `packages/server/src/server.ts`
- `tests/unit/server-mail-job-event-acl.test.ts`
- `tests/integration/server-mail-job-event-acl.test.ts`
- `tests/unit/postgres-job-queue-worker.test.ts`
- `tests/unit/server-edition-foundation.test.ts`
- `.superpowers/sdd/mailbox-acl-task-6-report.md`

## RED-Evidenz

- Fokussierter erster RED-Lauf:
  `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  -> FAIL, 3 Suites fehlgeschlagen. Produktluecken: Legacy-Runner completed den
  `ai.reply_suggestion`-Job trotz widerrufener ACL; `JobQueuePort.failTerminal`
  fehlte; Graphile-Tasklist resolved ohne Revalidierung; WebSocket lieferte nicht
  die erwarteten per-Principal gefilterten Mail-Events.
- Nach Testharness-Korrektur (direkter PG-Port-Import, Eventtest im
  Integration-Projekt) derselbe Befehl -> FAIL, 4 Produktfehler: `failTerminal`
  fehlte persistent, Legacy-Deny fuehrte Handler aus, Graphile-Deny war nicht
  terminal, Event-Live/Replay war nicht per Principal gefiltert.
- Review-REDs wurden vor GREEN als Tests ergaenzt:
  Servicejobs ohne Mail-Grants muessen ueber erfolgreiche Policy-Ressourcen
  erlaubt sein; forgebares `actorKind: "service"` muss deny sein; fehlender
  `auth.listUsers` fuer nutzerinitiierte Jobs muss deny sein; Graphile-Deny muss
  zweimal ohne Throw und ohne Handler zurueckkehren; echtes Non-Mail-Replay
  (`customer.updated`) muss sichtbar bleiben.

## Umsetzung

- `async-policy-enforcer.ts` ist der zentrale Enforcer fuer asynchrone Pfade. Er
  nutzt ausschliesslich `SERVER_JOB_POLICIES` und `MAIL_EVENT_POLICY_MANIFEST`
  plus Task-5-Ports `MailAccessService` und `MailResourceLookupPort`.
- Nutzerinitiierte Jobs benoetigen `actorUserId` und einen aktiven User aus
  `auth.listUsers`. Fehlender Auth-Lookup, fehlender Actor, geloeschter oder
  deaktivierter Actor und widerrufene ACL sind fail-closed.
- `initiating_user_or_service` nimmt den Userpfad nur bei validem Actor. Der
  Servicepfad akzeptiert ausschliesslich den kanonischen Marker
  `principal: "simplecrm:service"`; `actorKind` oder fehlender Actor sind kein
  Bypass.
- Reine Servicejobs erhalten keinen Owner/Admin- oder erfundenen User-Grant.
  Sie werden eng ueber die im Manifest aufgeloeste Ressource beziehungsweise den
  manifestierten Scope und Workspacebindung erlaubt. Fehlende/missing Ressourcen
  bleiben deny.
- Legacy-Queue: `JobQueuePort.failTerminal()` setzt persistent
  `attempts = max_attempts`, entfernt Lock und schreibt `last_error`. Der Test
  belegt danach `claimNext(...) === null`.
- Graphile Worker 0.17.3: `permanently_fail_jobs` ist fuer den aktuell gelockten
  Job ungeeignet, weil die SQL-Funktion nur unlocked oder >4h gelockte Jobs
  aktualisiert. Deshalb behandelt die Tasklist ACL-Deny als terminal successful
  return: Handler wird nicht aufgerufen, kein Throw, Graphile completed/deleted
  den Job normal und retryt nicht. Der Test fuehrt den Deny-Pfad zweimal aus und
  erwartet beide Male keinen Throw, keinen Handler und keinen DB-Aufruf.
- Live-WebSocket: Replay wird zuerst gefiltert und gesendet, Live-Events werden
  waehrenddessen gepuffert. Danach laufen Live-Events seriell mit Dedupe,
  Close-/Error-Unsubscribe und send-after-close-Guard.
- Replay und Live verwenden denselben heutigen ACL-Stand des aktuellen
  Principals. Persistierte Events werden nicht pro User kopiert; `server_events`
  bleibt der kanonische Workspace-Log.
- Mail-Event-Payloads werden auf harmlose ID/State-Felder minimiert. Canary-Tests
  decken Subject, Body, Adresse, Filename, IP, User-Agent und Token ab.
- Non-Mail-Events werden ueber einen statischen Set aus
  `MAIL_EVENT_POLICY_MANIFEST` unterschieden. Bekannte CRM-Events wie
  `customer.created` und `customer.updated` bleiben live und replay sichtbar.

## Verifikation

- Fokussierte Task-6-Suite:
  `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  -> PASS, 3 Suites, 8/8 Tests.
- Unit-Foundation/Manifest:
  `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-edition-foundation.test.ts --runInBand`
  -> PASS, 3 Suites, 421/421 Tests. Der bestehende Oversize-Mail-`console.warn`
  blieb sichtbar.
- Integration-Foundation/Event:
  `pnpm exec jest tests/integration/server-edition-foundation.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  -> PASS, 2 Suites, 26/26 Tests.
- PostgreSQL-Mail-ACL-Integration:
  `pnpm exec jest tests/integration/server-mail-access-routes.test.ts --runInBand`
  -> PASS, 1 Suite, 22/22 Tests.
- ESLint:
  `pnpm run lint`
  -> PASS, Exit 0.
- Server-Build:
  `pnpm --filter @simplecrm/server build`
  -> PASS, Exit 0.
- Root-Typecheck:
  `pnpm run typecheck`
  -> PASS, Exit 0.
- Diff-Check:
  `git diff --check`
  -> PASS, Exit 0.

## Restbedenken

- Die Graphile-Terminalisierung ist bewusst ein successful return bei ACL-Deny,
  nicht `permanently_fail_jobs`, weil die installierte 0.17.3-Funktion den
  aktuell gelockten Job nicht atomar terminal markiert. Das vermeidet Retries,
  erzeugt aber keinen Graphile-`job:failed`-Event fuer Autorisierungsdeny.
- Servicejobs sind nur so eng wie ihre Manifest-Ressource. Task 7/8 duerfen diese
  Semantik nicht durch Delegations- oder Rollout-Pfade aufweichen.

## Review-Fix RED/GREEN vom 2026-07-19

### RED

- `pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts --runInBand`
  lief RED: fehlender zentraler Service-Payload-Builder, forgebares
  `principal: "simplecrm:service"` wurde akzeptiert, Post-Sync-/Inbound-System-
  Producer setzten keinen trusted Marker, Workflow-AI/HTTP/Forward-Continuations
  verloren `actorUserId`, unbekannte `email_*`-Runtime-Events wurden ungefiltert
  durchgereicht und negative `email_account_signature`-IDs wurden verworfen.
- Der nachgeschaerfte Source-Inventurtest lief zwischendurch gezielt RED auf
  konkrete Producer-Bloecke (`mail.sync.*` variable `jobType`, danach
  `ai.review`/`ai.pick_canned`-Extraktion), bis jeder echte Queue-Producerblock
  fuer initiierende Jobtypen direkt Actor- oder trusted-Service-Provenienz
  nachwies.
- Breites Gate lief einmal RED in `tests/unit/server-edition-foundation.test.ts`,
  weil eine bestehende Fixture noch das alte forgeable `principal`-Payload fuer
  `mail.sync.imap` verwendete.

### GREEN-Umsetzung

- `packages/server/src/jobs/policy.ts` exportiert jetzt
  `buildTrustedServiceJobPayload`, `isTrustedServiceJobPayload` und den
  kanonischen Marker. Der Kommentar dokumentiert die Vertrauensgrenze:
  ausschliesslich serverseitig konstruierte Queue-Payloads, keine ungeprueften
  Request-Body-Spreads; Worker revalidieren weiter gegen DB/RLS-Mail-ACL.
- Der Async-Enforcer akzeptiert fuer `initiating_user_or_service` nur diesen
  kanonischen Marker. `actorKind` und das alte `principal: "simplecrm:service"`
  sind deny; Public/API-Producer tragen weiter `actorUserId`.
- `ServerWorkflowContext`, Workflow-Delay/Subflow/AI/HTTP/Forward/Sync-Producer
  sowie AI/HTTP/Forward/DMARC-Continuation-Producer erhalten `actorUserId` oder
  trusted-Service-Provenienz. Post-Sync, Inbound-Workflow-Enqueue und Relay-
  Followup nutzen den zentralen Builder fuer echte Systemketten.
- Mail-Event-Filter laesst nur kanonische `SERVER_EVENT_TYPES` als Non-Mail
  passieren; nicht-kanonische Runtime-Typen fail-closed. Account-Signature-
  Metadata verwendet dieselbe Non-Zero-ID-Semantik wie Task 5.
- WebSocket-Dedupe verwendet ein begrenztes geordnetes Fenster
  (`EVENT_STREAM_DEDUPE_WINDOW_SIZE`) statt eines unbegrenzten Sets.
- Tests decken disabled-user, negative Signature-ID mit Accountgrant, alle
  geforderten Event-Ressourcenarten, spam message->account->deny, canonical
  Non-Mail vs unbekanntes Runtime-Event, bounded Dedupe sowie reale Post-Sync-,
  Inbound- und Workflow-Producer-/Continuation-Ketten ab.

### GREEN-Verifikation

- Fokussierte Provenienz/Event/Inbound-Suite:
  `pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/mail-inbound-workflow-enqueue.test.ts --runInBand`
  -> PASS, 3 Suites, 17/17 Tests.
- Workflow/AI/Sync-Produzenten plus Task-6-Suite:
  `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/mail-inbound-workflow-enqueue.test.ts tests/unit/workflow-execution-jsonb.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/workflow-ai-nodes.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  -> PASS, 8 Suites, 58/58 Tests.
- Foundation/Manifest/Integration:
  `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-edition-foundation.test.ts tests/unit/postgres-job-queue-worker.test.ts tests/integration/server-edition-foundation.test.ts tests/integration/server-mail-job-event-acl.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand`
  -> PASS, 6 Suites, 469/469 Tests.
- ESLint: `pnpm run lint` -> PASS, Exit 0.
- Server-Build: `pnpm --filter @simplecrm/server build` -> PASS, Exit 0.
- Root-Typecheck: `pnpm run typecheck` -> PASS, Exit 0.
- Diff-Check: `git diff --check` -> PASS, Exit 0.

### Restbedenken Review-Fix

- Keine neuen funktionalen Bedenken. Der Source-Inventurtest ist bewusst
  blockbasiert und soll bei neuen unmarkierten Queue-Produzenten rot werden; bei
  kuenftigen komplexeren Producer-Abstraktionen muss er zusammen mit der
  Abstraktion erweitert werden.

## Finaler Important-Fix vom 2026-07-19

### RED

- `pnpm exec jest tests/unit/server-mail-job-provenance.test.ts --runInBand`
  lief nach der ersten Testaenderung RED: der Inventartest scannte nun
  repo-weit `packages/server/src/**/*.ts` und fand dadurch den bislang
  ausgelassenen Producer
  `packages/server/src/mail-compose-send.ts:workflow.execute`. Die erwartete
  Fehlermeldung war:
  `Expected pattern: /actorUserId|workflowJobProvenance|with[A-Za-z]+Provenance|buildTrustedServiceJobPayload/`
  gegen den neu entdeckten `mail-compose-send.ts`-Enqueue-Block.
- Vollstaendiger RED-Output:
  `.hermes/reports/task-6-final-important-red.log`.

### GREEN-Umsetzung

- `tests/unit/server-mail-job-provenance.test.ts` ersetzt die harte
  `producerFiles`-Liste durch einen rekursiven Scan von
  `packages/server/src/**/*.ts`.
- Die Inventur wertet konkrete Queue-Producer-Vorkommen aus:
  `insertInto('job_queue')` und `jobQueue.enqueue({`.
- Die Assertion prueft jetzt sowohl fehlende initiierende Policy-Typen als auch
  jeden einzelnen entdeckten Producer-Block. Mehrere `workflow.execute`-Producer
  koennen sich nicht mehr gegenseitig verdecken.
- Die Erkennung vermeidet Consumer-/Handler-/Typ-False-Positives, weil sie nur
  echte Queue-Schreibstellen mit konkretem Literal-Typ oder dem bekannten
  `mail.sync.imap`/`mail.sync.pop3`-`jobType`-Producer betrachtet. Der generische
  PostgreSQL-Queue-Port traegt keinen konkreten Producer-Typ und wird daher nicht
  als fachlicher Producer gewertet.
- Provenienz zaehlt nur bei `actorUserId`, zentralem
  `buildTrustedServiceJobPayload` oder dem zentralen Trusted-Service-Markerfeld.
  Helpernamen wie `workflowJobProvenance` oder `with...Provenance` werden bis in
  den Funktionskoerper verfolgt, statt als blosse Strings zu genuegen.
- Es wurde keine Runtime-Produktionslogik geaendert. Der repo-weite Scan fand
  keinen echten unprovenanzierten Producer; daher kein BLOCKED.

### GREEN-Verifikation

- Fokussierter Provenienztest:
  `pnpm exec jest tests/unit/server-mail-job-provenance.test.ts --runInBand`
  -> PASS, 1 Suite, 6/6 Tests.
  Output: `.hermes/reports/task-6-final-important-green-provenance-final.log`.
- Task-6 Provenienz-Regressionen:
  `pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/mail-inbound-workflow-enqueue.test.ts --runInBand`
  -> PASS, 3 Suites, 17/17 Tests.
  Output: `.hermes/reports/task-6-final-important-green-provenance-regressions-final.log`.
- Task-6 Policy-Regressionen:
  `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-policy-manifest.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  -> PASS, 3 Suites, 20/20 Tests.
  Output: `.hermes/reports/task-6-final-important-green-policy-regressions-final.log`.
- Diff-Check:
  `git diff --check`
  -> PASS, Exit 0.
  Output: `.hermes/reports/task-6-final-important-diff-check.log`.

### Geaenderte Dateien und Commit

- `tests/unit/server-mail-job-provenance.test.ts`
- `.superpowers/sdd/mailbox-acl-task-6-report.md`
- `.hermes/reports/task-6-final-important-*.log`
- `.hermes/reports/task-6-final-important-producer-inventory-evidence.md`
- Commit: `test(server): cover all mail job producers`

### Self-Review

- Scope eingehalten: keine Task-7/8-Dateien und keine Runtime-Produktionslogik.
- Die vorher ausgelassenen Real-Producer in `mail-compose-send.ts`,
  `mail-read-receipt-responder.ts` und `dmarc-ingest.ts` sind durch den
  repo-weiten Scan abgedeckt.
- Die Inventur ist weiter absichtlich auf Queue-Produzenten begrenzt, damit
  Handler-, Consumer- und Typ-Code keine kuenstlichen Treffer erzeugen.
