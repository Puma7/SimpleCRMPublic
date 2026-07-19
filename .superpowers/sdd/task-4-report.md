# Task 4 Report: Complete policy manifest

## Status

Abgeschlossen. Task 4 bleibt auf Runtime-Inventur, Typisierung und fail-closed
Lookup-/Assertion-Vertraege begrenzt; HTTP-, SQL-, Job- und Event-Enforcement wurde
nicht implementiert.

## Dateien

- `packages/server/src/mail-access/policy-manifest.ts`
- `packages/server/src/jobs/policy.ts`
- `packages/server/src/api/types.ts`
- `packages/server/src/api/server-api.ts`
- `packages/server/src/api/mail-routes.ts`
- `packages/server/src/api/mail-metadata-routes.ts`
- `packages/server/src/api/email-tracking-routes.ts`
- `packages/server/src/api/relay-routes.ts`
- `packages/server/src/api/user-signature-routes.ts`
- `packages/server/src/api/settings-routes.ts`
- `packages/server/src/api/notice-routes.ts`
- `packages/server/src/api/pgp-routes.ts`
- `packages/server/src/api/spam-routes.ts`
- `packages/server/src/api/lock-routes.ts`
- `tests/unit/server-mail-policy-manifest.test.ts`
- `.superpowers/sdd/task-4-report.md`

Das bereits geaenderte Ledger `.superpowers/sdd/progress.md` wurde weder bearbeitet
noch fuer den Task vorgemerkt.

## TDD-Evidenz

- Initial RED: `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts --runInBand`
  schlug erwartungsgemaess fehl, weil
  `packages/server/src/mail-access/policy-manifest.ts` noch nicht existierte.
- Inventur RED: Nach Einfuehrung der kanonischen Runtime-Deskriptoren und leerer
  fail-closed Indizes schlug derselbe Test mit der vollstaendigen Ausgangsinventur
  fehl: 223 Routen, 17 `SERVER_JOB_TYPES` und 38 `email_*`-/Conversation-Lock-Events
  waren unklassifiziert.
- GREEN: `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts --runInBand`:
  PASS, 1 Suite, 8/8 Tests, 0 Snapshots.

## Umsetzung

- Der geordnete Server-Dispatcher exportiert ein Runtime-Inventar aus den realen
  Mail-, Metadaten-, Tracking-, Relay-, Settings-, Notice-, PGP-, Spam- und
  Conversation-Lock-Routen. Die geordnete `MAIL_ROUTES`-Tabelle verwendet dieselben
  Registrierungen fuer Dispatch und Inventur.
- Das Manifest unterscheidet Permission-Policies von expliziten Ausnahmen. Oeffentlich
  bleiben exakt die beiden signierten Tracking-Endpunkte; Auth/Setup ist auf OAuth und
  die drei Verbindungstests begrenzt. Workspace-Admin/Security-Ausnahmen stammen nur
  aus Tracking-, Relay- und Settings-Modulen.
- Message-, Folder-, Attachment-, Thread- und Metadatenpfade deklarieren typisierte
  Lookup-Anweisungen. Request-Daten liefern nur die zu suchende ID; Konto-/Ordnereltern
  werden nicht erfunden oder aus ungeprueften Payloads abgeleitet.
- Alle Jobtypen deklarieren Actor-Modus und entweder Permission plus Ressourcenauflosung
  oder eine explizite Non-Mail/Systemklassifikation. Unbekannte Typen scheitern geschlossen.
- `SERVER_EVENT_TYPES` ist jetzt ein eingefrorenes Runtime-Inventar. Alle relevanten
  Mail-/Lock-Events deklarieren Leserecht und Lookup beziehungsweise eine explizite
  workspace-globale Ressource; unbekannte Mail-Events scheitern geschlossen.

## Verifikation

- Fokussierte Tests:
  `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts tests/unit/mail-route-table.test.ts tests/unit/email-tracking-routes.test.ts tests/unit/relay-routes.test.ts --runInBand`:
  PASS, 4 Suites, 57/57 Tests, 0 Snapshots.
- ESLint:
  `pnpm exec eslint packages/server/src/mail-access/policy-manifest.ts packages/server/src/jobs/policy.ts packages/server/src/api/server-api.ts packages/server/src/api/mail-routes.ts packages/server/src/api/mail-metadata-routes.ts packages/server/src/api/email-tracking-routes.ts packages/server/src/api/types.ts packages/server/src/api/relay-routes.ts packages/server/src/api/user-signature-routes.ts packages/server/src/api/settings-routes.ts packages/server/src/api/notice-routes.ts packages/server/src/api/pgp-routes.ts packages/server/src/api/spam-routes.ts packages/server/src/api/lock-routes.ts tests/unit/server-mail-policy-manifest.test.ts --max-warnings 0`:
  PASS, Exit 0, keine Ausgabe.
- Server-Build: `pnpm --filter @simplecrm/server build`: PASS, Exit 0
  (`tsc -p tsconfig.json`).
- Root-Typecheck: `pnpm exec tsc -p tsconfig.json --noEmit`: PASS, Exit 0,
  keine Ausgabe.
- Diff-Check: `git diff --check`: PASS, Exit 0, keine Ausgabe.

## Self-Review

- Policy-Schluessel sind methodenspezifisch; doppelte Route-, Job- und Eventschluessel
  werden beim Indexaufbau abgewiesen.
- Neue kanonische Routen bleiben nicht unbemerkt: Der Manifestaufbau bricht mit der
  Liste unklassifizierter Schluessel ab.
- PGP- und Spam-Routen wurden nach Review nicht pauschal als Admin-Ausnahme belassen,
  sondern mit Mail-Permissions klassifiziert. Damit bleiben die Ausnahmen eng.
- Die bestehenden Dispatcherreihenfolgen und Handler wurden nicht fachlich veraendert;
  Charakterisierungstests fuer Mail-, Tracking- und Relay-Routen bleiben gruen.
- Es gibt keine Task-5/6-Aufrufe von `MailAccessService`, keine SQL-Scopes und keine
  Job-/Event-Revalidierung in diesem Diff.

## Bedenken

- Task 5 muss die deklarierten Lookup-Anweisungen autoritativ gegen PostgreSQL aufloesen
  und Scopes vor Pagination, Counts, Suche und Export anwenden.
- Task 6 muss die Actor-Modi revalidieren. Insbesondere systemische bzw. optional
  nutzerinitiierte Jobs duerfen keinen allgemeinen Admin-Bypass erhalten; der bestehende
  Scheduled-Send-Payload traegt nicht in jedem Fall eine Initiator-ID.

## Review-Fix

### RED-Nachweise

- Die neuen Semantiktests wurden zuerst ausgefuehrt:
  `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts --runInBand`.
  RED mit 5 fehlgeschlagenen und 6 bestandenen Tests: fehlende `spam_*`-/`pgp_*`-
  Events, neun zusaetzliche Ausnahmen, eine falsche Tracking-Policy, die unvollstaendige
  Scheduled-Send-Aufloesung und die fehlende Spam-Eventklassifikation.
- Nach Ergaenzung des Dispatcher-Kopplungstests lief derselbe Befehl erneut RED mit
  6 fehlgeschlagenen und 6 bestandenen Tests; zusaetzlich fehlte die aus dem echten
  Dispatcher exportierte kanonische Registrierung.
- Ein nachgelagerter Charakterisierungstest fuer Methoden-Fallthrough lief mit
  `--testNamePattern "preserves method fallthrough"` RED (1/1 fehlgeschlagen,
  unerwartete 503-Antwort statt `null`) und nach Korrektur GREEN (1/1 bestanden).

### Korrekturen

- Tracking-, Account-Mail-, Misc-, Snooze- und Reply-Suggestion-Routen besitzen jetzt
  enge, methodenspezifische Permissions und reale Request-Selektoren. Globale oder
  kontobezogene Reply-Settings verwenden eine typisierte optionale Account-Aufloesung;
  Scheduled Send faellt von Draft- auf Account-Aufloesung zurueck.
- Security- und Test-Rspamd-Ausnahmen bleiben nur an ihren vorhandenen Capability-
  beziehungsweise Admin-Pruefungen bestehen. Die Exemption-Reason
  `narrow_service_path` wurde entfernt.
- Die echten API-Dispatcher und ihre Nebeninventare verwenden dieselben ausfuehrbaren,
  geordneten Registrierungen. Die Dispatchreihenfolge, Methoden-Fallthroughs und
  Antwortpfade werden durch Charakterisierungstests abgesichert.
- `spam_*` und `pgp_*` sind mailrelevante Events mit `mail.metadata.read` und einer
  expliziten workspace-globalen Ressourcenstrategie.
- Der Manifest-Test prueft eine exakte Exemption-Allowlist, eine exakte riskante
  Permission-/Selector-Matrix, reale Selector-Feldnamen sowie die Kopplung aller
  Inventare an die ausgefuehrten Dispatcher-Registrierungen.

### Verifikation des Review-Fixes

- Manifest und fokussierte Routentests:
  `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts tests/unit/mail-route-table.test.ts tests/unit/email-tracking-routes.test.ts tests/unit/relay-routes.test.ts tests/unit/reply-suggestion-settings.test.ts tests/unit/account-mail-settings.test.ts tests/unit/mail-security-settings.test.ts tests/unit/server-mail-security-timeout.test.ts --runInBand`:
  PASS, 8 Suites, 75/75 Tests.
- Betroffene Route-Charakterisierung:
  `pnpm exec jest tests/unit/server-edition-foundation.test.ts --runInBand --testNamePattern "server (mail (message metadata|metadata)|email (tag|account signature|internal note)|settings route|notice routes|PGP|spam|lock routes)"`:
  PASS, 1 Suite, 35/35 ausgefuehrte Tests (367 uebersprungen).
- ESLint auf allen Fixdateien: PASS, Exit 0, keine Ausgabe.
- Server-Build: `pnpm --filter @simplecrm/server build`: PASS, Exit 0.
- Root-Typecheck: `pnpm exec tsc -p tsconfig.json --noEmit`: PASS, Exit 0.
- Vollstaendiger `server-edition-foundation`-Lauf: 398/402 Tests bestanden. Die vier
  nicht vom Review-Fix betroffenen Fehler erwarten eine Migrationsliste ohne die auf
  dem Branch bereits vorhandene Migration `0038_mail_acl`; weder Migration noch
  Erwartungstest wurden durch diesen Fix veraendert.
- Diff-Check: `git diff --check`: PASS, Exit 0, keine Ausgabe.
